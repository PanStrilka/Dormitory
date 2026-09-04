/*
 * app.js — bootstrap. Wires the store, language, optional sync and UI together.
 */
(function (DORM) {
  'use strict';

  function boot() {
    var st = DORM.store.get();
    DORM.i18n.setLang(st.settings.lang || 'cs');

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

    // enable sync if previously configured
    if (st.settings.sync) DORM.sync.enable(st.settings.sync);

    DORM.ui.render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window.DORM = window.DORM || {});
