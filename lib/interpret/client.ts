import type { DriftConfig } from "../schema";
import { type AIPatch, AIPatchSchema } from "./patch";
import { type InterpretMode, interpretOffline } from "./offline";

export interface InterpretResult {
  patch: AIPatch;
  source: "ai" | "offline";
  /** Why we fell back, if we did. */
  notice?: string;
}

export async function aiAvailable(): Promise<boolean> {
  try {
    const r = await fetch("/api/interpret", { cache: "no-store" });
    const j = await r.json();
    return Boolean(j.available);
  } catch {
    return false;
  }
}

export async function interpret(mode: InterpretMode, text: string, config: DriftConfig): Promise<InterpretResult> {
  try {
    const r = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, text, config }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.patch) {
      const patch = AIPatchSchema.parse(j.patch);
      return { patch, source: "ai" };
    }
    const why = j.error === "no_ai" ? "No AI key configured" : j.detail || `AI unavailable (${r.status})`;
    return { patch: interpretOffline(mode, text, config), source: "offline", notice: why };
  } catch (e) {
    return { patch: interpretOffline(mode, text, config), source: "offline", notice: e instanceof Error ? e.message : "AI unavailable" };
  }
}
