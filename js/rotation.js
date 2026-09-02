/*
 * rotation.js — who is on duty, for every role and every week.
 *
 * Design goals (from the brief):
 *  - Each room's 4 members take turns on their own room; the 8 share the cell.
 *  - Nobody is responsible for everything at once — room duty and shared duty
 *    rotate on offset cycles so the same person rarely draws both in one week.
 *  - Fully deterministic from the start date, so every phone shows the same
 *    rota without a server. Manual swaps are stored as overrides on top.
 *  - Fairness is measurable: we count how often each person actually served.
 */
(function (DORM) {
  'use strict';

  function membersOf(state, scope) {
    var list = state.members.slice();
    if (scope === 'roomA') return list.filter(function (m) { return m.room === 'A'; });
    if (scope === 'roomB') return list.filter(function (m) { return m.room === 'B'; });
    return list; // all
  }

  function mod(i, n) { return ((i % n) + n) % n; }

  /** Rotate a room's members; offset keeps the two rooms out of phase. */
  function roomAssignee(pool, weekIdx, offset) {
    if (!pool.length) return null;
    return pool[mod(weekIdx + offset, pool.length)];
  }

  /** Deterministic assignee before any manual override. */
  function baseAssignee(state, roleId, weekIdx) {
    var role = DORM.duties.ROLES.filter(function (r) { return r.id === roleId; })[0];
    if (!role) return null;

    if (role.scope === 'roomA') return roomAssignee(membersOf(state, 'roomA'), weekIdx, 0);
    if (role.scope === 'roomB') return roomAssignee(membersOf(state, 'roomB'), weekIdx, 2);

    // Shared cell (kitchen / bathroom): pick from people who are NOT on room
    // duty this week, so nobody is stuck with a room AND the shared space in
    // the same week. Two distinct slots rotate through the remaining pool.
    var all = membersOf(state, 'all');
    if (all.length === 0) return null;
    var a = roomAssignee(membersOf(state, 'roomA'), weekIdx, 0);
    var b = roomAssignee(membersOf(state, 'roomB'), weekIdx, 2);
    var remaining = all.filter(function (m) {
      return (!a || m.id !== a.id) && (!b || m.id !== b.id);
    });
    if (remaining.length === 0) remaining = all; // tiny-flat fallback
    var slot = (roleId === 'KITCHEN') ? 0 : 1;
    return remaining[mod(weekIdx * 2 + slot, remaining.length)];
  }

  function key(weekKey, roleId) { return weekKey + '|' + roleId; }

  /** Final assignee = manual override if present, else the base rotation. */
  function assignee(state, roleId, date) {
    var wk = DORM.store.isoWeekKey(date);
    var ov = state.overrides[key(wk, roleId)];
    if (ov) {
      var m = state.members.filter(function (x) { return x.id === ov; })[0];
      if (m) return m;
    }
    return baseAssignee(state, roleId, DORM.store.weekIndex(date));
  }

  /** Full roster for one week: [{ role, member, isMonthlyWeek }]. */
  function rosterForWeek(state, date) {
    var monthly = DORM.store.isMonthlyWeek(date);
    return DORM.duties.ROLES.map(function (role) {
      return {
        roleId: role.id,
        icon: role.icon,
        member: assignee(state, role.id, date),
        isMonthlyWeek: monthly
      };
    });
  }

  /**
   * Record a hand-over. `toId` becomes the assignee for that week+role.
   * Passing null clears the override (back to the fair default).
   */
  function setOverride(state, date, roleId, toId, note) {
    var wk = DORM.store.isoWeekKey(date);
    var k = key(wk, roleId);
    var from = assignee(state, roleId, date);
    if (toId) state.overrides[k] = toId; else delete state.overrides[k];
    state.swaps.unshift({
      id: DORM.store.uid(),
      week: wk, role: roleId,
      from: from ? from.id : null,
      to: toId || null,
      note: note || '',
      ts: Date.now()
    });
    if (state.swaps.length > 200) state.swaps.length = 200;
  }

  /**
   * Fairness snapshot over a window of weeks around `date`.
   * Counts scheduled duties per member (what the rota asks of them) so the
   * UI can show that the load is even. Returns { memberId: count }.
   */
  function fairnessCounts(state, date, weeksBack) {
    weeksBack = weeksBack || 12;
    var counts = {};
    state.members.forEach(function (m) { counts[m.id] = 0; });
    var idx = DORM.store.weekIndex(date);
    for (var w = idx - weeksBack + 1; w <= idx; w++) {
      var d = DORM.store.dateFromWeekIndex(w);
      rosterForWeek(state, d).forEach(function (slot) {
        if (slot.member && counts[slot.member.id] != null) {
          counts[slot.member.id] += 1;
        }
      });
    }
    return counts;
  }

  DORM.rotation = {
    baseAssignee: baseAssignee,
    assignee: assignee,
    rosterForWeek: rosterForWeek,
    setOverride: setOverride,
    fairnessCounts: fairnessCounts,
    key: key
  };
})(window.DORM = window.DORM || {});
