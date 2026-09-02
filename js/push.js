/*
 * push.js — Web Push subscription (client side).
 *
 * Lets a device opt in to "your turn" notifications. Requires:
 *   - a service worker (sw.js) registered
 *   - a VAPID public key (Settings -> Notifications; the private half stays in
 *     Supabase Edge Function secrets)
 *   - Supabase sync configured (subscriptions are stored in push_subscriptions)
 *
 * The weekly send is done server-side by the `notify-duty` Edge Function.
 */
(function (DORM) {
  'use strict';

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function b64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }

  function status() {
    if (!supported()) return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  }

  /** Subscribe this device and store the subscription in Supabase. */
  function enable(memberName) {
    var st = DORM.store.get();
    var vapid = (st.settings.vapidPublicKey || '').trim();
    var sync = st.settings.sync;
    if (!supported()) return Promise.reject(new Error('unsupported'));
    if (!vapid) return Promise.reject(new Error('no-vapid'));
    if (!sync || !sync.url || !sync.key) return Promise.reject(new Error('no-sync'));

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('denied');
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        return existing || reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid)
        });
      });
    }).then(function (sub) {
      var json = sub.toJSON();
      var row = {
        member_name: memberName || null,
        endpoint: sub.endpoint,
        p256dh: json.keys && json.keys.p256dh,
        auth: json.keys && json.keys.auth
      };
      return fetch(sync.url.replace(/\/$/, '') + '/rest/v1/push_subscriptions', {
        method: 'POST',
        headers: {
          'apikey': sync.key, 'Authorization': 'Bearer ' + sync.key,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify([row])
      }).then(function (r) {
        if (!r.ok) throw new Error('store-failed');
        return true;
      });
    });
  }

  DORM.push = { supported: supported, status: status, enable: enable };
})(window.DORM = window.DORM || {});
