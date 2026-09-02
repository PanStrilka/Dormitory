// ============================================================================
//  Supabase Edge Function: notify-duty
//  Computes who is on duty THIS week (from the shared state) and sends each of
//  them a web-push "it's your turn" notification. Meant to run weekly (Monday
//  morning) — schedule it with pg_cron or a Supabase scheduled trigger.
//
//  Secrets (Edge Functions -> Secrets):
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   – your web-push key pair
//    VAPID_SUBJECT                         – e.g. mailto:you@example.com
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//  The rotation math here mirrors js/rotation.js + js/store.js exactly so the
//  server and the app always agree on who is on duty.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLE_LABELS: Record<string, { cs: string; en: string }> = {
  KITCHEN: { cs: "Kuchyňka + koš", en: "Kitchen + trash" },
  BATHROOM: { cs: "Koupelna + WC", en: "Bathroom + WC" },
};

// ---- date / rotation helpers (ported from the app) ----
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - (day - 1));
  return x;
}
function weekIndex(date: Date, startDate: string): number {
  const start = mondayOf(new Date(startDate + "T00:00:00Z"));
  const cur = mondayOf(date);
  return Math.round((cur.getTime() - start.getTime()) / (7 * 86400000));
}
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : "" + week);
}
function mod(i: number, n: number) { return ((i % n) + n) % n; }

function verified(members: any[]) { return members.filter((m) => m.status === "verified"); }

function baseAssignee(members: any[], roleId: string, wi: number) {
  const all = verified(members);
  if (!all.length) return null;
  const roomA = all.filter((m) => m.room === "A");
  const roomB = all.filter((m) => m.room === "B");
  if (roleId === "ROOM_A") return roomA.length ? roomA[mod(wi, roomA.length)] : null;
  if (roleId === "ROOM_B") return roomB.length ? roomB[mod(wi + 2, roomB.length)] : null;
  const a = roomA.length ? roomA[mod(wi, roomA.length)] : null;
  const b = roomB.length ? roomB[mod(wi + 2, roomB.length)] : null;
  let remaining = all.filter((m) => (!a || m.id !== a.id) && (!b || m.id !== b.id));
  if (!remaining.length) remaining = all;
  const slot = roleId === "KITCHEN" ? 0 : 1;
  return remaining[mod(wi * 2 + slot, remaining.length)];
}

function assignee(state: any, roleId: string, date: Date) {
  const wk = isoWeekKey(date);
  const ov = (state.overrides || {})[wk + "|" + roleId];
  if (ov) {
    const m = (state.members || []).filter((x: any) => x.id === ov)[0];
    if (m) return m;
  }
  return baseAssignee(state.members || [], roleId, weekIndex(date, state.settings.startDate));
}

function roleName(state: any, roleId: string, lang: string) {
  const rn = state.settings.roomNames || {};
  if (roleId === "ROOM_A") return rn.A || (lang === "en" ? "Room 1" : "Pokoj 1");
  if (roleId === "ROOM_B") return rn.B || (lang === "en" ? "Room 2" : "Pokoj 2");
  return ROLE_LABELS[roleId][lang === "en" ? "en" : "cs"];
}

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  // 1) Load the shared app state.
  const { data: row } = await db.from("bulka_state").select("data").eq("id", "shared").single();
  const state = row?.data;
  if (!state || !state.settings) return new Response("no state", { status: 200 });
  const lang = state.settings.lang || "cs";
  const now = new Date();

  // 2) Who is on duty this week, per role.
  const roles = ["ROOM_A", "ROOM_B", "KITCHEN", "BATHROOM"];
  const dutyByName: Record<string, string[]> = {};
  for (const roleId of roles) {
    const m = assignee(state, roleId, now);
    if (m && m.name) {
      (dutyByName[m.name] ||= []).push(roleName(state, roleId, lang));
    }
  }

  // 3) Send a push to every subscription of each on-duty person.
  const { data: subs } = await db.from("push_subscriptions").select("*");
  let sent = 0, removed = 0;
  for (const sub of subs || []) {
    const roleList = dutyByName[sub.member_name];
    if (!roleList) continue;
    const body = lang === "en"
      ? "This week you're on duty: " + roleList.join(", ")
      : "Tento týden máš službu: " + roleList.join(", ");
    const payload = JSON.stringify({ title: "Bulka", body, tag: "duty", url: "./" });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (e: any) {
      // 404/410 = the subscription is gone; clean it up.
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        removed++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, removed }), {
    headers: { "Content-Type": "application/json" },
  });
});
