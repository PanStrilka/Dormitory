/*
 * install.js — "Install this app" prompt (PWA / add to home screen).
 *
 * Chrome/Edge/Android fire `beforeinstallprompt`; we stash it and show a small
 * dismissible banner with a one-tap Install button. iOS Safari has no such
 * event, so there we show the manual "Share → Add to Home Screen" hint. If the
 * app is already installed (display-mode: standalone) nothing is shown.
 *
 * A "📲 Install" button in Settings re-opens this any time (even after dismiss).
 */
(function (DORM) {
  'use strict';

  var deferred = null;            // the stashed beforeinstallprompt event
  var DISMISS_KEY = 'bulka_install_dismissed';

  function t(k) { return (DORM.i18n && DORM.i18n.t) ? DORM.i18n.t(k) : k; }
  function isStandalone() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }
  function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } }
  function setDismissed() { try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {} }

  function bar() {
    var b = document.getElementById('installBar');
    if (!b) { b = document.createElement('div'); b.id = 'installBar'; b.className = 'install-bar'; document.body.appendChild(b); }
    return b;
  }
  function hide() { var b = document.getElementById('installBar'); if (b) b.hidden = true; }

  // Build the banner: icon + text, an optional Install button, and a close ✕.
  function render(text, withButton) {
    var b = bar();
    b.innerHTML = '<span class="ib-ic">📲</span>' +
      '<span class="ib-txt">' + text + '</span>' +
      (withButton ? '<button class="btn sm" data-installact="go">' + t('install_btn') + '</button>' : '') +
      '<button class="ib-x" data-installact="close" aria-label="✕">✕</button>';
    b.hidden = false;
    return b;
  }

  // Show the appropriate prompt. `force` ignores the "dismissed" flag (used by
  // the Settings button so the user can always bring it back).
  function show(force) {
    if (isStandalone()) return 'installed';
    if (!force && dismissed()) return 'dismissed';
    if (deferred) { render(t('install_prompt'), true); return 'prompt'; }
    if (isIOS()) { render(t('install_ios'), false); return 'ios'; }
    // Other browsers: no install event available yet (or criteria not met).
    render(t('install_generic'), false);
    return 'generic';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (!isStandalone() && !dismissed()) show();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null; setDismissed(); hide();
    if (DORM.ui && DORM.ui.toast) { /* toast is internal; skip */ }
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-installact]');
    if (!el) return;
    var act = el.getAttribute('data-installact');
    if (act === 'close') { setDismissed(); hide(); }
    else if (act === 'go' && deferred) {
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; hide(); });
    }
  });

  function init() {
    if (isStandalone()) return;
    // Chrome may fire beforeinstallprompt right after load; give it a moment,
    // otherwise fall back to the iOS/generic hint.
    setTimeout(function () { if (!dismissed()) show(); }, 1800);
  }

  DORM.install = { init: init, show: show, isStandalone: isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.DORM = window.DORM || {});
