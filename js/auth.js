/*
 * auth.js — real accounts + multi-cell backend (Supabase Auth).
 *
 * Activated only in "auth mode" (URL ?auth=1, or a saved flag, or
 * CONFIG.authMode), so the normal honor-based single-cell app is untouched
 * until we switch over. Loads @supabase/supabase-js on demand and exposes:
 *   - auth: signIn (email magic link/OTP), signOut, session, onChange
 *   - data: memberships, cells, join requests, admin ops (RLS-enforced)
 *   - a per-cell sync adapter over the `cell_state` table
 *
 * Only the PUBLIC url + publishable key are used (from config.js); RLS in
 * supabase/schema-auth.sql enforces who can read/write what.
 */
(function (DORM) {
  'use strict';

  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  var client = null;
  var sdkPromise = null;

  function enabled() {
    try {
      // ?auth=1 forces accounts on, ?auth=0 forces the local app on — both are
      // remembered, so the choice sticks across reloads (escape hatch).
      if (/[?&]auth=1\b/.test(location.search)) { localStorage.setItem('bulka_authmode', '1'); }
      if (/[?&]auth=0\b/.test(location.search)) { localStorage.setItem('bulka_authmode', '0'); }
      var flag = localStorage.getItem('bulka_authmode');
      if (flag === '1') return true;
      if (flag === '0') return false;
    } catch (e) {}
    return !!(DORM.CONFIG && DORM.CONFIG.authMode); // default: accounts on
  }

  function authRedirect() {
    // Accounts mode is the default now, so no query flag is needed. Keeping the
    // redirect to the bare page also makes Supabase's redirect-URL allow-list
    // matching trivial (just the Site URL).
    return location.origin + location.pathname;
  }

  function loadSDK() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve(window.supabase);
      var s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = function () { resolve(window.supabase); };
      s.onerror = function () { reject(new Error('sdk-load-failed')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function init() {
    var c = DORM.CONFIG;
    if (!c || !c.url || !c.key) return Promise.reject(new Error('no-config'));
    return loadSDK().then(function (sb) {
      if (!client) {
        client = sb.createClient(c.url, c.key, {
          // Implicit flow puts the recovery/login tokens in the URL hash, which
          // detectSessionInUrl reads on load — deterministic for our recovery
          // detection (type=recovery in the hash).
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
        });
      }
      return client.auth.getSession().then(function (r) {
        return r.data.session;
      });
    });
  }

  function onChange(cb) {
    if (!client) return;
    client.auth.onAuthStateChange(function (evt, session) { cb(session, evt); });
  }

  function signIn(email) {
    // Sends an email that contains BOTH a 6-digit code and a magic link.
    // On iOS "add to home screen" apps the link opens in Safari (a separate
    // cookie jar), so the code path — verifyOtp() below — is what actually
    // logs you in inside the installed app.
    return client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: authRedirect(), shouldCreateUser: true }
    });
  }
  // Verify the 6-digit code typed into the app -> session in THIS container.
  function verifyOtp(email, code) {
    return client.auth.verifyOtp({ email: email, token: String(code).trim(), type: 'email' });
  }
  // Email + password: no emails at all, so the session is created directly in
  // this container — which is what makes iOS "add to home screen" work, and
  // avoids the default email service's tiny rate limit.
  function signUpPassword(email, password) {
    return client.auth.signUp({ email: email, password: password });
  }
  function signInPassword(email, password) {
    return client.auth.signInWithPassword({ email: email, password: password });
  }
  // Password reset / "set a password" for accounts that never had one (e.g. the
  // first admin, created back in the magic-link era). Sends a recovery email;
  // opening its link signs the user in with a PASSWORD_RECOVERY event, after
  // which updatePassword() sets the new password.
  function resetPassword(email) {
    return client.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
  }
  function updatePassword(password) {
    return client.auth.updateUser({ password: password });
  }
  // Delete the signed-in user's own account. Prefers the delete-account Edge
  // Function (removes memberships + profile + the auth user). If that function
  // isn't deployed, it falls back to removing the user's own memberships (which
  // RLS allows) so they at least lose access, then reports partial success.
  function deleteAccount() {
    var c = DORM.CONFIG;
    return client.auth.getSession().then(function (r) {
      var token = r.data.session && r.data.session.access_token;
      if (!token) return { ok: false, error: 'no-session' };
      return fetch(c.url.replace(/\/$/, '') + '/functions/v1/delete-account', {
        method: 'POST',
        headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      }).then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
        .then(function (res) {
          if (res && res.ok) return { ok: true };
          // Fallback: at least drop this user's own membership rows.
          return myMemberships().then(function (ms) {
            return Promise.all(ms.map(function (m) { return removeMembership(m.id); }))
              .then(function () { return { ok: true, partial: true }; })
              .catch(function () { return { ok: false }; });
          });
        }).catch(function () {
          return myMemberships().then(function (ms) {
            return Promise.all(ms.map(function (m) { return removeMembership(m.id); }))
              .then(function () { return { ok: true, partial: true }; })
              .catch(function () { return { ok: false }; });
          });
        });
    });
  }
  function signOut() { return client.auth.signOut(); }
  function user() {
    return client && client.auth.getUser ? client.auth.getUser() : Promise.resolve({ data: {} });
  }

  // ---- data ops (RLS enforces permissions) ----
  function me() { return client.auth.getUser().then(function (r) { return r.data.user; }); }

  function ensureProfile(name) {
    return me().then(function (u) {
      if (!u) return null;
      return client.from('profiles').upsert(
        { id: u.id, display_name: name || (u.email || '').split('@')[0] },
        { onConflict: 'id' }
      ).then(function () { return client.from('profiles').select('*').eq('id', u.id).single(); })
        .then(function (r) { return r.data; });
    });
  }

  function myMemberships() {
    return me().then(function (u) {
      if (!u) return [];
      return client.from('memberships')
        .select('id, cell_id, room, role, status, cells(name, code)')
        .eq('user_id', u.id)
        .then(function (r) { return r.data || []; });
    });
  }

  function listCells() {
    return client.from('cells').select('id, name').order('name')
      .then(function (r) { return r.data || []; });
  }

  function requestJoin(cellId, room, displayName) {
    return me().then(function (u) {
      return client.from('memberships').insert({
        user_id: u.id, cell_id: cellId, room: room,
        status: 'pending', role: 'member', display_name: displayName || null
      }).select().single().then(function (r) { return r.data; });
    });
  }

  function cellMembers(cellId) {
    // Note: no profiles() embed — there's no FK memberships->profiles (both point
    // at auth.users), so embedding errors out and returns nothing. The name is
    // already stored on the membership row (display_name) at join time.
    return client.from('memberships')
      .select('id, user_id, room, role, status, display_name, cell_id')
      .eq('cell_id', cellId)
      .order('user_id') // stable order across devices (the rota picks by position)
      .then(function (r) {
        if (r.error) { console.error('cellMembers', r.error.message); return []; }
        return r.data || [];
      });
  }

  // All pending join requests across every cell (RLS lets a superadmin see all;
  // a cell admin only sees their own). Used to catch people who joined the wrong
  // buňka. cells(name) embed is fine — memberships.cell_id -> cells has an FK.
  function allPending() {
    return client.from('memberships')
      .select('id, user_id, room, role, status, display_name, cell_id, cells(name)')
      .eq('status', 'pending')
      .then(function (r) {
        if (r.error) { console.error('allPending', r.error.message); return []; }
        return r.data || [];
      });
  }

  function setMembership(id, patch) {
    return client.from('memberships').update(patch).eq('id', id)
      .then(function (r) { return r; });
  }
  function removeMembership(id) {
    return client.from('memberships').delete().eq('id', id);
  }
  function createCell(name, code) {
    return me().then(function (u) {
      return client.from('cells').insert({ name: name, code: code || null, created_by: u.id })
        .select().single().then(function (r) { return r.data; });
    });
  }
  function myProfile() {
    return me().then(function (u) {
      if (!u) return null;
      return client.from('profiles').select('*').eq('id', u.id).single()
        .then(function (r) { return r.data; });
    });
  }

  // ---- per-cell sync adapter over cell_state (used by the store) ----
  function cellSync(cellId) {
    var pollTimer = null, lastPushedAt = 0, applying = false, statusCb = null;
    var lastAppliedRaw = null;
    function setStatus(s) { if (statusCb) statusCb(s); }
    function pull() {
      return client.from('cell_state').select('data, updated_at').eq('cell_id', cellId).maybeSingle()
        .then(function (r) {
          if (!r.data || !r.data.data) { setStatus('on'); return; }
          var remoteTs = new Date(r.data.updated_at).getTime();
          if (remoteTs <= lastPushedAt + 500) { setStatus('on'); return; }
          // Dedupe: don't re-render every 6s when nothing actually changed.
          var remoteRaw = JSON.stringify(r.data.data);
          if (remoteRaw === JSON.stringify(DORM.store.get()) || remoteRaw === lastAppliedRaw) {
            setStatus('on'); return;
          }
          // Don't let an empty snapshot wipe our populated member list.
          if ((r.data.data.members || []).length === 0 && (DORM.store.get().members || []).length > 0) {
            setStatus('on'); return;
          }
          lastAppliedRaw = remoteRaw;
          applying = true;
          try {
            var lang = DORM.i18n.getLang();
            DORM.store.replaceState(r.data.data);
            DORM.i18n.setLang((r.data.data.settings && r.data.data.settings.lang) || lang);
          } finally { applying = false; }
          setStatus('on');
        }).catch(function () { setStatus('error'); });
    }
    return {
      isOn: function () { return true; },
      onStatus: function (cb) { statusCb = cb; },
      enable: function () {
        setStatus('connecting');
        pull().then(function () { setStatus('on'); });
        pollTimer = setInterval(pull, 6000);
      },
      disable: function () { if (pollTimer) clearInterval(pollTimer); pollTimer = null; },
      pull: pull,
      push: function (state) {
        if (applying) return;
        lastPushedAt = Date.now();
        client.from('cell_state').upsert(
          { cell_id: cellId, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'cell_id' }
        ).then(function (r) { setStatus(r.error ? 'error' : 'on'); })
          .catch(function () { setStatus('error'); });
      }
    };
  }

  DORM.auth = {
    enabled: enabled, init: init, onChange: onChange,
    signIn: signIn, verifyOtp: verifyOtp,
    signUpPassword: signUpPassword, signInPassword: signInPassword,
    resetPassword: resetPassword, updatePassword: updatePassword,
    deleteAccount: deleteAccount,
    signOut: signOut, user: user, me: me,
    ensureProfile: ensureProfile, myProfile: myProfile,
    myMemberships: myMemberships, listCells: listCells, requestJoin: requestJoin,
    cellMembers: cellMembers, allPending: allPending,
    setMembership: setMembership, removeMembership: removeMembership,
    createCell: createCell, cellSync: cellSync,
    hasClient: function () { return !!client; }
  };
})(window.DORM = window.DORM || {});
