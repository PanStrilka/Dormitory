/*
 * ui.js — rendering and interaction for all tabs.
 * Vanilla DOM + event delegation, no framework. Every render reads the
 * current store state, so any change re-renders the active tab.
 */
(function (DORM) {
  'use strict';

  var t = DORM.i18n.t;
  var S = DORM.store;
  var state = function () { return S.get(); };

  var currentTab = 'today';
  var profileSub = 'leaderboard'; // sub-view inside the Profile hub
  var viewDate = new Date();      // for roster navigation
  var modalEl, mainEl;

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function member(id) {
    return state().members.filter(function (m) { return m.id === id; })[0] || null;
  }
  function verified() {
    return state().members.filter(function (m) { return m.status === 'verified'; });
  }
  function pending() {
    return state().members.filter(function (m) { return m.status === 'pending'; });
  }
  function initials(name) {
    var p = (name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function avatar(m, size) {
    if (!m) return '<span class="avatar empty" style="width:' + size + 'px;height:' + size +
      'px">?</span>';
    return '<span class="avatar" title="' + esc(m.name) + '" style="width:' + size +
      'px;height:' + size + 'px;background:' + esc(m.color) + '">' + esc(initials(m.name)) +
      '</span>';
  }
  function money(n) {
    return DORM.expenses.round2(n).toLocaleString('cs-CZ') + ' ' + esc(state().settings.currency);
  }
  // Downscale an image File to a small JPEG data URL so a proof photo can be
  // kept inline in the state (works offline, syncs across phones). Resolves
  // null on any error or a non-image.
  function downscaleImage(file, maxDim, quality) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type || '')) { resolve(null); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var scale = Math.min(1, (maxDim || 800) / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL('image/jpeg', quality || 0.55));
        } catch (e) { resolve(null); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // ---- comment unread tracking (per device, not synced) ----
  var CSEEN_KEY = 'bulka_comments_seen';
  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(CSEEN_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markSeen(expenseId) {
    var list = DORM.comments.forExpense(state(), expenseId);
    var newest = list.length ? list[list.length - 1].ts : Date.now();
    var m = loadSeen();
    if ((m[expenseId] || 0) < newest) { m[expenseId] = newest; }
    try { localStorage.setItem(CSEEN_KEY, JSON.stringify(m)); } catch (e) {}
  }
  // A thread is "unread" when its newest comment is not mine and newer than
  // what this device last saw.
  function isUnread(expenseId) {
    var list = DORM.comments.forExpense(state(), expenseId);
    if (!list.length) return false;
    var last = list[list.length - 1];
    var me = state().settings.me;
    if (me && last.by === me) return false;
    return last.ts > (loadSeen()[expenseId] || 0);
  }
  function anyUnread() {
    return (state().expenses || []).some(function (e) { return isUnread(e.id); });
  }
  function prefersReducedMotion() {
    try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  // Confetti burst from a point (x,y). Used when a duty checklist hits 100%.
  function celebrate(x, y) {
    if (prefersReducedMotion()) return;
    var fx = document.getElementById('fx');
    if (!fx) return;
    var emojis = ['🎉', '✨', '🧽', '⭐', '💚', '🫧'];
    var ox = x != null ? x : window.innerWidth / 2;
    var oy = y != null ? y : window.innerHeight / 2;
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('span');
      s.className = 'confetti';
      s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      var ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 130;
      s.style.left = ox + 'px';
      s.style.top = oy + 'px';
      s.style.setProperty('--x', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--y', (Math.sin(ang) * dist - 50) + 'px');
      s.style.setProperty('--r', (Math.random() * 360 - 180) + 'deg');
      s.style.animationDelay = (Math.random() * 0.08).toFixed(2) + 's';
      fx.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 1100); })(s);
    }
  }

  function roleName(id) {
    var rn = state().settings.roomNames || {};
    if (id === 'ROOM_A') return rn.A || t('role_ROOM_A');
    if (id === 'ROOM_B') return rn.B || t('role_ROOM_B');
    return t('role_' + id);
  }
  function roomLabel(code) {
    var rn = state().settings.roomNames || {};
    return (code === 'A' ? rn.A : rn.B) || t(code === 'A' ? 'set_room_a' : 'set_room_b');
  }

  // ---------- theme (system / light / dark), stored per device ----------
  var THEME_KEY = 'bulka_theme';
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
  }
  function updateThemeBtn() {
    var b = document.getElementById('themeBtn');
    if (!b) return;
    var mode = getTheme();
    b.textContent = mode === 'light' ? '☀️' : mode === 'dark' ? '🌙' : '🌓';
    b.title = t('theme_label') + ': ' + t('theme_' + mode);
  }

  // ---------- top-level render ----------
  function render() {
    if (!mainEl) return;
    document.getElementById('appName').textContent = t('app_name');
    document.getElementById('appTagline').textContent = t('app_tagline');
    renderTabs();
    renderMePicker();
    updateThemeBtn();
    if (currentTab === 'today') mainEl.innerHTML = renderToday();
    else if (currentTab === 'roster') mainEl.innerHTML = renderRoster();
    else if (currentTab === 'expenses') mainEl.innerHTML = renderExpenses();
    else if (currentTab === 'shopping') mainEl.innerHTML = renderShopping();
    else if (currentTab === 'profile') mainEl.innerHTML = renderProfile();
  }

  function renderTabs() {
    var tabs = [
      ['today', t('tab_today'), '🏠'],
      ['roster', t('nav_roster'), '🧹'],
      ['shopping', t('tab_shopping'), '🛒'],
      ['expenses', t('tab_expenses'), '💰'],
      ['profile', t('tab_profile'), '👤']
    ];
    var expUnread = anyUnread();
    document.getElementById('nav').innerHTML = tabs.map(function (x) {
      var active = currentTab === x[0];
      var dot = (x[0] === 'expenses' && expUnread) ? '<span class="dot"></span>' : '';
      return '<button class="tab' + (active ? ' active' : '') + '" data-tab="' + x[0] +
        '" aria-current="' + (active ? 'page' : 'false') + '">' +
        '<span class="ti">' + x[2] + dot + '</span><span class="tl">' + esc(x[1]) + '</span></button>';
    }).join('');
  }

  function renderMePicker() {
    var box = document.getElementById('mePicker');
    if (!box) return;
    var ms = verified();
    if (!ms.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<select id="meSelect" title="I am"><option value="">👤 ?</option>' +
      ms.map(function (m) {
        return '<option value="' + m.id + '"' +
          (state().settings.me === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
      }).join('') + '</select>';
  }

  // ---------- TODAY ----------
  function renderToday() {
    var st = state();
    if (!verified().length) return emptyHint();
    var roster = DORM.rotation.rosterForWeek(st, viewDateToday());
    var monthly = DORM.store.isMonthlyWeek(viewDateToday());
    var wk = DORM.store.isoWeekKey(viewDateToday());

    var html = '<section class="card head-card"><div class="row between">' +
      '<div><div class="muted">' + t('today_title') + '</div>' +
      '<h2>' + t('week_label') + ' ' + esc(wk.split('-W')[1]) + ' · ' +
      esc(DORM.store.weekRange(viewDateToday())) + '</h2></div></div>' +
      (monthly ? '<div class="badge month">🧽 ' + t('monthly_week_badge') + '</div>' : '') +
      '</section>';

    html += roster.map(function (slot) { return dutyCard(slot, wk); }).join('');
    return html;
  }

  function viewDateToday() { return new Date(); }

  function dutyCard(slot, wk) {
    var st = state();
    var isMine = slot.member && st.settings.me && slot.member.id === st.settings.me;
    var tasks = DORM.duties.tasksForRole(slot.roleId, slot.isMonthlyWeek);
    var comp = st.completions[wk + '|' + slot.roleId] || { items: {} };
    var doneCount = tasks.filter(function (x) { return comp.items[x.id]; }).length;
    var pct = tasks.length ? Math.round(doneCount / tasks.length * 100) : 0;

    var groups = { daily: [], weekly: [], monthly: [] };
    tasks.forEach(function (x) { groups[x.freq].push(x); });

    var body = ['daily', 'weekly', 'monthly'].map(function (f) {
      if (!groups[f].length) return '';
      return '<div class="freq"><div class="freq-h">' + t('freq_' + f) + '</div>' +
        groups[f].map(function (x) {
          var on = !!comp.items[x.id];
          return '<label class="task' + (on ? ' on' : '') + '">' +
            '<input type="checkbox" data-act="toggle" data-wk="' + wk + '" data-role="' +
            slot.roleId + '" data-task="' + x.id + '"' + (on ? ' checked' : '') + '>' +
            '<span>' + esc(x[DORM.i18n.getLang()] || x.cs) + '</span></label>';
        }).join('') + '</div>';
    }).join('');

    return '<section class="card duty' + (isMine ? ' mine' : '') + '">' +
      '<div class="row between top">' +
      '<div class="row"><span class="role-ic">' + slot.icon + '</span>' +
      '<div><div class="role-name">' + esc(roleName(slot.roleId)) + '</div>' +
      '<div class="row who">' + avatar(slot.member, 26) +
      '<span>' + (slot.member ? esc(slot.member.name) : t('nobody')) + '</span>' +
      (isMine ? '<span class="badge you">' + t('your_turn') + '</span>' : '') +
      '</div></div></div>' +
      '<button class="btn ghost sm swap-btn" data-act="swap" data-role="' + slot.roleId +
      '" data-wk="' + wk + '" title="' + t('swap') + '">🔄</button>' +
      '</div>' +
      '<div class="progress"><div class="bar" style="width:' + pct + '%"></div>' +
      '<span class="pct">' + doneCount + '/' + tasks.length + '</span></div>' +
      body + '</section>';
  }

  // ---------- ROSTER ----------
  function renderRoster() {
    var st = state();
    if (!verified().length) return emptyHint();
    var roster = DORM.rotation.rosterForWeek(st, viewDate);
    var wk = DORM.store.isoWeekKey(viewDate);
    var counts = DORM.rotation.fairnessCounts(st, new Date(), 12);
    var maxc = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }).concat([1]));

    var html = '<section class="card"><h2>' + t('roster_title') + '</h2>' +
      '<div class="row between nav-week">' +
      '<button class="btn ghost" data-act="week" data-d="-1">' + t('roster_prev') + '</button>' +
      '<div class="wk-label">' + t('week_label') + ' ' + esc(wk.split('-W')[1]) + ' · ' +
      esc(DORM.store.weekRange(viewDate)) + '</div>' +
      '<button class="btn ghost" data-act="week" data-d="1">' + t('roster_next') + '</button>' +
      '</div>' +
      '<div class="row"><button class="btn link" data-act="week" data-d="0">' +
      t('roster_this_week') + '</button></div>' +
      '<table class="rota"><tbody>' +
      roster.map(function (slot) {
        return '<tr><td class="ic">' + slot.icon + '</td>' +
          '<td>' + esc(roleName(slot.roleId)) + '</td>' +
          '<td class="who">' + avatar(slot.member, 24) + ' ' +
          (slot.member ? esc(slot.member.name) : t('nobody')) + '</td>' +
          '<td class="ra"><button class="btn ghost sm" data-act="swap" data-role="' +
          slot.roleId + '" data-wk="' + wk + '">🔄</button></td></tr>';
      }).join('') +
      '</tbody></table></section>';

    html += '<section class="card"><h2>' + t('fairness_title') + '</h2>' +
      '<p class="muted sm">' + t('fairness_hint') + '</p>' +
      verified().slice().sort(function (a, b) { return counts[b.id] - counts[a.id]; })
        .map(function (m) {
          var c = counts[m.id] || 0;
          return '<div class="fair-row">' + avatar(m, 22) +
            '<span class="fn">' + esc(m.name) + '</span>' +
            '<span class="fbar"><span style="width:' + (c / maxc * 100) + '%;background:' +
            esc(m.color) + '"></span></span>' +
            '<span class="fc">' + c + ' ' + t('duties_count') + '</span></div>';
        }).join('') + '</section>';
    return html;
  }

  // ---------- EXPENSES ----------
  function renderExpenses() {
    var st = state();
    if (!verified().length) return emptyHint();
    var suggestions = DORM.expenses.settleSuggestions(st);
    var bal = DORM.expenses.balances(st);

    var settle = '<section class="card"><h2>' + t('exp_who_owes') + '</h2>';
    if (!suggestions.length) settle += '<p class="ok">' + t('exp_all_settled') + '</p>';
    else settle += suggestions.map(function (s) {
      return '<div class="settle-row">' +
        avatar(member(s.from), 26) + '<span class="nm">' + esc((member(s.from) || {}).name) + '</span>' +
        '<span class="arrow">→ ' + t('exp_owes') + ' →</span>' +
        avatar(member(s.to), 26) + '<span class="nm">' + esc((member(s.to) || {}).name) + '</span>' +
        '<span class="amt">' + money(s.amount) + '</span>' +
        '<button class="btn sm" data-act="settle" data-from="' + s.from + '" data-to="' + s.to +
        '" data-amt="' + s.amount + '">' + t('exp_settle') + '</button></div>';
    }).join('');
    settle += '<div class="bal-grid">' + verified().map(function (m) {
      var b = bal[m.id] || 0;
      var cls = b > 0.01 ? 'pos' : (b < -0.01 ? 'neg' : '');
      return '<div class="bal-cell ' + cls + '">' + avatar(m, 22) +
        '<span class="bn">' + esc(m.name) + '</span>' +
        '<span class="bv">' + (b >= 0 ? '+' : '') + money(b) + '</span></div>';
    }).join('') + '</div></section>';

    var add = '<section class="card"><h2>' + t('exp_add') + '</h2>' +
      '<button class="btn" data-act="add-exp">➕ ' + t('exp_add') + '</button></section>';

    var hist = '<section class="card"><h2>' + t('exp_history') + '</h2>';
    if (!st.expenses.length) hist += '<p class="muted">' + t('exp_none') + '</p>';
    else hist += st.expenses.map(function (e) {
      var among = (e.split && e.split.length) ? e.split.length : verified().length;
      return '<div class="exp-row"><div class="ei">' + catIcon(e.category) + '</div>' +
        '<div class="ed"><div class="et">' + esc(e.desc || t('cat_other')) + '</div>' +
        '<div class="es muted sm">' + esc((member(e.payer) || {}).name) + ' ' + t('exp_paid_by') +
        ' · ' + among + '×</div></div>' +
        '<div class="ea">' + money(e.amount) + '</div>' +
        (DORM.receipts && DORM.receipts.enabled()
          ? '<button class="btn ghost sm" data-act="receipt" data-id="' + e.id + '" title="' +
            t('receipt_view') + '">📎</button>' : '') +
        commentBtn(e.id) +
        '<button class="btn ghost sm" data-act="del-exp" data-id="' + e.id + '">✕</button></div>';
    }).join('');
    hist += '</section>';

    return settle + add + repaymentsCard() + hist;
  }

  // Small coloured badge describing a proof's verification state.
  function proofBadge(rec) {
    var map = {
      verified: ['ok', '✓ ' + t('settle_proof_verified')],
      rejected: ['neg', '⚠ ' + t('settle_proof_rejected')],
      pending: ['muted', '… ' + t('settle_proof_pending')],
      attached: ['muted', '📎 ' + t('settle_proof_attached')]
    };
    var b = map[rec.proofStatus];
    if (!b) return '';
    return '<span class="proof-badge ' + b[0] + '">' + b[1] + '</span>';
  }

  // History of money-transfer repayments (the "buy for everyone" path is a
  // normal expense and already appears in the expenses history above).
  function repaymentsCard() {
    var st = state();
    var list = st.settlements || [];
    var card = '<section class="card"><h2>🤝 ' + t('settle_repayments') + '</h2>';
    if (!list.length) return card + '<p class="muted sm">' + t('settle_none') + '</p></section>';
    card += list.map(function (r) {
      return '<div class="settle-hist' + (r.proofStatus === 'rejected' ? ' bad' : '') + '">' +
        avatar(member(r.from), 24) +
        '<span class="arrow">→</span>' + avatar(member(r.to), 24) +
        '<div class="sh-mid"><div class="amt">' + money(r.amount) + '</div>' +
        (r.note ? '<div class="muted sm">' + esc(r.note) + '</div>' : '') +
        proofBadge(r) + '</div>' +
        ((r.proof || r.proofPath)
          ? '<button class="btn ghost sm" data-act="settle-proof" data-id="' + r.id +
            '" title="' + t('settle_view_proof') + '">🧾</button>' : '') +
        '<button class="btn ghost sm" data-act="del-settle" data-id="' + r.id + '">✕</button></div>';
    }).join('');
    return card + '</section>';
  }

  function catIcon(c) {
    return { cat_hygiene: '🧼', cat_cleaning: '🧴', cat_kitchen: '🍽️', cat_other: '📦' }[c] || '📦';
  }

  // 💬 button for an expense row: shows the comment count and an unread dot.
  function commentBtn(expenseId) {
    var n = DORM.comments.count(state(), expenseId);
    return '<button class="btn ghost sm cbtn" data-act="comments" data-id="' + expenseId +
      '" title="' + t('cm_title') + '">💬' + (n ? ' <span class="cn">' + n + '</span>' : '') +
      (isUnread(expenseId) ? '<span class="dot"></span>' : '') + '</button>';
  }

  // ---------- LEADERBOARD ----------
  function renderLeaderboard() {
    var st = state();
    if (!verified().length) return emptyHint();
    var lb = DORM.points.leaderboard(st);
    var me = st.settings.me;

    var rows = lb.map(function (r, i) {
      var mine = me && r.member.id === me;
      return '<div class="lb-row' + (mine ? ' mine' : '') + '">' +
        '<span class="rank">' + (i + 1) + '</span>' + avatar(r.member, 30) +
        '<div class="lb-info"><div class="lb-name">' + esc(r.member.name) +
        ' <span class="tier">' + r.tier.badge + ' ' + t(r.tier.id) + '</span></div>' +
        '<div class="muted sm">' + r.tokens + ' × ' + t('lb_tokens') +
        (r.tokens > 0 && mine ? ' <button class="btn ghost xs" data-act="token" data-id="' +
          r.member.id + '">' + t('lb_use_token') + '</button>' : '') + '</div></div>' +
        '<span class="lb-pts">' + r.points + ' <small>' + t('lb_points') + '</small></span></div>';
    }).join('');

    var rules = '<section class="card"><h2>' + t('lb_rules_title') + '</h2><ul class="rules">' +
      ['lb_rule_1', 'lb_rule_2', 'lb_rule_3'].map(function (k) {
        return '<li>' + t(k) + '</li>';
      }).join('') + '</ul></section>';

    return '<section class="card"><h2>' + t('lb_title') + '</h2>' + rows + '</section>' + rules;
  }

  // ---------- PROFILE hub (points / overview / settings) ----------
  function renderProfile() {
    var subs = [
      ['leaderboard', t('tab_leaderboard')],
      ['overview', t('tab_overview')],
      ['settings', t('tab_settings')]
    ];
    var seg = '<div class="segmented">' + subs.map(function (s) {
      return '<button class="seg' + (profileSub === s[0] ? ' active' : '') +
        '" data-act="psub" data-sub="' + s[0] + '">' + esc(s[1]) + '</button>';
    }).join('') + '</div>';
    var body = profileSub === 'overview' ? renderOverview()
      : profileSub === 'settings' ? renderSettings()
      : renderLeaderboard();
    return seg + body;
  }

  // ---------- SHOPPING (supplies list + inventory) ----------
  function shRow(it, needed) {
    var who = needed && it.flaggedBy && member(it.flaggedBy) ? member(it.flaggedBy).name : null;
    return '<div class="sh-row' + (needed ? ' need' : '') + '"><span class="ci">' +
      catIcon(it.category) + '</span>' +
      '<div class="shd"><div class="shn">' + esc(DORM.shopping.displayName(it)) + '</div>' +
      (who ? '<div class="muted sm">' + t('sh_flagged_by') + ' ' + esc(who) + '</div>' : '') + '</div>' +
      (needed
        ? '<button class="btn sm" data-act="sh-bought" data-id="' + it.id + '">' + t('sh_bought') + '</button>'
        : '<button class="btn ghost sm" data-act="sh-flag" data-id="' + it.id + '">' + t('sh_flag') + '</button>') +
      '<button class="btn ghost sm" data-act="sh-del" data-id="' + it.id + '">✕</button></div>';
  }

  function renderShopping() {
    var st = state();
    if (!verified().length) return emptyHint();
    var needed = DORM.shopping.needed(st);
    var stock = DORM.shopping.inStock(st);

    var neededCard = '<section class="card"><h2>🛒 ' + t('sh_needed') + '</h2>' +
      (needed.length ? needed.map(function (it) { return shRow(it, true); }).join('')
        : '<p class="ok">' + t('sh_none_needed') + '</p>') + '</section>';

    var chips = DORM.shopping.COMMON.map(function (c) {
      return '<button class="chip" data-act="sh-quick" data-key="' + c.key + '">+ ' + t(c.key) + '</button>';
    }).join('');
    var addCard = '<section class="card"><h2>' + t('sh_quick') + '</h2><div class="chips">' + chips +
      '</div><button class="btn ghost mt" data-act="sh-add">➕ ' + t('sh_add_custom') + '</button></section>';

    var stockCard = '<section class="card"><h2>✅ ' + t('sh_stock') + '</h2>' +
      (stock.length ? stock.map(function (it) { return shRow(it, false); }).join('')
        : '<p class="muted sm">' + t('sh_none') + '</p>') + '</section>';

    var counts = DORM.shopping.buyCounts(st);
    var totalBuys = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
    var maxb = maxOf(verified().map(function (m) { return counts[m.id] || 0; }));
    var fairCard = totalBuys ? '<section class="card"><h2>🤝 ' + t('sh_fair') + '</h2>' +
      verified().slice().sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0); })
        .map(function (m) {
          var c = counts[m.id] || 0;
          return '<div class="stat-row">' + avatar(m, 22) + '<span class="sn">' + esc(m.name) + '</span>' +
            '<span class="sbar"><span style="width:' + (c / maxb * 100) + '%;background:' +
            esc(m.color) + '"></span></span><span class="sv">' + c + '</span></div>';
        }).join('') + '</section>' : '';

    return neededCard + addCard + stockCard + fairCard;
  }

  function shoppingAddModal() {
    var catOpts = DORM.expenses.CATEGORIES.map(function (c) {
      return '<option value="' + c + '">' + t(c) + '</option>';
    }).join('');
    openModal('<h3>➕ ' + t('sh_add_custom') + '</h3>' +
      '<label class="field"><span>' + t('sh_item_name') + '</span>' +
      '<input type="text" id="shName" placeholder="' + t('sh_item_name') + '"></label>' +
      '<label class="field"><span>' + t('exp_category') + '</span><select id="shCat">' + catOpts +
      '</select></label>' +
      '<div class="row gap end"><button class="btn ghost" data-act="modal-close">' + t('cancel') +
      '</button><button class="btn" data-act="sh-add-save">' + t('sh_add') + '</button></div>');
  }

  function boughtModal(id) {
    var st = state();
    var it = (st.shopping || []).filter(function (x) { return x.id === id; })[0];
    var buyerOpts = verified().map(function (m) {
      return '<option value="' + m.id + '"' + (st.settings.me === m.id ? ' selected' : '') + '>' +
        esc(m.name) + '</option>';
    }).join('');
    openModal('<h3>🛒 ' + t('sh_bought_title') + (it ? ' — ' + esc(DORM.shopping.displayName(it)) : '') + '</h3>' +
      '<label class="field"><span>' + t('sh_buyer') + '</span><select id="shBuyer">' + buyerOpts +
      '</select></label>' +
      '<label class="field"><span>' + t('sh_amount_opt') + ' (' + esc(st.settings.currency) + ')</span>' +
      '<input type="number" id="shAmount" inputmode="decimal" min="0" step="0.01"></label>' +
      '<div class="row gap end"><button class="btn ghost" data-act="modal-close">' + t('cancel') +
      '</button><button class="btn" data-act="sh-bought-save" data-id="' + id + '">' + t('sh_confirm') +
      '</button></div>');
  }

  // ---------- OVERVIEW (stats + activity) ----------
  function maxOf(arr) { return Math.max.apply(null, arr.concat([1])); }

  function timeAgo(ts) {
    if (!ts) return '';
    var min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return t('t_now');
    if (min < 60) return t('t_min').replace('{n}', min);
    var h = Math.floor(min / 60);
    if (h < 24) return t('t_hour').replace('{n}', h);
    var d = Math.floor(h / 24);
    if (d === 1) return t('t_yesterday');
    if (d < 7) return t('t_days').replace('{n}', d);
    var dt = new Date(ts);
    return dt.getDate() + '.' + (dt.getMonth() + 1) + '.';
  }

  function activityLine(ev) {
    var who = ev.by || ev.from || ev.payer;
    var name = member(who) ? member(who).name : '—';
    var icon, text;
    if (ev.type === 'duty') {
      icon = '✅'; text = t('act_did_duty') + ' · ' + esc(roleName(ev.role));
    } else if (ev.type === 'swap') {
      var toN = member(ev.to) ? member(ev.to).name : '—';
      icon = '🔄'; text = t('act_swap') + ' · ' + esc(roleName(ev.role)) + ' → ' + esc(toN);
    } else if (ev.type === 'expense') {
      icon = '💰'; text = t('act_expense') + ' · ' + esc(ev.desc || '') + ' (' + money(ev.amount) + ')';
    } else if (ev.type === 'buy') {
      icon = '🛒'; text = t('act_bought') + ' · ' + esc(ev.item || '');
    } else if (ev.type === 'comment') {
      var snip = (ev.text || '').slice(0, 60) + ((ev.text || '').length > 60 ? '…' : '');
      icon = '💬'; text = t('act_comment') + (ev.desc ? ' · ' + esc(ev.desc) : '') +
        ' · „' + esc(snip) + '“';
    } else {
      var toN2 = member(ev.to) ? member(ev.to).name : '—';
      icon = '🤝'; text = t('act_settle') + ' → ' + esc(toN2) + ' (' + money(ev.amount) + ')';
    }
    return '<div class="act-row"><span class="ai">' + icon + '</span>' +
      '<div class="ad"><div class="at"><b>' + esc(name) + '</b> ' + text + '</div>' +
      '<div class="muted sm">' + timeAgo(ev.ts) + '</div></div></div>';
  }

  function renderOverview() {
    var st = state();
    if (!verified().length) return emptyHint();
    var vs = verified();
    var duties = DORM.stats.dutiesThisMonth(st);
    var maxDuty = maxOf(vs.map(function (m) { return duties[m.id] || 0; }));
    var spend = DORM.stats.spendingThisMonth(st);
    var swaps = DORM.stats.swapCounts(st);
    var acts = DORM.stats.activity(st, 15);

    var dutiesCard = '<section class="card"><h2>📊 ' + t('ov_month_duties') + '</h2>' +
      vs.slice().sort(function (a, b) { return (duties[b.id] || 0) - (duties[a.id] || 0); })
        .map(function (m) {
          var c = duties[m.id] || 0;
          return '<div class="stat-row">' + avatar(m, 22) + '<span class="sn">' + esc(m.name) + '</span>' +
            '<span class="sbar"><span style="width:' + (c / maxDuty * 100) + '%;background:' +
            esc(m.color) + '"></span></span><span class="sv">' + c + '</span></div>';
        }).join('') + '</section>';

    var cats = Object.keys(spend.byCat);
    var maxCat = maxOf(cats.map(function (c) { return spend.byCat[c]; }));
    var spendCard = '<section class="card"><h2>💰 ' + t('ov_spending') + '</h2>' +
      '<div class="big-total">' + t('ov_spending_total') + ': <b>' + money(spend.total) + '</b></div>' +
      (cats.length ? cats.sort(function (a, b) { return spend.byCat[b] - spend.byCat[a]; })
        .map(function (c) {
          return '<div class="stat-row"><span class="ci">' + catIcon(c) + '</span>' +
            '<span class="sn">' + t(c) + '</span>' +
            '<span class="sbar"><span class="cbar" style="width:' +
            (spend.byCat[c] / maxCat * 100) + '%"></span></span>' +
            '<span class="sv">' + money(spend.byCat[c]) + '</span></div>';
        }).join('') : '<p class="muted sm">—</p>') + '</section>';

    var hasSwaps = (st.swaps || []).length > 0;
    var swapCard = hasSwaps ? '<section class="card"><h2>🔄 ' + t('ov_swaps') + '</h2>' +
      vs.map(function (m) {
        var s = swaps[m.id]; if (!s || (!s.given && !s.taken)) return '';
        return '<div class="stat-row simple">' + avatar(m, 22) +
          '<span class="sn">' + esc(m.name) + '</span>' +
          '<span class="sv2">' + t('ov_given') + ' ' + s.given + ' · ' + t('ov_taken') + ' ' + s.taken +
          '</span></div>';
      }).join('') + '</section>' : '';

    var actCard = '<section class="card"><h2>🕑 ' + t('ov_activity') + '</h2>' +
      (acts.length ? acts.map(activityLine).join('') : '<p class="muted sm">' + t('ov_none') + '</p>') +
      '</section>';

    return dutiesCard + spendCard + swapCard + actCard;
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    var st = state();
    var vs = verified(), ps = pending();
    var rows = vs.map(function (m) {
      return '<div class="mrow"><input class="mname" data-act="m-name" data-id="' + m.id +
        '" value="' + esc(m.name) + '" placeholder="' + t('set_member_name') + '">' +
        '<select class="mroom" data-act="m-room" data-id="' + m.id + '">' +
        '<option value="A"' + (m.room === 'A' ? ' selected' : '') + '>' + esc(roomLabel('A')) + '</option>' +
        '<option value="B"' + (m.room === 'B' ? ' selected' : '') + '>' + esc(roomLabel('B')) + '</option>' +
        '</select>' +
        '<button class="btn ghost sm" data-act="m-del" data-id="' + m.id + '">🗑</button></div>';
    }).join('');

    // Admin panel: people waiting to be approved.
    var pendingCard = '';
    if (ps.length) {
      pendingCard = '<section class="card"><h2>' + t('verify_pending_title') + ' (' + ps.length +
        ')</h2><p class="muted sm">' + t('pending_hint') + '</p>' +
        ps.map(function (m) {
          return '<div class="mrow pend">' + avatar(m, 24) +
            '<span class="pn">' + esc(m.name || '—') + ' · ' + esc(roomLabel(m.room)) + '</span>' +
            '<button class="btn sm" data-act="approve" data-id="' + m.id + '">' + t('verify_approve') + '</button>' +
            '<button class="btn ghost sm" data-act="reject" data-id="' + m.id + '">' + t('verify_reject') + '</button>' +
            '</div>';
        }).join('') + '</section>';
    }

    var sync = st.settings.sync || {};
    return '<section class="card"><h2>' + t('set_members') + '</h2>' + rows +
      '<div class="row gap">' +
      (vs.length < 8
        ? '<button class="btn" data-act="m-add">➕ ' + t('set_add_member') + '</button>'
        : '<span class="muted sm">' + t('set_max_members') + '</span>') +
      (st.members.length === 0
        ? '<button class="btn ghost" data-act="seed">' + t('set_seed') + '</button>' : '') +
      '</div></section>' +
      pendingCard +

      '<section class="card"><h2>' + t('set_access') + '</h2>' +
      '<label class="field"><span>' + t('join_code') + '</span>' +
      '<input type="text" data-act="joinCode" value="' + esc(st.settings.joinCode || '') +
      '" placeholder="—" style="max-width:220px"></label>' +
      '<p class="muted sm">' + t('join_code_hint') + '</p>' +
      '<button class="btn ghost" data-act="join-open">👋 ' + t('join_button') + '</button></section>' +

      '<section class="card"><h2>' + t('settings_title') + '</h2>' +
      '<div class="field"><span>' + t('set_rooms') + '</span><div class="row gap">' +
      '<input type="text" data-act="roomName" data-room="A" value="' + esc(roomLabel('A')) +
      '" style="flex:1;min-width:0">' +
      '<input type="text" data-act="roomName" data-room="B" value="' + esc(roomLabel('B')) +
      '" style="flex:1;min-width:0"></div></div>' +
      '<label class="field"><span>' + t('set_start_date') + '</span>' +
      '<input type="date" data-act="startDate" value="' + esc(st.settings.startDate) + '"></label>' +
      '<label class="field"><span>' + t('set_currency') + '</span>' +
      '<input type="text" data-act="currency" value="' + esc(st.settings.currency) +
      '" maxlength="4" style="max-width:120px"></label>' +
      '<label class="field"><span>' + t('set_language') + '</span>' +
      '<select data-act="lang"><option value="cs"' + (DORM.i18n.getLang() === 'cs' ? ' selected' : '') +
      '>Čeština</option><option value="en"' + (DORM.i18n.getLang() === 'en' ? ' selected' : '') +
      '>English</option></select></label></section>' +

      '<section class="card"><h2>' + t('set_notify') + '</h2>' +
      '<p class="muted sm">' + t('notify_hint') + '</p>' +
      '<label class="field"><span>' + t('notify_vapid') + '</span>' +
      '<input type="text" data-act="vapidKey" placeholder="BB…" value="' +
      esc(st.settings.vapidPublicKey || '') + '"></label>' +
      '<button class="btn" data-act="notify-enable">🔔 ' + t('notify_enable') + '</button>' +
      '<div id="notifyMsg" class="muted sm" style="margin-top:8px"></div></section>' +

      '<section class="card"><h2>' + t('set_data') + '</h2>' +
      '<p class="muted sm">' + t('set_sync_hint') + '</p>' +
      '<label class="field"><span>' + t('set_sync_url') + '</span>' +
      '<input type="text" id="syncUrl" placeholder="https://xxxx.supabase.co" value="' +
      esc(sync.url || '') + '"></label>' +
      '<label class="field"><span>' + t('set_sync_key') + '</span>' +
      '<input type="text" id="syncKey" placeholder="eyJhbGciOi..." value="' +
      esc(sync.key || '') + '"></label>' +
      '<div class="row gap"><button class="btn" data-act="sync-on">' + t('set_sync_save') +
      '</button>' + (st.settings.sync
        ? '<button class="btn ghost" data-act="sync-off">' + t('set_sync_off') + '</button>' : '') +
      '</div>' +
      '<div class="row gap mt"><button class="btn ghost" data-act="export">⬇ ' + t('set_export') +
      '</button><button class="btn ghost" data-act="import">⬆ ' + t('set_import') + '</button>' +
      '<button class="btn danger" data-act="reset">' + t('set_reset') + '</button></div>' +
      '</section>';
  }

  function emptyHint() {
    return '<section class="card"><p class="muted big">👋 ' + t('no_members_hint') + '</p>' +
      '<div class="row gap">' +
      '<button class="btn" data-act="goto-settings">⚙️ ' + t('tab_settings') + '</button>' +
      '<button class="btn ghost" data-act="join-open">👋 ' + t('join_button') + '</button>' +
      '<button class="btn ghost" data-act="seed">' + t('set_seed') + '</button></div></section>';
  }

  // ---------- modal ----------
  function openModal(html) {
    modalEl.innerHTML = '<div class="modal-bg" data-act="modal-close"></div>' +
      '<div class="modal">' + html + '</div>';
    modalEl.classList.add('open');
  }
  function closeModal() { modalEl.classList.remove('open'); modalEl.innerHTML = ''; }

  function swapModal(roleId, wk) {
    var st = state();
    var d = weekDateFromKey(wk);
    var cur = DORM.rotation.assignee(st, roleId, d);
    var opts = verified().map(function (m) {
      return '<option value="' + m.id + '"' + (cur && cur.id === m.id ? ' selected' : '') + '>' +
        esc(m.name) + '</option>';
    }).join('');
    openModal('<h3>' + t('swap_title') + ' — ' + esc(roleName(roleId)) + '</h3>' +
      '<p class="muted sm">' + t('swap_desc') + '</p>' +
      '<label class="field"><span>' + t('swap_to') + '</span><select id="swapTo">' + opts +
      '</select></label>' +
      '<label class="field"><span>' + t('swap_note') + '</span>' +
      '<input type="text" id="swapNote" placeholder="' + t('swap_note') + '"></label>' +
      '<div class="row gap end">' +
      '<button class="btn ghost" data-act="swap-reset" data-role="' + roleId + '" data-wk="' + wk +
      '">' + t('swap_reset') + '</button>' +
      '<button class="btn ghost" data-act="modal-close">' + t('cancel') + '</button>' +
      '<button class="btn" data-act="swap-save" data-role="' + roleId + '" data-wk="' + wk +
      '">' + t('swap_confirm') + '</button></div>');
  }

  // `prefill` (optional): { desc, amount, payer, split:[ids], note } — used when
  // repaying a debt by "buying an equivalent thing for everyone".
  function addExpenseModal(prefill) {
    var st = state();
    prefill = prefill || {};
    var payerOpts = verified().map(function (m) {
      var sel = prefill.payer ? (prefill.payer === m.id) : (st.settings.me === m.id);
      return '<option value="' + m.id + '"' + (sel ? ' selected' : '') + '>' +
        esc(m.name) + '</option>';
    }).join('');
    var catOpts = DORM.expenses.CATEGORIES.map(function (c) {
      return '<option value="' + c + '">' + t(c) + '</option>';
    }).join('');
    var splitBoxes = verified().map(function (m) {
      var on = prefill.split ? prefill.split.indexOf(m.id) !== -1 : true;
      return '<label class="chk"><input type="checkbox" class="splitM" value="' + m.id +
        '"' + (on ? ' checked' : '') + '> ' + esc(m.name) + '</label>';
    }).join('');
    openModal('<h3>' + t('exp_add') + '</h3>' +
      (prefill.note ? '<p class="muted sm">' + esc(prefill.note) + '</p>' : '') +
      '<label class="field"><span>' + t('exp_desc') + '</span>' +
      '<input type="text" id="expDesc" placeholder="' + t('exp_desc') + '" value="' +
      esc(prefill.desc || '') + '"></label>' +
      '<label class="field"><span>' + t('exp_amount') + ' (' + esc(st.settings.currency) +
      ')</span><input type="number" id="expAmount" inputmode="decimal" min="0" step="0.01"' +
      (prefill.amount ? ' value="' + esc(prefill.amount) + '"' : '') + '></label>' +
      '<label class="field"><span>' + t('exp_payer') + '</span><select id="expPayer">' +
      payerOpts + '</select></label>' +
      '<label class="field"><span>' + t('exp_category') + '</span><select id="expCat">' +
      catOpts + '</select></label>' +
      '<div class="field"><span>' + t('exp_split') + '</span><div class="split-list">' +
      splitBoxes + '</div></div>' +
      (DORM.receipts && DORM.receipts.enabled()
        ? '<label class="field"><span>' + t('exp_receipt') + ' · ' + t('exp_receipt_optional') +
          '</span><input type="file" id="expReceipt" accept="image/*" capture="environment"></label>'
        : '') +
      '<div class="row gap end"><button class="btn ghost" data-act="modal-close">' + t('cancel') +
      '</button><button class="btn" data-act="exp-save">' + t('exp_save') + '</button></div>');
  }

  // Repay a debt from -> to. Two paths from the roadmap: a money transfer
  // (with an optional proof photo, AI-checked when the backend is on) or
  // buying something of equivalent value for everyone (a normal expense).
  function settleModal(from, to, amount) {
    var fromN = (member(from) || {}).name || '—';
    var toN = (member(to) || {}).name || '—';
    var cur = state().settings.currency;
    var aiHint = (DORM.settleproof && DORM.settleproof.enabled())
      ? t('settle_proof_ai_on') : t('settle_proof_ai_off');
    openModal('<h3>🤝 ' + t('settle') + '</h3>' +
      '<div class="settle-head">' + avatar(member(from), 30) +
      '<span class="nm">' + esc(fromN) + '</span><span class="arrow">→</span>' +
      avatar(member(to), 30) + '<span class="nm">' + esc(toN) + '</span></div>' +

      '<div class="settle-way"><div class="freq-h">💸 ' + t('settle_way_transfer') + '</div>' +
      '<label class="field"><span>' + t('exp_amount') + ' (' + esc(cur) + ')</span>' +
      '<input type="number" id="setAmount" inputmode="decimal" min="0" step="0.01" value="' +
      esc(amount) + '"></label>' +
      '<label class="field"><span>' + t('settle_note') + '</span>' +
      '<input type="text" id="setNote" placeholder="' + t('settle_note_ph') + '"></label>' +
      '<label class="field"><span>📷 ' + t('settle_proof') + ' · ' + t('exp_receipt_optional') +
      '</span><input type="file" id="setProof" accept="image/*" capture="environment"></label>' +
      '<p class="muted sm">' + aiHint + '</p>' +
      '<button class="btn full" data-act="settle-transfer-save" data-from="' + from +
      '" data-to="' + to + '">' + t('settle_confirm_transfer') + '</button></div>' +

      '<div class="or-sep"><span>' + t('settle_or') + '</span></div>' +

      '<div class="settle-way"><div class="freq-h">🛍️ ' + t('settle_way_goods') + '</div>' +
      '<p class="muted sm">' + t('settle_way_goods_desc') + '</p>' +
      '<button class="btn ghost full" data-act="settle-goods" data-from="' + from +
      '" data-amt="' + esc(amount) + '">' + t('settle_confirm_goods') + '</button></div>' +

      '<div class="row end mt"><button class="btn ghost" data-act="modal-close">' +
      t('cancel') + '</button></div>');
  }

  function settleProofModal(id) {
    var rec = (state().settlements || []).filter(function (s) { return s.id === id; })[0];
    if (!rec) return;
    var body;
    if (rec.proof) body = '<img class="proof-img" src="' + esc(rec.proof) + '" alt="proof">';
    else if (rec.proofPath) body = '<p class="muted sm">' + t('settle_proof_remote') + '</p>';
    else body = '<p class="muted">' + t('receipt_none') + '</p>';
    openModal('<h3>🧾 ' + t('settle_view_proof') + '</h3>' +
      '<div class="muted sm">' + esc((member(rec.from) || {}).name) + ' → ' +
      esc((member(rec.to) || {}).name) + ' · ' + money(rec.amount) + '</div>' +
      proofBadge(rec) + body +
      '<div class="row end"><button class="btn" data-act="modal-close">OK</button></div>');
  }

  // Comment thread for one purchase (expense). Read + write, chat-style.
  function commentsModal(expenseId) {
    var st = state();
    var e = (st.expenses || []).filter(function (x) { return x.id === expenseId; })[0];
    if (!e) return;
    var list = DORM.comments.forExpense(st, expenseId);
    var me = st.settings.me;
    var thread = list.length ? list.map(function (c) {
      var mine = me && c.by === me;
      return '<div class="cm-row' + (mine ? ' mine' : '') + '">' + avatar(member(c.by), 26) +
        '<div class="cm-body"><div class="cm-head"><b>' + esc((member(c.by) || {}).name || '—') +
        '</b> <span class="muted sm">' + timeAgo(c.ts) + '</span></div>' +
        '<div class="cm-text">' + esc(c.text) + '</div></div>' +
        (mine ? '<button class="btn ghost xs" data-act="comment-del" data-id="' + c.id +
          '" data-exp="' + expenseId + '" title="' + t('exp_delete') + '">✕</button>' : '') +
        '</div>';
    }).join('') : '<p class="muted sm">' + t('cm_none') + '</p>';

    var compose = me
      ? '<div class="cm-compose"><textarea id="cmText" rows="2" maxlength="1000" placeholder="' +
        t('cm_placeholder') + '"></textarea>' +
        '<button class="btn" data-act="comment-add" data-id="' + expenseId + '">' +
        t('cm_send') + '</button></div>'
      : '<p class="muted sm">' + t('cm_need_me') + '</p>';

    openModal('<h3>💬 ' + t('cm_title') + '</h3>' +
      '<div class="cm-subject muted sm">' + catIcon(e.category) + ' ' +
      esc(e.desc || t('cat_other')) + ' · ' + money(e.amount) + ' · ' +
      esc((member(e.payer) || {}).name || '—') + '</div>' +
      '<div class="cm-thread">' + thread + '</div>' + compose +
      '<div class="row end mt"><button class="btn ghost" data-act="modal-close">' +
      t('cancel') + '</button></div>');

    // Opening the thread clears its unread state on this device; refresh the
    // tab badge and row dots behind the modal (render leaves the modal alone).
    markSeen(expenseId);
    render();
    var box = document.querySelector('.cm-thread');
    if (box) box.scrollTop = box.scrollHeight;
    var ta = document.getElementById('cmText');
    if (ta) ta.focus();
  }

  function receiptModal(expenseId) {
    openModal('<h3>📎 ' + t('receipt_view') + '</h3><p class="muted sm">' +
      t('receipt_uploading') + '</p>');
    DORM.receipts.forExpense(expenseId).then(function (rows) {
      var body;
      if (!rows.length) body = '<p class="muted">' + t('receipt_none') + '</p>';
      else body = rows.map(function (r) {
        var head = '<div class="muted sm">' + t('receipt_status') + ': ' + esc(r.status) +
          (r.status === 'failed' && r.ai_error ? ' — ' + esc(r.ai_error) : '') + '</div>';
        var items = r.receipt_items || [];
        if (items.length) {
          return head + '<div class="freq-h">' + t('receipt_items') + '</div>' +
            '<table class="ritems"><tbody>' + items.map(function (it) {
              return '<tr><td>' + esc(it.name) + '</td><td class="qc">' + (it.qty || 1) +
                '×</td><td class="ra">' +
                esc(DORM.expenses.round2(it.total || 0).toLocaleString('cs-CZ')) + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        return head + (r.status === 'failed'
          ? '<p class="muted sm">' + t('receipt_failed') + '</p>' : '');
      }).join('<hr class="rsep">');
      openModal('<h3>📎 ' + t('receipt_view') + '</h3>' + body +
        '<div class="row end"><button class="btn" data-act="modal-close">OK</button></div>');
    });
  }

  // ---------- join / verification ----------
  var GATE_KEY = 'bulka_gate_ok'; // stores the cell code this device unlocked with

  function gateNeeded() {
    var code = (state().settings.joinCode || '').trim();
    if (!code) return false;
    try { return localStorage.getItem(GATE_KEY) !== code; } catch (e) { return false; }
  }
  function openGate() {
    openModal('<div class="tour"><h3>🔒 ' + t('gate_title') + '</h3>' +
      '<p class="muted sm">' + t('gate_desc') + '</p>' +
      '<label class="field"><input type="text" id="gateInput" placeholder="' + t('join_code') +
      '"></label><div id="gateErr" class="err-msg" hidden></div>' +
      '<div class="row end"><button class="btn" data-act="gate-submit">' + t('gate_submit') +
      '</button></div></div>');
  }
  function openJoin() {
    var st = state();
    var roomOpts = '<option value="A">' + esc(roomLabel('A')) + '</option>' +
      '<option value="B">' + esc(roomLabel('B')) + '</option>';
    openModal('<div><h3>👋 ' + t('join_title') + '</h3>' +
      '<p class="muted sm">' + t('join_desc') + '</p>' +
      '<label class="field"><span>' + t('join_name') + '</span>' +
      '<input type="text" id="joinName" placeholder="' + t('join_name') + '"></label>' +
      '<label class="field"><span>' + t('join_room') + '</span>' +
      '<select id="joinRoom">' + roomOpts + '</select></label>' +
      (st.settings.joinCode ? '<label class="field"><span>' + t('join_code_enter') + '</span>' +
        '<input type="text" id="joinCodeIn" placeholder="' + t('join_code_enter') + '"></label>' : '') +
      '<div id="joinErr" class="err-msg" hidden></div>' +
      '<div class="row gap end"><button class="btn ghost" data-act="modal-close">' + t('cancel') +
      '</button><button class="btn" data-act="join-submit">' + t('join_submit') + '</button></div></div>');
  }

  // ---------- onboarding tour ----------
  var TOUR_KEY = 'bulka_onboarded_v1';
  var TOUR_STEPS = ['s1', 's2', 's3', 's4', 's5', 's6'];
  var tourStep = 0;

  function tourSeen() {
    try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return false; }
  }
  function markTourSeen() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
  }
  function maybeTour() {
    if (!tourSeen()) openTour(0);
  }

  function openTour(step) {
    tourStep = Math.max(0, Math.min(step || 0, TOUR_STEPS.length - 1));
    renderTour();
  }
  function renderTour() {
    var s = TOUR_STEPS[tourStep];
    var last = tourStep === TOUR_STEPS.length - 1;
    var dots = TOUR_STEPS.map(function (_, i) {
      return '<span class="dot' + (i === tourStep ? ' on' : '') + '"></span>';
    }).join('');
    openModal('<div class="tour">' +
      '<div class="tour-step">' + (tourStep + 1) + '/' + TOUR_STEPS.length + '</div>' +
      '<h3>' + t('tour_' + s + '_t') + '</h3>' +
      '<p class="tour-body">' + t('tour_' + s + '_b') + '</p>' +
      '<div class="tour-dots">' + dots + '</div>' +
      '<div class="row between tour-nav">' +
      '<button class="btn link" data-act="tour-skip">' + t('tour_skip') + '</button>' +
      '<div class="row gap">' +
      (tourStep > 0 ? '<button class="btn ghost" data-act="tour-back">' + t('tour_back') + '</button>' : '') +
      '<button class="btn" data-act="' + (last ? 'tour-done' : 'tour-next') + '">' +
      (last ? t('tour_done') : t('tour_next')) + '</button>' +
      '</div></div></div>');
  }

  function weekDateFromKey(wk) {
    // return any date inside that ISO week; use current week's date if it matches
    var parts = wk.split('-W');
    var year = +parts[0], week = +parts[1];
    var simple = new Date(year, 0, 1 + (week - 1) * 7);
    var dow = simple.getDay() || 7;
    simple.setDate(simple.getDate() - (dow - 1) + 3); // Thursday-ish, safely inside week
    return simple;
  }

  // ---------- events ----------
  function bind(main, modal) {
    mainEl = main; modalEl = modal;

    document.getElementById('nav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { currentTab = b.getAttribute('data-tab'); render(); }
    });

    document.getElementById('langToggle').addEventListener('click', function () {
      var next = DORM.i18n.getLang() === 'cs' ? 'en' : 'cs';
      DORM.i18n.setLang(next);
      document.documentElement.lang = next;
      S.update(function (s) { s.settings.lang = next; });
    });

    var helpBtn = document.getElementById('helpBtn');
    if (helpBtn) helpBtn.addEventListener('click', function () { openTour(0); });

    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      updateThemeBtn();
      themeBtn.addEventListener('click', function () {
        var order = ['system', 'light', 'dark'];
        var next = order[(order.indexOf(getTheme()) + 1) % order.length];
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        updateThemeBtn();
      });
    }

    // Boot: a locked cell asks for its code first, otherwise show the tour once.
    setTimeout(function () {
      if (gateNeeded()) openGate();
      else maybeTour();
    }, 350);

    document.body.addEventListener('change', function (e) {
      var el = e.target;
      if (el.id === 'meSelect') {
        S.update(function (s) { s.settings.me = el.value || null; });
      } else if (el.getAttribute('data-act') === 'toggle') {
        var wk = el.getAttribute('data-wk'), role = el.getAttribute('data-role'),
          task = el.getAttribute('data-task');
        // Capture the checkbox position before the re-render detaches it.
        var rect = el.getBoundingClientRect();
        var wasChecked = el.checked;
        toggleTask(wk, role, task, el.checked);
        if (wasChecked) {
          var isMonthly = DORM.store.isMonthlyWeek(weekDateFromKey(wk));
          var tasks = DORM.duties.tasksForRole(role, isMonthly);
          var comp = S.get().completions[wk + '|' + role];
          var done = comp ? tasks.filter(function (x) { return comp.items[x.id]; }).length : 0;
          if (tasks.length && done === tasks.length) {
            celebrate(rect.left + rect.width / 2, rect.top);
          }
        }
      } else if (el.getAttribute('data-act') === 'm-name') {
        var id = el.getAttribute('data-id');
        S.update(function (s) { var m = s.members.filter(function (x) { return x.id === id; })[0]; if (m) m.name = el.value; });
      } else if (el.getAttribute('data-act') === 'm-room') {
        var id2 = el.getAttribute('data-id');
        S.update(function (s) { var m = s.members.filter(function (x) { return x.id === id2; })[0]; if (m) m.room = el.value; });
      } else if (el.getAttribute('data-act') === 'roomName') {
        var rc = el.getAttribute('data-room');
        S.update(function (s) {
          if (!s.settings.roomNames) s.settings.roomNames = { A: 'Pokoj 1', B: 'Pokoj 2' };
          s.settings.roomNames[rc] = el.value || (rc === 'A' ? 'Pokoj 1' : 'Pokoj 2');
        });
      } else if (el.getAttribute('data-act') === 'joinCode') {
        var code = el.value.trim();
        S.update(function (s) { s.settings.joinCode = code; });
        // Whoever sets the code (the admin) is trusted on this device.
        try { localStorage.setItem(GATE_KEY, code); } catch (e) {}
      } else if (el.getAttribute('data-act') === 'vapidKey') {
        S.update(function (s) { s.settings.vapidPublicKey = el.value.trim(); });
      } else if (el.getAttribute('data-act') === 'startDate') {
        S.update(function (s) { s.settings.startDate = el.value; });
      } else if (el.getAttribute('data-act') === 'currency') {
        S.update(function (s) { s.settings.currency = el.value || 'CZK'; });
      } else if (el.getAttribute('data-act') === 'lang') {
        DORM.i18n.setLang(el.value);
        S.update(function (s) { s.settings.lang = el.value; });
      }
    });

    document.body.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      var handler = actions[act];
      if (handler) { handler(el, e); }
    });
  }

  function toggleTask(wk, role, task, on) {
    S.update(function (s) {
      var k = wk + '|' + role;
      var c = s.completions[k] || { items: {}, by: null };
      if (on) c.items[task] = true; else delete c.items[task];
      // credit the current assignee of this role/week
      var d = weekDateFromKey(wk);
      var a = DORM.rotation.assignee(s, role, d);
      c.by = a ? a.id : null;
      c.ts = Date.now();
      if (Object.keys(c.items).length === 0) delete s.completions[k];
      else s.completions[k] = c;
    });
  }

  var actions = {
    'goto-settings': function () { currentTab = 'profile'; profileSub = 'settings'; render(); },
    'psub': function (el) { profileSub = el.getAttribute('data-sub'); render(); },
    'modal-close': function () { closeModal(); },
    'tour-next': function () { openTour(tourStep + 1); },
    'tour-back': function () { openTour(tourStep - 1); },
    'tour-skip': function () { markTourSeen(); closeModal(); },
    'tour-done': function () { markTourSeen(); closeModal(); },
    'approve': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) {
        var m = s.members.filter(function (x) { return x.id === id; })[0];
        if (m) m.status = 'verified';
      });
    },
    'reject': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) { s.members = s.members.filter(function (x) { return x.id !== id; }); });
    },
    'join-open': function () { openJoin(); },
    'notify-enable': function () {
      var msg = document.getElementById('notifyMsg');
      var st = state();
      if (!DORM.push || !DORM.push.supported()) { if (msg) msg.textContent = t('notify_unsupported'); return; }
      if (!(st.settings.sync && st.settings.sync.url)) { if (msg) msg.textContent = t('notify_need_sync'); return; }
      if (!st.settings.vapidPublicKey) { if (msg) msg.textContent = t('notify_need_vapid'); return; }
      var meName = member(st.settings.me) ? member(st.settings.me).name : null;
      if (msg) msg.textContent = '…';
      DORM.push.enable(meName).then(function () {
        if (msg) msg.textContent = t('notify_on');
      }).catch(function (e) {
        if (msg) msg.textContent = e && e.message === 'denied' ? t('notify_denied') : t('notify_error');
      });
    },
    'join-submit': function () {
      var st = state();
      var name = (document.getElementById('joinName').value || '').trim();
      var room = document.getElementById('joinRoom').value;
      var err = document.getElementById('joinErr');
      if (!name) { return; }
      if (st.settings.joinCode) {
        var code = (document.getElementById('joinCodeIn').value || '').trim();
        if (code !== st.settings.joinCode) {
          err.textContent = t('join_bad_code'); err.hidden = false; return;
        }
        try { localStorage.setItem(GATE_KEY, code); } catch (e) {}
      }
      S.update(function (s) {
        s.members.push({
          id: DORM.store.uid(), name: name, room: room,
          color: nextColor(s.members.length), status: 'pending'
        });
      });
      closeModal();
      alert(t('join_sent'));
    },
    'gate-submit': function () {
      var code = (document.getElementById('gateInput').value || '').trim();
      var err = document.getElementById('gateErr');
      if (code && code === (state().settings.joinCode || '').trim()) {
        try { localStorage.setItem(GATE_KEY, code); } catch (e) {}
        closeModal();
        maybeTour();
      } else {
        err.textContent = t('gate_bad'); err.hidden = false;
      }
    },
    'week': function (el) {
      var d = +el.getAttribute('data-d');
      if (d === 0) viewDate = new Date();
      else viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate() + d * 7);
      render();
    },
    'swap': function (el) { swapModal(el.getAttribute('data-role'), el.getAttribute('data-wk')); },
    'swap-save': function (el) {
      var role = el.getAttribute('data-role'), wk = el.getAttribute('data-wk');
      var to = document.getElementById('swapTo').value;
      var note = document.getElementById('swapNote').value;
      S.update(function (s) { DORM.rotation.setOverride(s, weekDateFromKey(wk), role, to, note); });
      closeModal();
    },
    'swap-reset': function (el) {
      var role = el.getAttribute('data-role'), wk = el.getAttribute('data-wk');
      S.update(function (s) { DORM.rotation.setOverride(s, weekDateFromKey(wk), role, null, ''); });
      closeModal();
    },
    'add-exp': function () { addExpenseModal(); },
    'exp-save': function () {
      var desc = document.getElementById('expDesc').value;
      var amount = parseFloat(document.getElementById('expAmount').value);
      var payer = document.getElementById('expPayer').value;
      var cat = document.getElementById('expCat').value;
      if (!(amount > 0) || !payer) { return; }
      var split = Array.prototype.slice.call(document.querySelectorAll('.splitM:checked'))
        .map(function (x) { return x.value; });
      var fileInput = document.getElementById('expReceipt');
      var file = fileInput && fileInput.files && fileInput.files[0];
      S.update(function (s) {
        DORM.expenses.addExpense(s, { desc: desc, amount: amount, payer: payer, category: cat, split: split });
      });
      var newId = state().expenses[0] && state().expenses[0].id;
      closeModal();
      // Optional receipt: upload + AI-parse in the background.
      if (file && DORM.receipts && DORM.receipts.enabled() && newId) {
        DORM.receipts.attach(newId, payer, amount, file).then(function (res) {
          alert(res && res.ok ? t('receipt_parsed') : t('receipt_failed'));
        }).catch(function () { alert(t('receipt_failed')); });
      }
    },
    'del-exp': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) {
        DORM.expenses.removeExpense(s, id);
        DORM.comments.removeForExpense(s, id);
      });
    },
    'receipt': function (el) { receiptModal(el.getAttribute('data-id')); },
    'comments': function (el) { commentsModal(el.getAttribute('data-id')); },
    'comment-add': function (el) {
      var expenseId = el.getAttribute('data-id');
      var ta = document.getElementById('cmText');
      var text = ta ? ta.value : '';
      if (!(text || '').trim()) return;
      S.update(function (s) { DORM.comments.add(s, expenseId, s.settings.me, text); });
      markSeen(expenseId);          // my own message counts as read
      commentsModal(expenseId);     // refresh the thread with the new comment
    },
    'comment-del': function (el) {
      var id = el.getAttribute('data-id');
      var expenseId = el.getAttribute('data-exp');
      S.update(function (s) { DORM.comments.remove(s, id); });
      commentsModal(expenseId);
    },
    'sh-quick': function (el) {
      var key = el.getAttribute('data-key');
      S.update(function (s) { DORM.shopping.addCommon(s, key, s.settings.me); });
    },
    'sh-add': function () { shoppingAddModal(); },
    'sh-add-save': function () {
      var name = (document.getElementById('shName').value || '').trim();
      var cat = document.getElementById('shCat').value;
      if (!name) return;
      S.update(function (s) {
        DORM.shopping.addItem(s, { name: name, category: cat, by: s.settings.me, status: 'needed' });
      });
      closeModal();
    },
    'sh-flag': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) { DORM.shopping.setStatus(s, id, 'needed', s.settings.me); });
    },
    'sh-del': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) { DORM.shopping.removeItem(s, id); });
    },
    'sh-bought': function (el) { boughtModal(el.getAttribute('data-id')); },
    'sh-bought-save': function (el) {
      var id = el.getAttribute('data-id');
      var buyer = document.getElementById('shBuyer').value;
      var amount = parseFloat(document.getElementById('shAmount').value);
      S.update(function (s) {
        DORM.shopping.markBought(s, id, buyer, amount > 0 ? amount : 0);
      });
      closeModal();
    },
    'settle': function (el) {
      settleModal(el.getAttribute('data-from'), el.getAttribute('data-to'),
        +el.getAttribute('data-amt'));
    },
    'settle-transfer-save': function (el) {
      var from = el.getAttribute('data-from'), to = el.getAttribute('data-to');
      var amount = parseFloat(document.getElementById('setAmount').value);
      var note = (document.getElementById('setNote').value || '').trim();
      if (!(amount > 0)) return;
      var fileInput = document.getElementById('setProof');
      var file = fileInput && fileInput.files && fileInput.files[0];
      var cur = state().settings.currency;
      // Downscale the proof to a small inline thumbnail (works offline) first,
      // then record the settlement, then optionally push it for an AI check.
      downscaleImage(file, 900, 0.55).then(function (thumb) {
        var recId;
        S.update(function (s) {
          var rec = DORM.expenses.recordSettlement(s, {
            from: from, to: to, amount: amount, note: note, proof: thumb || ''
          });
          recId = rec.id;
        });
        closeModal();
        if (file && DORM.settleproof && DORM.settleproof.enabled()) {
          S.update(function (s) { DORM.expenses.updateSettlement(s, recId, { proofStatus: 'pending' }); });
          DORM.settleproof.upload(recId, amount, cur, file).then(function (res) {
            var v = res && res.verdict;
            var status = v === 'verified' ? 'verified'
              : v === 'rejected' ? 'rejected' : 'attached';
            S.update(function (s) {
              DORM.expenses.updateSettlement(s, recId, { proofStatus: status, proofPath: res.path || '' });
            });
          }).catch(function () {
            S.update(function (s) { DORM.expenses.updateSettlement(s, recId, { proofStatus: 'attached' }); });
          });
        }
      });
    },
    'settle-goods': function (el) {
      var from = el.getAttribute('data-from');
      var amt = +el.getAttribute('data-amt');
      closeModal();
      addExpenseModal({
        payer: from,
        amount: amt ? DORM.expenses.round2(amt) : '',
        split: verified().map(function (m) { return m.id; }),
        note: t('settle_goods_hint')
      });
    },
    'settle-proof': function (el) { settleProofModal(el.getAttribute('data-id')); },
    'del-settle': function (el) {
      if (!confirm(t('settle_del_confirm'))) return;
      var id = el.getAttribute('data-id');
      S.update(function (s) { DORM.expenses.removeSettlement(s, id); });
    },
    'token': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) {
        s.tokensUsed[id] = (s.tokensUsed[id] || 0) + 1;
        s.karma[id] = (s.karma[id] || 0) - DORM.points.TOKEN_COST;
      });
    },
    'm-add': function () {
      S.update(function (s) {
        if (s.members.length >= 8) return;
        var roomA = s.members.filter(function (m) { return m.room === 'A'; }).length;
        s.members.push({
          id: DORM.store.uid(), name: '',
          room: roomA <= s.members.length - roomA ? 'A' : 'B',
          color: nextColor(s.members.length),
          status: 'verified' // added by the admin, so already verified
        });
      });
    },
    'm-del': function (el) {
      var id = el.getAttribute('data-id');
      S.update(function (s) { s.members = s.members.filter(function (m) { return m.id !== id; }); });
    },
    'seed': function () { S.update(function (s) { seed(s); }); },
    'export': function () { exportData(); },
    'import': function () { importData(); },
    'reset': function () {
      if (!confirm(t('set_reset_confirm'))) return;
      S.replaceState(DORM.store.defaultState());
    },
    'sync-on': function () {
      var url = document.getElementById('syncUrl').value.trim();
      var key = document.getElementById('syncKey').value.trim();
      S.update(function (s) { s.settings.sync = (url && key) ? { url: url, key: key } : null; });
      DORM.sync.enable(state().settings.sync);
    },
    'sync-off': function () {
      S.update(function (s) { s.settings.sync = null; });
      DORM.sync.disable();
    }
  };

  var COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f'];
  function nextColor(i) { return COLORS[i % COLORS.length]; }

  function seed(s) {
    var names = ['Adam', 'Bára', 'Cyril', 'Dáša', 'Emil', 'Filip', 'Gábina', 'Honza'];
    s.members = names.map(function (n, i) {
      return { id: DORM.store.uid(), name: n, room: i < 4 ? 'A' : 'B',
        color: nextColor(i), status: 'verified' };
    });
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bulka-data.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importData() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(r.result);
          DORM.store.replaceState(data);
          if (data.settings && data.settings.lang) DORM.i18n.setLang(data.settings.lang);
          render();
        } catch (e) { alert('Invalid file'); }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  DORM.ui = { bind: bind, render: render };
})(window.DORM = window.DORM || {});
