/*
 * expenses.js — Splitwise-style shared expenses.
 *
 * "Whoever bought it is owed by the others." Each expense records who paid,
 * how much, and who it was split between. We compute a net balance per person
 * and then simplify it into the fewest "A pays B" transfers.
 */
(function (DORM) {
  'use strict';

  var CATEGORIES = ['cat_hygiene', 'cat_cleaning', 'cat_kitchen', 'cat_other'];

  function round2(n) { return Math.round(n * 100) / 100; }

  /** Net balance per member: positive = is owed money, negative = owes. */
  function balances(state) {
    var bal = {};
    state.members.forEach(function (m) { bal[m.id] = 0; });

    state.expenses.forEach(function (e) {
      var among = (e.split && e.split.length) ? e.split
        : state.members.filter(function (m) { return m.status === 'verified'; })
            .map(function (m) { return m.id; });
      among = among.filter(function (id) { return bal[id] != null; });
      if (among.length === 0) return;
      var share = e.amount / among.length;
      if (bal[e.payer] != null) bal[e.payer] += e.amount;
      among.forEach(function (id) { bal[id] -= share; });
    });

    // Apply manual settlements: `from` paid `to`, reducing debt.
    state.settlements.forEach(function (s) {
      if (bal[s.from] != null) bal[s.from] += s.amount;
      if (bal[s.to] != null) bal[s.to] -= s.amount;
    });

    Object.keys(bal).forEach(function (id) { bal[id] = round2(bal[id]); });
    return bal;
  }

  /** Simplify net balances into minimal transfers [{from,to,amount}]. */
  function settleSuggestions(state) {
    var bal = balances(state);
    var debtors = [], creditors = [];
    Object.keys(bal).forEach(function (id) {
      if (bal[id] < -0.01) debtors.push({ id: id, amt: -bal[id] });
      else if (bal[id] > 0.01) creditors.push({ id: id, amt: bal[id] });
    });
    debtors.sort(function (a, b) { return b.amt - a.amt; });
    creditors.sort(function (a, b) { return b.amt - a.amt; });

    var out = [], i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      var pay = Math.min(debtors[i].amt, creditors[j].amt);
      out.push({ from: debtors[i].id, to: creditors[j].id, amount: round2(pay) });
      debtors[i].amt -= pay;
      creditors[j].amt -= pay;
      if (debtors[i].amt < 0.01) i++;
      if (creditors[j].amt < 0.01) j++;
    }
    return out;
  }

  function addExpense(state, exp) {
    state.expenses.unshift({
      id: DORM.store.uid(),
      payer: exp.payer,
      amount: round2(Number(exp.amount) || 0),
      desc: exp.desc || '',
      category: exp.category || 'cat_other',
      split: exp.split || [],
      ts: Date.now()
    });
  }

  function removeExpense(state, id) {
    state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
  }

  /*
   * A settlement always represents a money transfer `from` -> `to`. The other
   * repayment path from the roadmap ("buy an equivalent thing for everyone")
   * is just a normal shared expense paid by the debtor, so it flows through
   * addExpense() and needs no special record here.
   *
   * Accepts either the legacy positional form (state, from, to, amount) or an
   * options object (state, { from, to, amount, note, proof, proofPath,
   * proofStatus }). Returns the created record so the caller can attach an
   * async proof/verification to it later.
   */
  function recordSettlement(state, from, to, amount) {
    var o = (from && typeof from === 'object') ? from
      : { from: from, to: to, amount: amount };
    var hasProof = !!(o.proof || o.proofPath);
    var rec = {
      id: DORM.store.uid(),
      from: o.from,
      to: o.to,
      amount: round2(Number(o.amount) || 0),
      method: 'transfer',
      note: o.note || '',
      proof: o.proof || '',            // small inline thumbnail (data URL), works offline
      proofPath: o.proofPath || '',    // Storage path when uploaded for AI check
      proofStatus: o.proofStatus || (hasProof ? 'attached' : 'none'),
      ts: Date.now()
    };
    state.settlements.unshift(rec);
    return rec;
  }

  /** Patch fields of an existing settlement (e.g. after AI verification). */
  function updateSettlement(state, id, patch) {
    var rec = (state.settlements || []).filter(function (s) { return s.id === id; })[0];
    if (rec) Object.keys(patch || {}).forEach(function (k) { rec[k] = patch[k]; });
    return rec;
  }

  function removeSettlement(state, id) {
    state.settlements = (state.settlements || []).filter(function (s) { return s.id !== id; });
  }

  DORM.expenses = {
    CATEGORIES: CATEGORIES,
    balances: balances,
    settleSuggestions: settleSuggestions,
    addExpense: addExpense,
    removeExpense: removeExpense,
    recordSettlement: recordSettlement,
    updateSettlement: updateSettlement,
    removeSettlement: removeSettlement,
    round2: round2
  };
})(window.DORM = window.DORM || {});
