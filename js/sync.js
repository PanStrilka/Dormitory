/*
 * sync.js — optional shared cloud storage via Supabase (free tier).
 *
 * The whole app works without this (localStorage). When 8 roommates want to
 * share one live dataset, one of them creates a free Supabase project, runs
 * the tiny SQL in README, and pastes the project URL + anon key in Settings.
 *
 * We store the entire state as a single JSON row (id = 'shared') and use the
 * plain PostgREST endpoint — no SDK, no build step. Strategy: last-write-wins
 * with a short poll so phones converge within a few seconds. Simple and more
 * than enough for a flat of 8.
 */
(function (DORM) {
  'use strict';

  var TABLE = 'bulka_state';
  var ROW_ID = 'shared';
  var cfg = null;          // { url, key }
  var pollTimer = null;
  var lastPushedAt = 0;
  var applying = false;    // guard against echo loops

  function headers() {
    return {
      'apikey': cfg.key,
      'Authorization': 'Bearer ' + cfg.key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    };
  }

  function enable(config) {
    cfg = config && config.url && config.key ? config : null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (!cfg) { setStatus('off'); return; }
    setStatus('connecting');
    pull().then(function () { setStatus('on'); }).catch(function () { setStatus('error'); });
    pollTimer = setInterval(pull, 6000);
  }

  function disable() {
    cfg = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setStatus('off');
  }

  function push(state) {
    if (!cfg || applying) return;
    lastPushedAt = Date.now();
    var body = [{ id: ROW_ID, data: state, updated_at: new Date().toISOString() }];
    fetch(cfg.url.replace(/\/$/, '') + '/rest/v1/' + TABLE, {
      method: 'POST', headers: headers(), body: JSON.stringify(body)
    }).then(function (r) {
      setStatus(r.ok ? 'on' : 'error');
    }).catch(function () { setStatus('error'); });
  }

  function pull() {
    if (!cfg) return Promise.resolve();
    var url = cfg.url.replace(/\/$/, '') + '/rest/v1/' + TABLE +
      '?id=eq.' + ROW_ID + '&select=data,updated_at';
    return fetch(url, { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!rows || !rows.length) { setStatus('on'); return; }
        var remote = rows[0].data;
        if (!remote) return;
        // Ignore our own just-pushed write bouncing back.
        var remoteTs = new Date(rows[0].updated_at).getTime();
        if (remoteTs <= lastPushedAt + 500) { setStatus('on'); return; }
        applying = true;
        try {
          var lang = DORM.i18n.getLang();
          DORM.store.replaceState(remote);
          DORM.i18n.setLang(remote.settings && remote.settings.lang || lang);
        } finally { applying = false; }
        setStatus('on');
      })
      .catch(function () { setStatus('error'); });
  }

  var statusCb = null;
  function onStatus(cb) { statusCb = cb; }
  function setStatus(s) { if (statusCb) statusCb(s); }

  DORM.sync = {
    enable: enable,
    disable: disable,
    push: push,
    pull: pull,
    onStatus: onStatus,
    isOn: function () { return !!cfg; }
  };
})(window.DORM = window.DORM || {});
