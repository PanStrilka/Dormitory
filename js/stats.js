/*
 * stats.js — monthly summaries and a unified activity feed.
 * Pure computation over the existing state (no backend). The UI formats the
 * raw events; this module only crunches numbers and merges timelines.
 */
(function (DORM) {
  'use strict';

  function sameMonth(ts, ref) {
    if (!ts) return false;
    var d = new Date(ts);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  }

  function zoneOfRole(roleId) {
    var r = DORM.duties.ROLES.filter(function (x) { return x.id === roleId; })[0];
    return r ? r.zone : null;
  }

  /** Count of checklist tasks each person completed in `ref`'s month. */
  function dutiesThisMonth(state, ref) {
    ref = ref || new Date();
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    Object.keys(state.completions).forEach(function (k) {
      var c = state.completions[k];
      if (!c || !c.by || out[c.by] == null) return;
      if (!sameMonth(c.ts, ref)) return;
      var zone = zoneOfRole(k.split('|')[1]);
      var items = c.items || {};
      DORM.duties.TASKS.forEach(function (task) {
        if (items[task.id] && task.zone === zone) out[c.by] += 1;
      });
    });
    return out;
  }

  /** Swaps given (handed away) and taken (received) per member, all-time. */
  function swapCounts(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = { given: 0, taken: 0 }; });
    (state.swaps || []).forEach(function (s) {
      if (s.from && out[s.from]) out[s.from].given += 1;
      if (s.to && out[s.to]) out[s.to].taken += 1;
    });
    return out;
  }

  /** Spending in `ref`'s month: total + per category. */
  function spendingThisMonth(state, ref) {
    ref = ref || new Date();
    var total = 0, byCat = {};
    (state.expenses || []).forEach(function (e) {
      if (!sameMonth(e.ts, ref)) return;
      total += e.amount || 0;
      byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0);
    });
    return { total: Math.round(total * 100) / 100, byCat: byCat };
  }

  /** Merged, newest-first activity events (raw; UI formats text). */
  function activity(state, limit) {
    var ev = [];
    Object.keys(state.completions).forEach(function (k) {
      var c = state.completions[k];
      if (!c || !c.ts) return;
      var n = Object.keys(c.items || {}).length;
      ev.push({ ts: c.ts, type: 'duty', by: c.by, role: k.split('|')[1], count: n });
    });
    (state.swaps || []).forEach(function (s) {
      ev.push({ ts: s.ts, type: 'swap', from: s.from, to: s.to, role: s.role, note: s.note });
    });
    (state.expenses || []).forEach(function (e) {
      ev.push({ ts: e.ts, type: 'expense', payer: e.payer, amount: e.amount, desc: e.desc });
    });
    (state.settlements || []).forEach(function (s) {
      ev.push({ ts: s.ts, type: 'settle', from: s.from, to: s.to, amount: s.amount });
    });
    (state.purchases || []).forEach(function (p) {
      ev.push({ ts: p.ts, type: 'buy', by: p.by, item: p.item });
    });
    var expDesc = {};
    (state.expenses || []).forEach(function (e) { expDesc[e.id] = e.desc; });
    (state.comments || []).forEach(function (c) {
      ev.push({ ts: c.ts, type: 'comment', by: c.by, desc: expDesc[c.expenseId] || '', text: c.text });
    });
    ev.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return ev.slice(0, limit || 15);
  }

  DORM.stats = {
    dutiesThisMonth: dutiesThisMonth,
    swapCounts: swapCounts,
    spendingThisMonth: spendingThisMonth,
    activity: activity
  };
})(window.DORM = window.DORM || {});
