/*
 * app.js — bootstrap. Wires the store, language, optional sync and UI together.
 */
(function (DORM) {
  'use strict';

  function boot() {
    var st = DORM.store.get();
    DORM.i18n.setLang(st.settings.lang || 'cs');

    // Accounts + multi-cell mode (opt-in via ?auth=1). The flow controller
    // handles login, cell selection and mounting the app; skip normal boot.
    if (DORM.auth && DORM.auth.enabled()) { DORM.authflow.start(); return; }

    var main = document.getElementById('main');
    var modal = document.getElementById('modal');
    DORM.ui.bind(main, modal);

    // re-render on every state change
    DORM.store.subscribe(function () { DORM.ui.render(); });

    // sync status indicator
    DORM.sync.onStatus(function (s) {
      var dot = document.getElementById('syncDot');
      if (!dot) return;
      dot.className = 'sync-dot ' + s;
      dot.title = 'sync: ' + s;
    });

    // Enable sync. Priority: an explicit manual override, then the baked-in
    // public default (js/config.js) so every roommate is synced out of the box.
    // A user can still turn it off (settings.syncDisabled) in Settings.
    var cfg = st.settings.sync || (st.settings.syncDisabled ? null : DORM.defaultSync());
    if (cfg) DORM.sync.enable(cfg);

    DORM.ui.render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window.DORM = window.DORM || {});
