/*
 * comments.js — short comments attached to a purchase (an expense).
 *
 * "React to what your flatmates bought." Each comment references an expense
 * id and is stored in one flat `state.comments` array so it merges cleanly
 * through the store's shallow migrate and syncs with everything else.
 * Unread tracking is per-device and lives in localStorage (see ui.js), not
 * here — this module only owns the shared data.
 */
(function (DORM) {
  'use strict';

  function add(state, expenseId, by, text) {
    var body = (text || '').trim();
    if (!expenseId || !body) return null;
    var c = {
      id: DORM.store.uid(),
      expenseId: expenseId,
      by: by || null,
      text: body.slice(0, 1000),
      ts: Date.now()
    };
    if (!state.comments) state.comments = [];
    state.comments.push(c);
    return c;
  }

  function remove(state, id) {
    state.comments = (state.comments || []).filter(function (c) { return c.id !== id; });
  }

  /** Drop all comments for an expense (called when the expense is deleted). */
  function removeForExpense(state, expenseId) {
    state.comments = (state.comments || []).filter(function (c) { return c.expenseId !== expenseId; });
  }

  /** Comments for one expense, oldest-first (chat order). */
  function forExpense(state, expenseId) {
    return (state.comments || [])
      .filter(function (c) { return c.expenseId === expenseId; })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }

  function count(state, expenseId) {
    return (state.comments || []).filter(function (c) { return c.expenseId === expenseId; }).length;
  }

  DORM.comments = {
    add: add,
    remove: remove,
    removeForExpense: removeForExpense,
    forExpense: forExpense,
    count: count
  };
})(window.DORM = window.DORM || {});
