/*
 * shopping.js — shared shopping list + supplies inventory.
 *
 * Items tracked by the flat (soap, toilet paper, sponges…). Each item is
 * either 'ok' (in stock) or 'needed' (someone flagged it as run out). When
 * someone buys it, we mark it 'ok', log the purchase (for fairness + the
 * activity feed) and optionally create an expense so the cost is settled
 * through the normal "who owes whom".
 */
(function (DORM) {
  'use strict';

  // Common supplies for one-tap adding. `key` localizes via i18n; `cat` maps
  // to an expense category.
  var COMMON = [
    { key: 'sup_soap', cat: 'cat_hygiene' },
    { key: 'sup_tp', cat: 'cat_hygiene' },
    { key: 'sup_towels', cat: 'cat_hygiene' },
    { key: 'sup_sponge', cat: 'cat_cleaning' },
    { key: 'sup_dish', cat: 'cat_cleaning' },
    { key: 'sup_cleaner', cat: 'cat_cleaning' },
    { key: 'sup_bags', cat: 'cat_cleaning' },
    { key: 'sup_wipes', cat: 'cat_kitchen' },
    { key: 'sup_detergent', cat: 'cat_other' }
  ];

  function items(state) { return state.shopping || (state.shopping = []); }

  function addItem(state, opts) {
    var it = {
      id: DORM.store.uid(),
      category: opts.category || 'cat_other',
      status: opts.status || 'needed',
      flaggedBy: opts.by || null,
      flaggedTs: Date.now(),
      lastBoughtBy: null,
      lastBoughtTs: null
    };
    if (opts.key) it.key = opts.key; else it.name = opts.name || '';
    items(state).unshift(it);
    return it;
  }

  /** Add a common item only if it isn't already tracked. Returns the item. */
  function addCommon(state, key, by) {
    var existing = items(state).filter(function (i) { return i.key === key; })[0];
    if (existing) { existing.status = 'needed'; existing.flaggedBy = by || null; existing.flaggedTs = Date.now(); return existing; }
    var def = COMMON.filter(function (c) { return c.key === key; })[0];
    return addItem(state, { key: key, category: def ? def.cat : 'cat_other', by: by, status: 'needed' });
  }

  function setStatus(state, id, status, by) {
    var it = items(state).filter(function (i) { return i.id === id; })[0];
    if (!it) return;
    it.status = status;
    if (status === 'needed') { it.flaggedBy = by || null; it.flaggedTs = Date.now(); }
  }

  function removeItem(state, id) {
    state.shopping = items(state).filter(function (i) { return i.id !== id; });
  }

  /**
   * Mark an item bought. Logs the purchase; if amount > 0, also records an
   * expense (payer = buyer) so it flows into the balances.
   */
  function markBought(state, id, buyerId, amount) {
    var it = items(state).filter(function (i) { return i.id === id; })[0];
    if (!it) return;
    it.status = 'ok';
    it.lastBoughtBy = buyerId || null;
    it.lastBoughtTs = Date.now();

    var expenseId = null;
    if (amount && Number(amount) > 0) {
      var name = it.key ? DORM.i18n.t(it.key) : (it.name || '');
      // split [] = shared among all verified members (supplies are for everyone)
      DORM.expenses.addExpense(state, {
        payer: buyerId, amount: amount, desc: name, category: it.category, split: []
      });
      expenseId = state.expenses[0] && state.expenses[0].id;
    }
    (state.purchases || (state.purchases = [])).unshift({
      id: DORM.store.uid(), item: it.key ? DORM.i18n.t(it.key) : it.name,
      by: buyerId || null, ts: Date.now(), expenseId: expenseId
    });
    if (state.purchases.length > 300) state.purchases.length = 300;
  }

  function needed(state) {
    return items(state).filter(function (i) { return i.status === 'needed'; });
  }
  function inStock(state) {
    return items(state).filter(function (i) { return i.status === 'ok'; });
  }

  /** How many purchases each member has made (fairness). */
  function buyCounts(state) {
    var out = {};
    (state.members || []).forEach(function (m) { out[m.id] = 0; });
    (state.purchases || []).forEach(function (p) {
      if (p.by && out[p.by] != null) out[p.by] += 1;
    });
    return out;
  }

  function displayName(item) {
    return item.key ? DORM.i18n.t(item.key) : (item.name || '');
  }

  DORM.shopping = {
    COMMON: COMMON,
    addItem: addItem, addCommon: addCommon, setStatus: setStatus, removeItem: removeItem,
    markBought: markBought, needed: needed, inStock: inStock, buyCounts: buyCounts,
    displayName: displayName
  };
})(window.DORM = window.DORM || {});
