/*
 * points.js — points, tiers and immunity tokens.
 *
 * Points come from:
 *   1. Completed checklist items on duty weeks (duties.POINTS by frequency).
 *   2. Manual adjustments (e.g. spending an immunity token = -cost).
 * Buying supplies is handled purely in Expenses ("who owes whom") — no points
 * for it, so nothing pretends to "give money back" outside the settlement.
 * Tiers and tokens are derived from the total, for motivation + privileges.
 */
(function (DORM) {
  'use strict';

  var TOKEN_COST = 50;    // points that buy one immunity token
  var PURCHASE_POINTS = 3; // points for buying supplies (fronting money + effort)
  var MONTHLY_MULT = 2;   // the hard "big clean" (monthly) week counts double
  var TIERS = [
    { id: 'tier_platinum', min: 250, badge: '💎' },
    { id: 'tier_gold', min: 120, badge: '🏆' },
    { id: 'tier_silver', min: 50, badge: '🥈' },
    { id: 'tier_bronze', min: 0, badge: '🥉' }
  ];

  // Any date inside the ISO week named "YYYY-Www" (to test the monthly ×2 week).
  function weekDateFromKey(wk) {
    var p = String(wk).split('-W');
    var year = +p[0], week = +p[1];
    var simple = new Date(year, 0, 1 + (week - 1) * 7);
    var dow = simple.getDay() || 7;
    simple.setDate(simple.getDate() - (dow - 1) + 3);
    return simple;
  }

  /** Points earned from completed duty checklists (monthly week ×2). */
  function dutyPoints(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    Object.keys(state.completions).forEach(function (k) {
      var c = state.completions[k];
      if (!c || !c.by || out[c.by] == null) return;
      var roleId = k.split('|')[1];
      var items = c.items || {};
      var mult = DORM.store.isMonthlyWeek(weekDateFromKey(k.split('|')[0])) ? MONTHLY_MULT : 1;
      var role = DORM.duties.ROLES.filter(function (r) { return r.id === roleId; })[0];
      DORM.duties.TASKS.forEach(function (t) {
        if (!items[t.id]) return;
        // 'ALL' (simple mode) credits every task; a room role only its own zone.
        if (roleId === 'ALL' || (role && role.zone === t.zone)) {
          out[c.by] += (DORM.duties.POINTS[t.freq] || 0) * mult;
        }
      });
    });
    return out;
  }

  /** Points for buying supplies for the flat (logged purchases). */
  function purchasePoints(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    (state.purchases || []).forEach(function (p) {
      if (p && p.by && out[p.by] != null) out[p.by] += PURCHASE_POINTS;
    });
    return out;
  }

  /** Total points per member (duties ×monthly + shopping + manual karma). */
  function totals(state) {
    var dp = dutyPoints(state);
    var pp = purchasePoints(state);
    var out = {};
    state.members.forEach(function (m) {
      out[m.id] = (dp[m.id] || 0) + (pp[m.id] || 0) + (state.karma[m.id] || 0);
    });
    return out;
  }

  // Did member m fully complete their duty in the ISO week of `date`?
  // Returns { onDuty, done }.
  function weekDutyStatus(state, date, memberId) {
    var roster = DORM.rotation.rosterForWeek(state, date);
    var slot = null;
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].member && roster[i].member.id === memberId) { slot = roster[i]; break; }
    }
    if (!slot) return { onDuty: false, done: false };
    var wk = DORM.store.isoWeekKey(date);
    var tasks = DORM.duties.tasksForRole(slot.roleId, DORM.store.isMonthlyWeek(date));
    var comp = state.completions[wk + '|' + slot.roleId] || { items: {} };
    var done = tasks.length > 0 && tasks.every(function (x) { return comp.items[x.id]; });
    return { onDuty: true, done: done };
  }

  /**
   * Duty streak: how many of the member's most-recent duty weeks were finished
   * 100%, counting back until the first miss. The current week counts only if
   * already finished (an unfinished current week doesn't break the streak).
   */
  function streakFor(state, memberId) {
    var streak = 0, seen = 0;
    for (var i = 0; i < 60 && seen < 26; i++) {
      var d = new Date(); d.setDate(d.getDate() - i * 7);
      var s = weekDutyStatus(state, d, memberId);
      if (!s.onDuty) continue;
      if (i === 0 && !s.done) continue; // current week still in progress
      seen++;
      if (s.done) streak++; else break;
    }
    return streak;
  }

  function streaks(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = streakFor(state, m.id); });
    return out;
  }

  /** Points earned in a given calendar month (for the monthly "hero"). */
  function pointsInMonth(state, year, month) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    function inMonth(ts) { if (!ts) return false; var d = new Date(ts); return d.getFullYear() === year && d.getMonth() === month; }
    Object.keys(state.completions).forEach(function (k) {
      var c = state.completions[k];
      if (!c || !c.by || out[c.by] == null || !inMonth(c.ts)) return;
      var roleId = k.split('|')[1];
      var mult = DORM.store.isMonthlyWeek(weekDateFromKey(k.split('|')[0])) ? MONTHLY_MULT : 1;
      var role = DORM.duties.ROLES.filter(function (r) { return r.id === roleId; })[0];
      DORM.duties.TASKS.forEach(function (t) {
        if (!(c.items || {})[t.id]) return;
        if (roleId === 'ALL' || (role && role.zone === t.zone)) out[c.by] += (DORM.duties.POINTS[t.freq] || 0) * mult;
      });
    });
    (state.purchases || []).forEach(function (p) {
      if (p && p.by && out[p.by] != null && inMonth(p.ts)) out[p.by] += PURCHASE_POINTS;
    });
    return out;
  }

  /** The current calendar month's leader + reward amount, or null. */
  function monthlyHero(state) {
    var now = new Date();
    var pm = pointsInMonth(state, now.getFullYear(), now.getMonth());
    var best = null;
    (state.members || []).filter(function (m) { return m.status === 'verified'; }).forEach(function (m) {
      var p = pm[m.id] || 0;
      if (p > 0 && (!best || p > best.points)) best = { member: m, points: p };
    });
    if (!best) return null;
    var reward = (state.settings && state.settings.monthlyReward != null) ? state.settings.monthlyReward : 100;
    var currency = (state.settings && state.settings.currency) || 'CZK';
    return { member: best.member, points: best.points, reward: reward, currency: currency };
  }

  function tierFor(points) {
    for (var i = 0; i < TIERS.length; i++) {
      if (points >= TIERS[i].min) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  /** Immunity tokens available now = earned − used. */
  function tokensAvailable(state, memberId) {
    var pts = totals(state)[memberId] || 0;
    var earned = Math.floor(pts / TOKEN_COST);
    var used = state.tokensUsed[memberId] || 0;
    return Math.max(0, earned - used);
  }

  /** Ranked leaderboard rows (verified members only). */
  function leaderboard(state) {
    var tot = totals(state);
    var stk = streaks(state);
    return state.members.filter(function (m) { return m.status === 'verified'; }).map(function (m) {
      var pts = tot[m.id] || 0;
      return {
        member: m,
        points: pts,
        tier: tierFor(pts),
        tokens: tokensAvailable(state, m.id),
        streak: stk[m.id] || 0
      };
    }).sort(function (a, b) { return b.points - a.points; });
  }

  DORM.points = {
    TOKEN_COST: TOKEN_COST,
    PURCHASE_POINTS: PURCHASE_POINTS,
    MONTHLY_MULT: MONTHLY_MULT,
    TIERS: TIERS,
    totals: totals,
    tierFor: tierFor,
    tokensAvailable: tokensAvailable,
    leaderboard: leaderboard,
    streakFor: streakFor,
    streaks: streaks,
    monthlyHero: monthlyHero,
    pointsInMonth: pointsInMonth
  };
})(window.DORM = window.DORM || {});
