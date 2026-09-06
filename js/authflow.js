/*
 * authflow.js — screens + admin panel for the accounts/multi-cell mode.
 * Drives: login → profile name → join a cell / pending → pick cell → mount the
 * chores app (bound to that cell's state). Admins get a control panel.
 * Runs only when DORM.auth.enabled(); the normal app is untouched otherwise.
 */
(function (DORM) {
  'use strict';

  var t = DORM.i18n ? DORM.i18n.t : function (k) { return k; };
  var mainEl, modalEl;
  var current = { cellId: null, role: null, profile: null };
  var mounted = false;

  var COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function screen(html) {
    document.body.classList.add('auth-screen');
    mainEl.innerHTML = '<div class="auth-wrap">' + html + '</div>';
  }
  function appMode() { document.body.classList.remove('auth-screen'); }

  function start() {
    mainEl = document.getElementById('main');
    modalEl = document.getElementById('modal');
    screen('<div class="auth-card"><div class="auth-logo">🧽</div><p class="muted">…</p></div>');
    DORM.auth.init().then(function (session) {
      DORM.auth.onChange(function (s) { route(); });
      route();
    }).catch(function (e) {
      screen('<div class="auth-card"><div class="auth-logo">🧽</div>' +
        '<p class="err-msg">' + t('auth_err_init') + '</p>' +
        '<p class="muted sm">' + esc(e && e.message || '') + '</p></div>');
    });
  }

  function route() {
    DORM.auth.me().then(function (u) {
      if (!u) return renderLogin();
      return DORM.auth.myProfile().then(function (p) {
        current.profile = p;
        if (!p || !p.display_name) return renderName(u);
        return DORM.auth.myMemberships().then(function (ms) {
          var verified = ms.filter(function (m) { return m.status === 'verified'; });
          var pending = ms.filter(function (m) { return m.status === 'pending'; });
          if (verified.length === 1) return enterCell(verified[0]);
          if (verified.length > 1) return renderCellPicker(verified);
          if (pending.length) return renderPending(pending[0]);
          return renderJoin();
        });
      });
    }).catch(function (e) {
      screen('<div class="auth-card"><p class="err-msg">' + esc(e && e.message || 'error') + '</p>' +
        '<button class="btn ghost" data-authact="signout">' + t('auth_signout') + '</button></div>');
    });
  }

  // ---- screens ----
  function renderLogin() {
    screen('<div class="auth-card"><div class="auth-logo">🧽</div>' +
      '<h2>' + t('auth_welcome') + '</h2>' +
      '<p class="muted">' + t('auth_login_hint') + '</p>' +
      '<label class="field"><span>Email</span><input type="email" id="authEmail" ' +
      'placeholder="you@email.com" autocomplete="email"></label>' +
      '<button class="btn big" data-authact="signin">' + t('auth_send_link') + '</button>' +
      '<div id="authMsg" class="muted sm center"></div></div>');
  }

  function renderName(u) {
    screen('<div class="auth-card"><div class="auth-logo">👋</div>' +
      '<h2>' + t('auth_your_name') + '</h2>' +
      '<label class="field"><input type="text" id="authName" placeholder="' + t('join_name') +
      '" value="' + esc((u.email || '').split('@')[0]) + '"></label>' +
      '<button class="btn big" data-authact="savename">' + t('save') + '</button>' +
      '<button class="btn link" data-authact="signout">' + t('auth_signout') + '</button></div>');
  }

  function renderJoin() {
    DORM.auth.listCells().then(function (cells) {
      var opts = cells.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      screen('<div class="auth-card"><div class="auth-logo">🏢</div>' +
        '<h2>' + t('auth_join_title') + '</h2>' +
        (cells.length
          ? '<p class="muted">' + t('auth_join_hint') + '</p>' +
            '<label class="field"><span>' + t('auth_cell') + '</span><select id="joinCell">' + opts + '</select></label>' +
            '<label class="field"><span>' + t('join_room') + '</span><select id="joinRoom">' +
            '<option value="A">A</option><option value="B">B</option></select></label>' +
            '<button class="btn big" data-authact="join">' + t('join_submit') + '</button>'
          : '<p class="muted">' + t('auth_no_cells') + '</p>') +
        (current.profile && current.profile.is_superadmin
          ? '<div class="mt"><h3>' + t('auth_super') + '</h3>' +
            '<label class="field"><span>' + t('auth_new_cell') + '</span>' +
            '<input type="text" id="bootCellName" placeholder="Buňka 2"></label>' +
            '<label class="field"><span>' + t('join_code') + '</span><input type="text" id="bootCellCode" placeholder="—"></label>' +
            '<button class="btn" data-authact="bootcell">' + t('auth_create_cell') + '</button></div>'
          : '') +
        '<div id="authMsg" class="muted sm center"></div>' +
        '<button class="btn link" data-authact="signout">' + t('auth_signout') + '</button></div>');
    });
  }

  function renderPending(m) {
    screen('<div class="auth-card"><div class="auth-logo">⏳</div>' +
      '<h2>' + t('auth_pending_title') + '</h2>' +
      '<p class="muted">' + t('auth_pending_hint') + '</p>' +
      '<button class="btn ghost" data-authact="refresh">' + t('auth_refresh') + '</button>' +
      '<button class="btn link" data-authact="signout">' + t('auth_signout') + '</button></div>');
  }

  function renderCellPicker(verified) {
    var rows = verified.map(function (m) {
      return '<button class="btn big" data-authact="entercell" data-cell="' + m.cell_id +
        '" data-role="' + m.role + '">' + esc(m.cells ? m.cells.name : m.cell_id) + '</button>';
    }).join('');
    screen('<div class="auth-card"><div class="auth-logo">🏢</div>' +
      '<h2>' + t('auth_pick_cell') + '</h2>' + rows +
      '<button class="btn link" data-authact="signout">' + t('auth_signout') + '</button></div>');
  }

  // ---- enter a cell: bind chores app to that cell's state ----
  function enterCell(m) {
    var cellId = m.cell_id || m.cellId || m;
    current.cellId = cellId;
    current.role = m.role || current.role;
    appMode();

    // Route the store's sync at this cell's row, then mount the normal UI.
    var sync = DORM.auth.cellSync(cellId);
    DORM.sync = sync;
    if (!mounted) { DORM.ui.bind(mainEl, modalEl); mounted = true; }
    DORM.store.subscribe(function () { DORM.ui.render(); });
    sync.onStatus(function (s) {
      var dot = document.getElementById('syncDot');
      if (dot) { dot.className = 'sync-dot ' + s; dot.title = 'sync: ' + s; }
    });
    sync.enable();

    // Populate the app's member list from this cell's verified accounts.
    DORM.auth.cellMembers(cellId).then(function (list) {
      var verified = list.filter(function (x) { return x.status === 'verified'; });
      DORM.store.update(function (st) {
        st.members = verified.map(function (x, i) {
          var name = x.display_name || (x.profiles && x.profiles.display_name) || '—';
          return { id: x.user_id, name: name, room: x.room || 'A',
            color: COLORS[i % COLORS.length], status: 'verified' };
        });
        // "me" = my account
        DORM.auth.me().then(function (u) {
          if (u) { DORM.store.update(function (s2) { s2.settings.me = u.id; }); }
        });
      });
      showAdminButton();
      DORM.ui.render();
    });
  }

  function showAdminButton() {
    var box = document.querySelector('.header-right');
    if (!box || document.getElementById('adminBtn')) return;
    if (current.role === 'cell_admin' || (current.profile && current.profile.is_superadmin)) {
      var b = document.createElement('button');
      b.id = 'adminBtn'; b.className = 'btn ghost sm icon-btn'; b.textContent = '🛠️';
      b.title = t('auth_admin'); b.setAttribute('data-authact', 'admin');
      box.insertBefore(b, box.firstChild);
    }
  }

  // ---- admin panel ----
  function renderAdmin() {
    var cellId = current.cellId;
    var isSuper = current.profile && current.profile.is_superadmin;
    screen('<div class="auth-card wide"><div class="row between">' +
      '<h2>🛠️ ' + t('auth_admin') + '</h2>' +
      '<button class="btn ghost sm" data-authact="admin-close">✕</button></div>' +
      '<div id="adminBody"><p class="muted">…</p></div></div>');
    DORM.auth.cellMembers(cellId).then(function (list) {
      var pending = list.filter(function (x) { return x.status === 'pending'; });
      var members = list.filter(function (x) { return x.status === 'verified'; });
      function nm(x) { return esc(x.display_name || (x.profiles && x.profiles.display_name) || '—'); }
      var html = '';
      html += '<h3>' + t('verify_pending_title') + ' (' + pending.length + ')</h3>';
      html += pending.length ? pending.map(function (x) {
        return '<div class="mrow pend"><span class="pn">' + nm(x) + ' · ' + esc(x.room || '?') + '</span>' +
          '<button class="btn sm" data-authact="approve" data-id="' + x.id + '">' + t('verify_approve') + '</button>' +
          '<button class="btn ghost sm" data-authact="reject" data-id="' + x.id + '">' + t('verify_reject') + '</button></div>';
      }).join('') : '<p class="muted sm">' + t('verify_none') + '</p>';

      html += '<h3 class="mt">' + t('auth_members') + ' (' + members.length + ')</h3>';
      html += members.map(function (x) {
        return '<div class="mrow"><span class="pn">' + nm(x) +
          (x.role === 'cell_admin' ? ' <span class="badge you">admin</span>' : '') + '</span>' +
          '<select data-authact="room" data-id="' + x.id + '">' +
          '<option value="A"' + (x.room === 'A' ? ' selected' : '') + '>A</option>' +
          '<option value="B"' + (x.room === 'B' ? ' selected' : '') + '>B</option></select>' +
          '<button class="btn ghost sm" data-authact="toggleadmin" data-id="' + x.id + '" data-role="' + x.role + '">' +
          (x.role === 'cell_admin' ? t('auth_unadmin') : t('auth_makeadmin')) + '</button>' +
          '<button class="btn ghost sm" data-authact="removemember" data-id="' + x.id + '">🗑</button></div>';
      }).join('');

      if (isSuper) {
        html += '<h3 class="mt">' + t('auth_super') + '</h3>' +
          '<label class="field"><span>' + t('auth_new_cell') + '</span>' +
          '<input type="text" id="newCellName" placeholder="Buňka 3"></label>' +
          '<label class="field"><span>' + t('join_code') + '</span><input type="text" id="newCellCode" placeholder="—"></label>' +
          '<button class="btn" data-authact="createcell">' + t('auth_create_cell') + '</button>';
      }
      document.getElementById('adminBody').innerHTML = html;
    });
  }

  // ---- actions ----
  function msg(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }

  function bindEvents() {
    document.body.addEventListener('click', function (e) {
      var el = e.target.closest('[data-authact]');
      if (!el) return;
      var act = el.getAttribute('data-authact');
      if (act === 'signin') {
        var email = (document.getElementById('authEmail').value || '').trim();
        if (!email) return;
        msg('authMsg', '…');
        DORM.auth.signIn(email).then(function (r) {
          msg('authMsg', r.error ? (r.error.message || t('auth_err')) : t('auth_link_sent'));
        }).catch(function () { msg('authMsg', t('auth_err')); });
      } else if (act === 'savename') {
        var name = (document.getElementById('authName').value || '').trim();
        DORM.auth.ensureProfile(name).then(route);
      } else if (act === 'signout') {
        DORM.auth.signOut().then(function () { location.reload(); });
      } else if (act === 'join') {
        var cell = document.getElementById('joinCell').value;
        var room = document.getElementById('joinRoom').value;
        var nm = current.profile && current.profile.display_name;
        msg('authMsg', '…');
        DORM.auth.requestJoin(cell, room, nm).then(route)
          .catch(function () { msg('authMsg', t('auth_err')); });
      } else if (act === 'refresh') {
        route();
      } else if (act === 'entercell') {
        enterCell({ cell_id: el.getAttribute('data-cell'), role: el.getAttribute('data-role') });
      } else if (act === 'admin') {
        renderAdmin();
      } else if (act === 'admin-close') {
        appMode(); DORM.ui.render();
      } else if (act === 'approve') {
        DORM.auth.setMembership(el.getAttribute('data-id'), { status: 'verified' }).then(renderAdmin);
      } else if (act === 'reject') {
        DORM.auth.setMembership(el.getAttribute('data-id'), { status: 'rejected' }).then(renderAdmin);
      } else if (act === 'toggleadmin') {
        var role = el.getAttribute('data-role') === 'cell_admin' ? 'member' : 'cell_admin';
        DORM.auth.setMembership(el.getAttribute('data-id'), { role: role }).then(renderAdmin);
      } else if (act === 'removemember') {
        DORM.auth.removeMembership(el.getAttribute('data-id')).then(renderAdmin);
      } else if (act === 'createcell') {
        var cn = (document.getElementById('newCellName').value || '').trim();
        if (!cn) return;
        DORM.auth.createCell(cn, (document.getElementById('newCellCode').value || '').trim()).then(renderAdmin);
      } else if (act === 'bootcell') {
        // Super-admin creates the first cell and joins it as verified admin.
        var bn = (document.getElementById('bootCellName').value || '').trim();
        if (!bn) return;
        msg('authMsg', '…');
        var nm2 = current.profile && current.profile.display_name;
        DORM.auth.createCell(bn, (document.getElementById('bootCellCode').value || '').trim())
          .then(function (cell) {
            return DORM.auth.requestJoin(cell.id, 'A', nm2).then(function (m) {
              return DORM.auth.setMembership(m.id, { status: 'verified', role: 'cell_admin' });
            });
          }).then(route).catch(function () { msg('authMsg', t('auth_err')); });
      }
    });
    document.body.addEventListener('change', function (e) {
      var el = e.target.closest('[data-authact="room"]');
      if (el) DORM.auth.setMembership(el.getAttribute('data-id'), { room: el.value });
    });
  }

  DORM.authflow = {
    start: function () { bindEvents(); start(); },
    route: route, enterCell: enterCell, renderAdmin: renderAdmin,
    current: current,
    isAdmin: function () {
      return current.role === 'cell_admin' || (current.profile && current.profile.is_superadmin);
    }
  };
})(window.DORM = window.DORM || {});
