/*
 * settleproof.js — optional AI check of a bank-transfer proof photo.
 *
 * The debt-repayment feature works fully offline: a downscaled thumbnail of
 * the proof is stored inside the settlement record (see ui.js) so anyone can
 * open it. THIS module is purely additive — when Supabase sync is configured
 * it also uploads the full photo to the private `receipts` bucket and asks the
 * `verify-transfer` Edge Function whether it looks like a genuine bank
 * confirmation for the expected amount. It mirrors receipts.js exactly.
 *
 * With no sync configured, upload() rejects with 'no-sync' and the caller
 * simply keeps the local thumbnail with status 'attached'.
 */
(function (DORM) {
  'use strict';

  function cfg() {
    var s = DORM.store.get().settings.sync;
    return (s && s.url && s.key) ? { url: s.url.replace(/\/$/, ''), key: s.key } : null;
  }
  function hdr(c, extra) {
    var h = { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function ext(file) {
    var m = (file.type || '').split('/')[1] || 'jpg';
    return m === 'jpeg' ? 'jpg' : m;
  }

  /**
   * Upload the proof photo, register a `transfers` row, then call the
   * verify-transfer function. Resolves with { ok, verdict, reason, path } where
   * verdict is 'verified' | 'rejected' | 'unclear'.
   */
  function upload(settlementId, amount, currency, file) {
    var c = cfg();
    if (!c) return Promise.reject(new Error('no-sync'));
    var path = 'transfer-' + settlementId + '-' + DORM.store.uid() + '.' + ext(file);

    return fetch(c.url + '/storage/v1/object/receipts/' + encodeURIComponent(path), {
      method: 'POST',
      headers: hdr(c, { 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' }),
      body: file
    }).then(function (r) {
      if (!r.ok) throw new Error('upload-failed');
      return fetch(c.url + '/rest/v1/transfers', {
        method: 'POST',
        headers: hdr(c, { 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
        body: JSON.stringify([{
          settlement_id: settlementId, amount: amount, currency: currency || 'CZK',
          storage_path: path, status: 'pending'
        }])
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('register-failed');
      return r.json();
    }).then(function (rows) {
      var id = rows && rows[0] && rows[0].id;
      if (!id) throw new Error('no-id');
      return fetch(c.url + '/functions/v1/verify-transfer', {
        method: 'POST',
        headers: hdr(c, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ transfer_id: id })
      }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (res) { res.path = path; return res; });
    });
  }

  function enabled() { return !!cfg(); }

  DORM.settleproof = { upload: upload, enabled: enabled };
})(window.DORM = window.DORM || {});
