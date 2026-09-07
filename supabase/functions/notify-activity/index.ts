// ============================================================================
//  Supabase Edge Function: notify-activity
//  Sends a web-push notification to everyone in the flat EXCEPT the person who
//  triggered it — used for "someone commented on a purchase" and "someone
//  bought something". The client composes the (localised) title + body and
//  posts them here; this function just fans them out to the stored push
//  subscriptions.
//
//  Secrets (Edge Functions -> Secrets) — same pair as notify-duty:
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//  Deploy: Edge Functions -> Deploy a new function, name `notify-activity`,
//  paste this file. See docs/SETUP.md (Stage 4, notifications).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "Bulka").slice(0, 120);
    const text = String(body.body || "").slice(0, 300);
    const exclude = String(body.exclude_name || "").trim();
    const tag = String(body.tag || "activity").slice(0, 40);
    const url = String(body.url || "./").slice(0, 200);
    if (!text) return json({ ok: false, error: "empty body" }, 400);

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: subs } = await db.from("push_subscriptions").select("*");
    const payload = JSON.stringify({ title, body: text, tag, url });

    let sent = 0, removed = 0, failed = 0;
    for (const sub of subs || []) {
      // Don't notify the person who caused the event.
      if (exclude && (sub.member_name || "").trim() === exclude) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          removed++;
        } else {
          failed++;
        }
      }
    }
    return json({ ok: true, sent, removed, failed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message.slice(0, 300) }, 200);
  }
});
