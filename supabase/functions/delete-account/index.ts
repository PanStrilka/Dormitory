// ============================================================================
//  Supabase Edge Function: delete-account
//  Lets a signed-in user delete THEIR OWN account: their memberships, their
//  profile row, and finally the auth user. Uses the caller's JWT only to learn
//  who they are — it can never delete anyone else.
//
//  No extra secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//  automatically. Deploy: Edge Functions -> Deploy a new function, name it
//  `delete-account`, paste this file. See docs/SETUP.md (Stage 7).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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
    // Identify the caller from their bearer token — never from the request body.
    const authz = req.headers.get("Authorization") || "";
    const token = authz.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "no token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (uErr || !user) return json({ ok: false, error: "invalid session" }, 401);

    const uid = user.id;
    // Remove their data first, then the auth user itself.
    await admin.from("memberships").delete().eq("user_id", uid);
    await admin.from("profiles").delete().eq("id", uid);
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    if (dErr) throw new Error(dErr.message);

    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message.slice(0, 300) }, 200);
  }
});
