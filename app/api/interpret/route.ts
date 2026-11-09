import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ConfigSchema } from "@/lib/schema";
import { AIPatchSchema } from "@/lib/interpret/patch";
import { SYSTEM_PROMPT } from "@/lib/interpret/prompt";

export const runtime = "nodejs";

const MODEL = "claude-opus-5-5";

/** The patch format, as JSON Schema text for the prompt. */
const PATCH_SCHEMA = JSON.stringify(z.toJSONSchema(AIPatchSchema));

/** Pull the JSON object out of a reply, tolerating stray text or fences. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const RequestSchema = z.object({
  mode: z.enum(["atmosphere", "direct", "rule"]),
  text: z.string().min(1).max(2000),
  config: ConfigSchema,
});

function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function GET() {
  return Response.json({ available: hasCredentials(), model: MODEL });
}

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request", detail: parsed.error.message }, { status: 400 });
  }
  if (!hasCredentials()) {
    // not an error: the client falls back to the offline interpreter
    return Response.json({ error: "no_ai", detail: "No ANTHROPIC_API_KEY configured." });
  }

  const { mode, text, config } = parsed.data;
  const client = new Anthropic();

  // the engine never waits on this — a slow or failed call only means
  // the music keeps playing as it was.
  //
  // Claude answers with plain JSON (the API's strict output forms can't
  // take a patch with this many optional fields); DRIFT validates the
  // answer itself with Zod and asks once more if it doesn't fit.
  const system = `${SYSTEM_PROMPT}

## Output format
Reply with exactly one JSON object and nothing else — no prose, no code fences.
It must match this JSON Schema. Every key is required; use null for anything you are not changing, and [] for empty lists:
${PATCH_SCHEMA}`;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `mode: ${mode}\n\nCurrent configuration (layer and rule ids are what you reference in edits):\n${JSON.stringify(config)}\n\nUser says: ${text}`,
    },
  ];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.messages.create({ model: MODEL, max_tokens: 16000, output_config: { effort: "low" }, system, messages }, { timeout: 60_000 });
      if (response.stop_reason === "refusal") {
        return Response.json({ error: "refused", detail: "The AI declined this request." }, { status: 422 });
      }
      if (response.stop_reason === "max_tokens") {
        return Response.json({ error: "bad_output", detail: "The AI response was incomplete." }, { status: 502 });
      }
      const textOut = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const json = extractJson(textOut);
      const check = json === undefined ? null : AIPatchSchema.safeParse(json);
      if (check?.success) return Response.json({ patch: check.data, model: MODEL });
      // one correction round: show Claude what didn't fit
      const problem = check ? z.prettifyError(check.error).slice(0, 1500) : "The reply was not a single JSON object.";
      messages.push({ role: "assistant", content: response.content }, { role: "user", content: `That reply didn't match the schema:\n${problem}\nReply again with only the corrected JSON object.` });
    }
    return Response.json({ error: "bad_output", detail: "The AI's answer didn't match DRIFT's format." }, { status: 502 });
  } catch (err) {
    let detail = "Unknown error";
    let status = 502;
    if (err instanceof Anthropic.AuthenticationError) {
      detail = "The API key was rejected.";
      status = 503;
    } else if (err instanceof Anthropic.RateLimitError) {
      detail = "Rate limited — try again shortly.";
    } else if (err instanceof Anthropic.APIConnectionError) {
      detail = "Could not reach the AI service.";
      status = 503;
    } else if (err instanceof Anthropic.APIError) {
      detail = `AI service error ${err.status}: ${err.message}`;
    } else if (err instanceof Error) {
      detail = err.message;
    }
    // shows in the terminal running DRIFT (never includes the key)
    console.warn(`[drift] AI request failed (${mode}): ${detail.slice(0, 300)}`);
    return Response.json({ error: "ai_failed", detail }, { status });
  }
}
