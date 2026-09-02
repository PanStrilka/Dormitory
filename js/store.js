/*
 * store.js — application state, persistence and ISO-week helpers.
 *
 * State is a single JSON object. It is saved to localStorage on every change
 * (works instantly, offline, on any phone). An optional Supabase adapter can
 * mirror the same object to the cloud so all 8 roommates share one dataset —
 * see sync.js. Nothing here depends on Supabase; it is purely additive.
 */
(function (DORM) {
  'use strict';

  var STORAGE_KEY = 'bulka_state_v1';
  var listeners = [];

  function defaultState() {
    return {
      version: 1,
      settings: {
        lang: 'cs',
        startDate: '2026-09-01', // Monday-based ISO weeks are computed from here
        currency: 'CZK',
        me: null,   // which member "I am" on this device (highlights my turn)
        roomNames: { A: 'Pokoj 1', B: 'Pokoj 2' }, // two equal rooms, admin-renamable
        sync: null  // { url, key } when Supabase sync is enabled
      },
      members: [],            // { id, name, room: 'A'|'B', color }
      overrides: {},          // "2026-W36|KITCHEN" -> memberId (manual/swap assignment)
      completions: {},        // "2026-W36|KITCHEN" -> { items: {taskId:true}, by: memberId }
      swaps: [],              // audit log of hand-overs
      expenses: [],           // { id, payer, amount, desc, category, split:[ids], ts }
      settlements: [],        // { id, from, to, amount, ts }
      karma: {},              // memberId -> manual karma adjustments (buying bonuses, tokens)
      tokensUsed: {}          // memberId -> count of immunity tokens spent
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { /* ignore corrupt/blocked storage */ }
    return defaultState();
  }

  function migrate(s) {
    var d = defaultState();
    // shallow-merge so new fields appear on older saved states
    Object.keys(d).forEach(function (k) {
      if (!(k in s)) s[k] = d[k];
    });
    Object.keys(d.settings).forEach(function (k) {
      if (!(k in s.settings)) s.settings[k] = d.settings[k];
    });
    return s;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    if (DORM.sync && DORM.sync.push) DORM.sync.push(state);
  }

  /** Replace the whole state (used by import / incoming sync). */
  function replaceState(next) {
    state = migrate(next || defaultState());
    persist();
    emit();
  }

  function get() { return state; }

  /** Mutate state through a function, then persist + notify. */
  function update(fn) {
    fn(state);
    persist();
    emit();
  }

  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  // ---------- ISO week helpers ----------

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** ISO-8601 week key like "2026-W36" for a given Date. */
  function isoWeekKey(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var day = d.getUTCDay() || 7;            // Mon=1..Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);  // nearest Thursday
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + pad(week);
  }

  /** Monday (local) of the ISO week containing `date`. */
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Whole weeks from the configured start date to `date` (can be negative). */
  function weekIndex(date) {
    var start = mondayOf(new Date(state.settings.startDate + 'T00:00:00'));
    var cur = mondayOf(date);
    return Math.round((cur - start) / (7 * 86400000));
  }

  /** Does the ISO week containing `date` contain the 1st of some month? */
  function isMonthlyWeek(date) {
    var mon = mondayOf(date);
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      if (d.getDate() === 1) return true;
    }
    return false;
  }

  /** Human date range "1.–7. 9." for the week of `date`, localized loosely. */
  function weekRange(date) {
    var mon = mondayOf(date);
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return mon.getDate() + '.' + (mon.getMonth() + 1) + '. – ' +
           sun.getDate() + '.' + (sun.getMonth() + 1) + '.';
  }

  function dateFromWeekIndex(idx) {
    var start = mondayOf(new Date(state.settings.startDate + 'T00:00:00'));
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + idx * 7);
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  DORM.store = {
    STORAGE_KEY: STORAGE_KEY,
    defaultState: defaultState,
    get: get,
    update: update,
    replaceState: replaceState,
    subscribe: subscribe,
    isoWeekKey: isoWeekKey,
    mondayOf: mondayOf,
    weekIndex: weekIndex,
    isMonthlyWeek: isMonthlyWeek,
    weekRange: weekRange,
    dateFromWeekIndex: dateFromWeekIndex,
    uid: uid
  };
})(window.DORM = window.DORM || {});
