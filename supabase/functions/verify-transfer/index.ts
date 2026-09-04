// ============================================================================
//  Supabase Edge Function: verify-transfer
//  Reads a bank-transfer confirmation photo from Storage and asks Claude
//  (vision) whether it looks like a GENUINE payment confirmation for the
//  expected amount. Writes the verdict back to the `transfers` row so the app
//  can show "verified" / "mismatch" next to the repayment.
//
//  This is a coordination aid for a dorm cell, not fraud-proof forensics — it
//  catches obvious mismatches (wrong amount, a random photo, a blank screen),
//  not a determined forger. The human still sees the photo either way.
//
//  Secrets (Supabase -> Edge Functions -> Secrets), never in the repo:
//    ANTHROPIC_API_KEY   – your Claude API key
//    ANTHROPIC_MODEL     – optional; defaults to claude-opus-5.
//                          claude-haiku-4-5 is cheaper for high volume.
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//  Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function,
//  name it `verify-transfer`, paste this file. See docs/SETUP.md.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk";
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

function mediaType(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function extractJson(text: string): any {
  const fenced = text.replace(/```json/gi, "```").split("```");
  const candidate = fenced.length > 1 ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let transferId: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    transferId = body.transfer_id;
    if (!transferId) return json({ error: "transfer_id required" }, 400);

    // 1) Load the transfer row.
    const { data: tr, error: tErr } = await db
      .from("transfers").select("*").eq("id", transferId).single();
    if (tErr || !tr) return json({ error: "transfer not found" }, 404);
    if (!tr.storage_path) return json({ error: "transfer has no photo" }, 400);

    // 2) Download the photo from the private Storage bucket.
    const { data: file, error: dErr } = await db.storage
      .from("receipts").download(tr.storage_path);
    if (dErr || !file) throw new Error("download failed: " + (dErr?.message || "no file"));
    const b64 = toBase64(new Uint8Array(await file.arrayBuffer()));

    // 3) Ask Claude to judge the confirmation.
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const expected = `${tr.amount ?? "?"} ${tr.currency ?? ""}`.trim();
    const prompt =
      "You are checking a photo/screenshot that is supposed to be a bank " +
      "PAYMENT CONFIRMATION between roommates. The expected amount is " +
      `${expected}. Decide whether the image plausibly shows a genuine ` +
      "money-transfer confirmation for about that amount (small rounding is " +
      "fine). Reply with ONLY a JSON object of this exact shape:\n" +
      '{ "verdict": "verified" | "rejected" | "unclear", ' +
      '"seen_amount": number|null, "reason": "short string" }\n' +
      "Rules: 'verified' = it looks like a real transfer/payment confirmation " +
      "and the amount matches; 'rejected' = clearly not a transfer, or the " +
      "amount is clearly different; 'unclear' = you cannot tell. Keep 'reason' " +
      "under 120 characters, in the language of the image if possible.";

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType(tr.storage_path), data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    });

    if (resp.stop_reason === "refusal") throw new Error("model refused to read the image");
    const textBlock = resp.content.find((b: any) => b.type === "text") as any;
    const parsed = extractJson(textBlock?.text || "");
    const verdict = ["verified", "rejected", "unclear"].includes(parsed.verdict)
      ? parsed.verdict : "unclear";
    const reason = String(parsed.reason ?? "").slice(0, 200);

    await db.from("transfers")
      .update({ status: verdict, ai_reason: reason }).eq("id", transferId);
    return json({ ok: true, verdict, reason, seen_amount: parsed.seen_amount ?? null });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (transferId) {
      await db.from("transfers").update({ status: "failed", ai_reason: message.slice(0, 500) }).eq("id", transferId);
    }
    return json({ ok: false, error: message }, 200);
  }
});
