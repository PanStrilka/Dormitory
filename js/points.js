/*
 * points.js — karma, tiers and immunity tokens.
 *
 * Points come from three places:
 *   1. Completed checklist items on duty weeks (duties.POINTS by frequency).
 *   2. Buying supplies for the cell (+5 karma per expense the person paid).
 *   3. Manual karma adjustments (e.g. spending an immunity token = -cost).
 * Tiers and tokens are derived from the total, giving the "motivation +
 * privileges" the brief asked for.
 */
(function (DORM) {
  'use strict';

  var BUY_KARMA = 5;      // karma for buying something for the cell
  var TOKEN_COST = 50;    // points that buy one immunity token
  var TIERS = [
    { id: 'tier_platinum', min: 250, badge: '💎' },
    { id: 'tier_gold', min: 120, badge: '🏆' },
    { id: 'tier_silver', min: 50, badge: '🥈' },
    { id: 'tier_bronze', min: 0, badge: '🥉' }
  ];

  /** Points earned from completed duty checklists. */
  function dutyPoints(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    Object.keys(state.completions).forEach(function (k) {
      var c = state.completions[k];
      if (!c || !c.by || out[c.by] == null) return;
      var roleId = k.split('|')[1];
      var items = c.items || {};
      DORM.duties.TASKS.forEach(function (t) {
        if (items[t.id]) {
          // only count if the task belongs to this role's zone
          var role = DORM.duties.ROLES.filter(function (r) { return r.id === roleId; })[0];
          if (role && role.zone === t.zone) {
            out[c.by] += DORM.duties.POINTS[t.freq] || 0;
          }
        }
      });
    });
    return out;
  }

  /** Karma from buying supplies. */
  function buyKarma(state) {
    var out = {};
    state.members.forEach(function (m) { out[m.id] = 0; });
    state.expenses.forEach(function (e) {
      if (out[e.payer] != null) out[e.payer] += BUY_KARMA;
    });
    return out;
  }

  /** Total points per member (duties + buying + manual adjustments). */
  function totals(state) {
    var dp = dutyPoints(state);
    var bk = buyKarma(state);
    var out = {};
    state.members.forEach(function (m) {
      out[m.id] = (dp[m.id] || 0) + (bk[m.id] || 0) + (state.karma[m.id] || 0);
    });
    return out;
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

  /** Ranked leaderboard rows. */
  function leaderboard(state) {
    var tot = totals(state);
    return state.members.map(function (m) {
      var pts = tot[m.id] || 0;
      return {
        member: m,
        points: pts,
        tier: tierFor(pts),
        tokens: tokensAvailable(state, m.id)
      };
    }).sort(function (a, b) { return b.points - a.points; });
  }

  DORM.points = {
    BUY_KARMA: BUY_KARMA,
    TOKEN_COST: TOKEN_COST,
    TIERS: TIERS,
    totals: totals,
    tierFor: tierFor,
    tokensAvailable: tokensAvailable,
    leaderboard: leaderboard
  };
})(window.DORM = window.DORM || {});
