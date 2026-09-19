// "Where this month's credits went" (Settings → Plan & billing, 2026-09-19).
// Pure classification here; the query is in credit-spend-server.ts.
//
// The sum of a month's credits_used is the same figure the allowance meter
// counts (getMonthlyUsage sums every row in the window, deleted ones
// included, because the credits were spent). This only splits it.

export type SpendKind = "videos" | "images" | "helios" | "upscales" | "layers" | "mystique";

export type SpendRow = {
  id: string;
  content_type: string | null;
  model_id: string | null;
  credits_used: number | null;
};

export type SpendPart = { kind: SpendKind; credits: number };

// Order of the checks matters: a Helios take is a video, an upscale is a
// video, a Mystique take is a video — each is named by what the person did,
// and only a plain render falls through to its content type.
export function spendKind(row: SpendRow, heliosIds: ReadonlySet<string>): SpendKind {
  if (heliosIds.has(row.id)) return "helios";
  const model = row.model_id ?? "";
  if (model === "flux-upscale") return "upscales";
  if (model === "seedream-layerize" || model === "layer-edit") return "layers";
  // Mystique's rows are its recast-* engines (lib/recast/recast.ts).
  if (model.startsWith("recast")) return "mystique";
  return row.content_type === "video" ? "videos" : "images";
}

/** Largest first; kinds with nothing spent are left out. */
export function classifySpend(rows: SpendRow[], heliosIds: ReadonlySet<string>): SpendPart[] {
  const totals = new Map<SpendKind, number>();
  for (const row of rows) {
    const credits = row.credits_used ?? 0;
    if (credits <= 0) continue;
    const kind = spendKind(row, heliosIds);
    totals.set(kind, (totals.get(kind) ?? 0) + credits);
  }
  return [...totals.entries()]
    .map(([kind, credits]) => ({ kind, credits }))
    .sort((a, b) => b.credits - a.credits);
}
