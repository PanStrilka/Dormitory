/*
 * sw.js — service worker for offline use + installability.
 *
 * Strategy: precache the app shell on install; serve same-origin GET requests
 * cache-first with a background refresh (stale-while-revalidate). Cross-origin
 * requests (e.g. Supabase) always go to the network. Bump CACHE when files
 * change so old assets are cleaned up.
 */
var CACHE = 'bulka-v31';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/config.js',
  './js/duties.js',
  './js/i18n.js',
  './js/store.js',
  './js/rotation.js',
  './js/points.js',
  './js/expenses.js',
  './js/comments.js',
  './js/stats.js',
  './js/sync.js',
  './js/push.js',
  './js/receipts.js',
  './js/settleproof.js',
  './js/camera.js',
  './js/verifytask.js',
  './js/shopping.js',
  './js/auth.js',
  './js/authflow.js',
  './js/install.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-256.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Don't fail the whole install if one optional asset 404s.
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// ---- Web push: show the notification and focus the app on tap ----
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  var title = data.title || 'Bulka';
  var options = {
    body: data.body || '',
    icon: 'icons/icon-256.png',
    badge: 'icons/icon-256.png',
    tag: data.tag || 'bulka',
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Supabase etc. hit network

  // Network-first for the app itself (HTML + JS + CSS) so a new deploy applies
  // on the FIRST reload when online — no more "reload twice to get the fix".
  // Falls back to cache when offline. Other assets (icons) stay cache-first.
  var isAppCode = req.mode === 'navigate' ||
    /\.(?:js|css|webmanifest|html)(?:$|\?)/.test(url.pathname) || url.pathname === '/' ||
    url.pathname.slice(-1) === '/';

  if (isAppCode) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Cache-first + background refresh for everything else.
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
