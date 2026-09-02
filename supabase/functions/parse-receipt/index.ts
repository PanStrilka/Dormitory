// ============================================================================
//  Supabase Edge Function: parse-receipt
//  Reads a receipt photo from Storage, asks Claude (vision) to extract the line
//  items, and writes them to `receipt_items`. On any failure the raw photo and
//  the `receipts` row are kept (status = 'failed') so it can be retried or
//  checked by hand before `expires_at` cleans it up.
//
//  Secrets (set in Supabase -> Edge Functions -> Secrets), never in the repo:
//    ANTHROPIC_API_KEY   – your Claude API key
//    ANTHROPIC_MODEL     – optional; defaults to claude-opus-5.
//                          For cheap, high-volume receipts set this to
//                          claude-haiku-4-5 to cut cost dramatically.
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//  Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function,
//  name it `parse-receipt`, paste this file. See docs/SETUP.md (Stage 2).
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

// Best-effort media type from a storage path.
function mediaType(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

// Pull the first balanced JSON object out of the model's text.
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
  let receiptId: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    receiptId = body.receipt_id;
    if (!receiptId) return json({ error: "receipt_id required" }, 400);

    // 1) Load the receipt row.
    const { data: receipt, error: rErr } = await db
      .from("receipts").select("*").eq("id", receiptId).single();
    if (rErr || !receipt) return json({ error: "receipt not found" }, 404);
    if (!receipt.storage_path) return json({ error: "receipt has no photo" }, 400);

    // 2) Download the photo from the private Storage bucket.
    const { data: file, error: dErr } = await db.storage
      .from("receipts").download(receipt.storage_path);
    if (dErr || !file) throw new Error("download failed: " + (dErr?.message || "no file"));
    const b64 = toBase64(new Uint8Array(await file.arrayBuffer()));

    // 3) Ask Claude to read the receipt.
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const prompt =
      "You are reading a shopping receipt for a shared flat. Extract every " +
      "purchased line item. Reply with ONLY a JSON object of this exact shape:\n" +
      '{ "currency": "CZK", "total": 0, "items": [ ' +
      '{ "name": "string", "qty": 1, "unit_price": 0, "total": 0 } ] }\n' +
      "Rules: numbers are plain decimals (no currency symbols); qty defaults to 1 " +
      "if not printed; unit_price*qty should equal total; skip non-item lines " +
      "(store name, VAT summary, card info). If the image is not a readable " +
      'receipt, reply { "items": [], "error": "unreadable" }.';

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType(receipt.storage_path), data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    });

    if (resp.stop_reason === "refusal") throw new Error("model refused to read the image");
    const textBlock = resp.content.find((b: any) => b.type === "text") as any;
    const parsed = extractJson(textBlock?.text || "");
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (parsed.error === "unreadable" || items.length === 0) {
      throw new Error("no items extracted (" + (parsed.error || "empty") + ")");
    }

    // 4) Save the line items and mark the receipt parsed.
    const rows = items.map((it: any) => ({
      receipt_id: receiptId,
      name: String(it.name ?? "").slice(0, 200),
      qty: Number(it.qty) || 1,
      unit_price: Number(it.unit_price) || 0,
      total: Number(it.total) || (Number(it.unit_price) || 0) * (Number(it.qty) || 1),
    }));
    const { error: iErr } = await db.from("receipt_items").insert(rows);
    if (iErr) throw new Error("insert items failed: " + iErr.message);

    await db.from("receipts").update({ status: "parsed", ai_error: null }).eq("id", receiptId);
    return json({ ok: true, count: rows.length, currency: parsed.currency ?? null, total: parsed.total ?? null });

  } catch (e) {
    // Keep the photo + row for retry; just record why it failed.
    const message = e instanceof Error ? e.message : String(e);
    if (receiptId) {
      await db.from("receipts").update({ status: "failed", ai_error: message.slice(0, 500) }).eq("id", receiptId);
    }
    return json({ ok: false, error: message }, 200);
  }
});
