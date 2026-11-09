import { type Composition, CompositionSchema, type DriftConfig, ENGINE_VERSION, sanitizeConfig } from "./schema";

const KEY = "drift.compositions.v1";
const LAST = "drift.last.v1";

function read(): Composition[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((x) => {
      try {
        // older saves are upgraded to the current format
        const r = CompositionSchema.safeParse({ kind: "composition", ...x, config: sanitizeConfig(x.config) });
        return r.success ? [r.data] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function write(list: Composition[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — nothing to do */
  }
}

export function listCompositions(): Composition[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/** Saves the generative system itself, not a recording. */
export function saveComposition(config: DriftConfig, id?: string, kind: Composition["kind"] = "composition"): Composition {
  const list = read();
  // stamp the engine version so a fixed seed can be trusted later
  const stamped = { ...structuredClone(config), engine: { type: "layers" as const, version: ENGINE_VERSION } };
  const comp: Composition = { id: id ?? `c-${Date.now().toString(36)}`, savedAt: Date.now(), kind, config: stamped };
  const idx = list.findIndex((c) => c.id === comp.id);
  if (idx >= 0) list[idx] = comp;
  else list.push(comp);
  write(list);
  return comp;
}

export function deleteComposition(id: string) {
  write(read().filter((c) => c.id !== id));
}

/* ---------------- files ---------------- */

/** The system as a portable JSON file. */
export function exportSystem(config: DriftConfig): Blob {
  const doc = { format: "drift-system", formatVersion: 1, exportedAt: new Date().toISOString(), config: { ...config, engine: { type: "layers", version: ENGINE_VERSION } } };
  return new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
}

/** Read a system file (or a bare configuration) and validate it. */
export async function importSystem(file: File): Promise<DriftConfig> {
  if (file.size > 2_000_000) throw new Error("That file is too large to be a DRIFT system.");
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const raw = data && typeof data === "object" && "config" in data ? (data as { config: unknown }).config : data;
  try {
    return sanitizeConfig(raw);
  } catch {
    throw new Error("That file doesn't describe a DRIFT system.");
  }
}

export function saveLast(config: DriftConfig) {
  try {
    localStorage.setItem(LAST, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}
