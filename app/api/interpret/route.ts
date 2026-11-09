import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ConfigSchema } from "@/lib/schema";
import { AIPatchSchema } from "@/lib/interpret/patch";
import { SYSTEM_PROMPT } from "@/lib/interpret/prompt";

export const runtime = "nodejs";

const MODEL = "claude-opus-5-5";

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
  // the music keeps playing as it was
  try {
    const response = await client.messages.parse(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "low", format: zodOutputFormat(AIPatchSchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `mode: ${mode}\n\nCurrent configuration (layer and rule ids are what you reference in edits):\n${JSON.stringify(config)}\n\nUser says: ${text}`,
          },
        ],
      },
      { timeout: 60_000 },
    );

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "refused", detail: "The AI declined this request." }, { status: 422 });
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return Response.json({ error: "bad_output", detail: "The AI response was incomplete." }, { status: 502 });
    }
    return Response.json({ patch: response.parsed_output, model: MODEL });
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
    return Response.json({ error: "ai_failed", detail }, { status });
  }
}
