// ============================================================================
//  Supabase Edge Function: verify-task
//  Given a freshly-taken proof photo (sent inline as a base64 data URL) and the
//  chore it's meant to prove, ask Claude (vision) two things:
//    1. does the photo actually show that job done?  ("done")
//    2. is this a genuine photo of the room — NOT a photo of a phone/laptop
//       screen or a printed picture?  ("spoof")  <- anti-cheating
//  Returns a small JSON verdict. The image is never stored server-side; the
//  app keeps a small thumbnail locally as the record.
//
//  Secrets (Supabase -> Edge Functions -> Secrets), never in the repo:
//    ANTHROPIC_API_KEY   – your Claude API key
//    ANTHROPIC_MODEL     – optional; defaults to claude-opus-5.
//                          claude-haiku-4-5 is cheaper for high volume.
//
//  Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function,
//  name it `verify-task`, paste this file. See docs/SETUP.md (Stage 6).
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk";

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

// Split a data URL into media type + raw base64. Rejects anything huge.
function parseDataUrl(s: string): { media: string; data: string } {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(s || "");
  if (!m) throw new Error("image must be a base64 image data URL");
  const media = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  const data = m[2];
  // ~9MB of base64 ≈ 6.7MB image; the client downscales to <1280px so this is generous.
  if (data.length > 9_000_000) throw new Error("image too large");
  return { media, data };
}

function extractJson(text: string): any {
  const fenced = text.replace(/```json/gi, "```").split("```");
  const candidate = fenced.length > 1 ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const task = String(body.task || "").slice(0, 300);
    const zone = String(body.zone || "").slice(0, 60);
    const lang = body.lang === "en" ? "English" : body.lang === "uk" ? "Ukrainian" : "Czech";
    const { media, data } = parseDataUrl(String(body.image || ""));

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const prompt =
      "You verify chore-completion photos for a shared student dormitory cell. " +
      "A roommate just took this photo in-app to prove they finished a cleaning task.\n\n" +
      "TASK THEY CLAIM TO HAVE DONE: \"" + (task || "(a cleaning task)") + "\"" +
      (zone ? " (area: " + zone + ")" : "") + "\n\n" +
      "Judge two things independently:\n" +
      "1. done — does the photo plausibly show THIS task completed and the area clean/tidy? " +
      "Be reasonable, not harsh: a clean sink, a made bed, an empty bin, a wiped surface count. " +
      "If the photo is unrelated, blurry, or clearly shows the task NOT done, done=false.\n" +
      "2. spoof — is this NOT a real, direct photo of the room? Set spoof=true if it looks like a " +
      "photo of a phone/laptop/TV screen (look for pixel moiré, screen glare, bezels, UI, reflections), " +
      "a printed photo, or a re-photographed image. A normal direct photo of a real room => spoof=false.\n\n" +
      "Reply with ONLY a JSON object of this exact shape:\n" +
      '{ "done": true, "spoof": false, "confidence": 0.0, "reason": "one short sentence" }\n' +
      "confidence is your overall 0..1 confidence in the verdict. " +
      "Write \"reason\" in " + lang + ", one short friendly sentence the roommate will read.";

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data } },
          { type: "text", text: prompt },
        ],
      }],
    });

    if (resp.stop_reason === "refusal") throw new Error("model refused to read the image");
    const textBlock = resp.content.find((b: any) => b.type === "text") as any;
    const parsed = extractJson(textBlock?.text || "");

    return json({
      ok: true,
      done: !!parsed.done,
      spoof: !!parsed.spoof,
      confidence: clamp01(parsed.confidence),
      reason: String(parsed.reason || "").slice(0, 300),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message.slice(0, 300) }, 200);
  }
});
