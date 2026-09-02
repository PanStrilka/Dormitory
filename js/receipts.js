/*
 * receipts.js — attach a receipt photo to an expense and get it parsed.
 *
 * Flow (all against Supabase, so it needs sync configured):
 *   1. upload the photo to the private `receipts` Storage bucket
 *   2. insert a `receipts` row (status 'pending')
 *   3. call the `parse-receipt` Edge Function, which fills `receipt_items`
 *      on success or marks the row 'failed' (photo kept for retry) on error
 *
 * Everything degrades gracefully: with no sync configured, attach() rejects
 * with 'no-sync' and the caller just keeps the plain expense.
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

  /** Upload + register + parse. Returns the Edge Function's JSON result. */
  function attach(expenseId, payer, amount, file) {
    var c = cfg();
    if (!c) return Promise.reject(new Error('no-sync'));
    var path = expenseId + '-' + DORM.store.uid() + '.' + ext(file);

    // 1) upload the photo (upsert so a retry with the same path is fine)
    return fetch(c.url + '/storage/v1/object/receipts/' + encodeURIComponent(path), {
      method: 'POST',
      headers: hdr(c, { 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' }),
      body: file
    }).then(function (r) {
      if (!r.ok) throw new Error('upload-failed');
      // 2) register the receipt row, return the new id
      return fetch(c.url + '/rest/v1/receipts', {
        method: 'POST',
        headers: hdr(c, { 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
        body: JSON.stringify([{
          expense_id: expenseId, payer: payer, amount: amount,
          storage_path: path, status: 'pending'
        }])
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('register-failed');
      return r.json();
    }).then(function (rows) {
      var id = rows && rows[0] && rows[0].id;
      if (!id) throw new Error('no-id');
      // 3) ask the Edge Function to read it
      return fetch(c.url + '/functions/v1/parse-receipt', {
        method: 'POST',
        headers: hdr(c, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ receipt_id: id })
      }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
    });
  }

  /** Receipts (+ their parsed items) for one expense. */
  function forExpense(expenseId) {
    var c = cfg();
    if (!c) return Promise.resolve([]);
    var url = c.url + '/rest/v1/receipts?expense_id=eq.' + encodeURIComponent(expenseId) +
      '&select=id,status,ai_error,amount,receipt_items(name,qty,unit_price,total)';
    return fetch(url, { headers: hdr(c) })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }

  function enabled() { return !!cfg(); }

  DORM.receipts = { attach: attach, forExpense: forExpense, enabled: enabled };
})(window.DORM = window.DORM || {});
