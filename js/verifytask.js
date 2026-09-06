/*
 * verifytask.js — ask the AI whether a task-proof photo really shows the job
 * done, and that it isn't a photo of a screen (anti-spoofing).
 *
 *   DORM.verifytask.verify({ dataUrl, task, zone })
 *     -> Promise< {
 *          ok,            // request succeeded
 *          done,          // AI is confident the task looks done
 *          spoof,         // AI thinks this is a photo of a screen / another photo
 *          confidence,    // 0..1
 *          reason,        // short human sentence (localised by the model)
 *          skipped        // true when there's no AI backend — kept as manual proof
 *        } >
 *
 * Graceful degradation: with no Supabase sync configured the photo is still
 * captured and stored locally as proof, but we can't AI-verify it, so we return
 * { ok:true, skipped:true } and let the caller accept it as a manual record.
 */
(function (DORM) {
  'use strict';

  function cfg() {
    var s = DORM.store.get().settings.sync;
    return (s && s.url && s.key) ? { url: s.url.replace(/\/$/, ''), key: s.key } : null;
  }

  function enabled() { return !!cfg(); }

  function verify(input) {
    input = input || {};
    var c = cfg();
    if (!c) return Promise.resolve({ ok: true, skipped: true, done: false, spoof: false });
    if (!input.dataUrl) return Promise.reject(new Error('no-image'));

    return fetch(c.url + '/functions/v1/verify-task', {
      method: 'POST',
      headers: {
        'apikey': c.key,
        'Authorization': 'Bearer ' + c.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: input.dataUrl,
        task: input.task || '',
        zone: input.zone || '',
        lang: (DORM.i18n && DORM.i18n.getLang && DORM.i18n.getLang()) || 'cs'
      })
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'bad-response' }; }); })
      .then(function (res) {
        // Normalise so callers never have to guess at missing fields.
        return {
          ok: res.ok !== false,
          done: !!res.done,
          spoof: !!res.spoof,
          confidence: typeof res.confidence === 'number' ? res.confidence : null,
          reason: res.reason || res.error || '',
          skipped: false
        };
      })
      .catch(function () { return { ok: false, done: false, spoof: false, reason: 'network', skipped: false }; });
  }

  DORM.verifytask = { verify: verify, enabled: enabled };
})(window.DORM = window.DORM || {});
