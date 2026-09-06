/*
 * config.js — baked-in PUBLIC backend configuration.
 *
 * This makes shared sync work out of the box for every roommate: nobody has to
 * paste a URL or key in Settings. The app still lets you override or disable it
 * there (Nastavení → Data a synchronizace).
 *
 * ⚠️ ONLY the public project URL and the PUBLISHABLE (anon) key belong here.
 *    They are designed to be shipped in client code — access is gated by
 *    Row Level Security plus the in-app join code (see supabase/schema.sql).
 *    NEVER put the SECRET key (sb_secret_… / service_role) here or anywhere in
 *    this repository — this site is published publicly on GitHub Pages. Secret
 *    keys live only in Supabase → Edge Functions → Secrets. See docs/SETUP.md.
 *
 * To disable the baked-in default, leave url/key empty.
 */
(function (DORM) {
  'use strict';

  DORM.CONFIG = {
    // Supabase project URL (public).
    url: 'https://kfgbdsnvatjlbytfnuad.supabase.co',
    // Publishable (anon) key — public by design, protected by RLS + join code.
    key: 'sb_publishable_QArzgPEMgL0RndHKc-0Dmw_Omvys6Hj',
    // Accounts + multi-cell mode is now the default for everyone (real logins).
    // A user can still fall back to the local honor-based app with ?auth=0.
    authMode: true
  };

  /** The baked-in default sync config, or null if not configured. */
  DORM.defaultSync = function () {
    var c = DORM.CONFIG;
    return (c && c.url && c.key) ? { url: c.url, key: c.key } : null;
  };
})(window.DORM = window.DORM || {});
