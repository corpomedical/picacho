import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin/require-admin";
import { ProductChecksView, type ProductChecksLoad } from "@/components/admin/product-checks-view";
import {
  DISTRIBUTION_COLUMNS,
  DISTRIBUTION_ROWS,
  QUEUE_PAGE,
  distributions,
  parseQueueFilter,
  queueCard,
  type AdminFrameRow,
  type QueueFilter,
} from "@/lib/product-lock/admin-view";
import { FRAME_CHECK_BUCKET, FRAME_CHECK_READ_COLUMNS, FRAME_CHECK_TABLE } from "@/lib/product-lock/records";

// PRESS TOUR · PRODUCT CHECKS (2026-09-26, Cut 2). The product checker's
// record, for calibrating it by hand: every frame it read
// (product_frame_checks), how its scores spread, and a queue to label the
// frames that kept their picture as correct / wrong / not readable
// (spec §1.8; synthesis §3.4 Cut 9's gate, computed live).
//
// RECORD-ONLY. Nothing on this page, and nothing the checker does in this
// round, re-shoots, refunds or blocks anything. (The campaign engine reads a
// still's verdict for its one house-paid repaint on "Didn't match" —
// synthesis v2 #15, campaign-machine.ts — and nothing else.) Meeting the gate
// turns nothing on: product_lock_calibrated, product_lock_reshoot and
// product_lock_refund stay the operator's switches (Admin → Feature flags).
//
// Customer frames keep their numbers only (records.ts): they are counted in
// the distributions and never shown or labelled until the privacy page
// discloses human review of sampled frames (synthesis v2 #32).
//
// This file only loads; components/admin/product-checks-view.tsx draws.
// product_frame_checks has no policies (service role only), so the reads
// use requireAdmin's service-role client, after its role and second-factor
// check.

export const dynamic = "force-dynamic";

type Search = { error?: string; show?: string };

/** The few builder calls the queue makes, named so the client's deep row types stay out of it. */
type QueueQuery = {
  is(column: string, value: null): QueueQuery;
  not(column: string, operator: "is", value: null): QueueQuery;
  in(column: string, values: string[]): QueueQuery;
  order(column: string, opts: { ascending: boolean }): QueueQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null }>;
};

/** One page of the labelling queue. Only frames that kept their picture are ever queued (v2 #32). */
async function queueRows(db: SupabaseClient, show: QueueFilter): Promise<AdminFrameRow[]> {
  const base = (db.from(FRAME_CHECK_TABLE).select(FRAME_CHECK_READ_COLUMNS) as unknown as QueueQuery).not("frame_path", "is", null);
  const filtered =
    show === "todo" ? base.is("label", null) : show === "labelled" ? base.not("label", "is", null) : base.in("frame_verdict", ["didnt_match", "absent"]);
  const { data } = await filtered.order("created_at", { ascending: false }).limit(QUEUE_PAGE);
  return (data ?? []) as unknown as AdminFrameRow[];
}

export default async function ProductChecksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const show = parseQueueFilter(params.show);
  const { admin } = await requireAdmin();

  const [dist, flags, settings] = await Promise.all([
    admin.from(FRAME_CHECK_TABLE).select(DISTRIBUTION_COLUMNS as string).order("created_at", { ascending: false }).limit(DISTRIBUTION_ROWS),
    admin.from("feature_flags").select("key, enabled").in("key", ["product_lock_calibrated", "product_lock_reshoot", "product_lock_refund"]),
    admin.from("app_settings").select("key, value").eq("key", "product_lock_min_confidence").maybeSingle(),
  ]);
  const flagOn = (key: string) => (flags.data ?? []).some((f: { key: string; enabled: boolean }) => f.key === key && f.enabled === true);

  let load: ProductChecksLoad;
  if (dist.error) {
    load = /does not exist|relation|schema cache/i.test(dist.error.message) ? { state: "missing_table" } : { state: "error", message: dist.error.message };
  } else {
    const rows = await queueRows(admin, show);
    const paths = rows.map((r) => r.frame_path).filter((p): p is string => typeof p === "string");
    const signed = paths.length ? await admin.storage.from(FRAME_CHECK_BUCKET).createSignedUrls(paths, 600) : { data: [] };
    const urlByPath = new Map<string, string>();
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    load = {
      state: "ok",
      d: distributions((dist.data ?? []) as unknown as AdminFrameRow[]),
      cards: rows.map((row) => ({ card: queueCard(row), url: row.frame_path ? (urlByPath.get(row.frame_path) ?? null) : null })),
    };
  }

  return (
    <ProductChecksView
      error={params.error}
      show={show}
      calibrated={flagOn("product_lock_calibrated")}
      reshootOn={flagOn("product_lock_reshoot")}
      refundOn={flagOn("product_lock_refund")}
      minConfidence={(settings.data as { value?: string } | null)?.value ?? "0"}
      load={load}
    />
  );
}
