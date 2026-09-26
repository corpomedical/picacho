// Admin → Product checks, the page's body (presentational: every number
// arrives computed from admin-view.ts, so a harness can draw it on
// fixtures and the page file only loads). See app/admin/product-checks.

import Link from "next/link";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { labelFrameCheck } from "@/lib/product-lock/admin-actions";
import { CONFIDENCE_BUCKETS, OCR_BUCKETS, pct, type Distributions, type QueueCard, type QueueFilter } from "@/lib/product-lock/admin-view";
import { GATE } from "@/lib/product-lock/calibration";
import type { FrameLabel } from "@/lib/product-lock/records";
import { CONFLICT_SIMILARITY, LABEL_MATCH_SIMILARITY } from "@/lib/product-lock/text-match";

export type ProductChecksLoad =
  | { state: "missing_table" }
  | { state: "error"; message: string }
  | { state: "ok"; d: Distributions; cards: { card: QueueCard; url: string | null }[] };

export type ProductChecksViewProps = {
  error?: string;
  show: QueueFilter;
  calibrated: boolean;
  reshootOn: boolean;
  refundOn: boolean;
  minConfidence: string;
  load: ProductChecksLoad;
};

const VERDICT_WORD: Record<string, string> = {
  match: "Match",
  didnt_match: "Didn't match",
  not_readable: "Not readable",
  absent: "Absent",
  excluded: "Excluded",
  not_checked: "Not checked",
  product_missing: "Product missing",
  no_one_in_shot: "No one in this shot",
};

function verdictTone(v: string): "success" | "danger" | "warning" | "neutral" {
  if (v === "match") return "success";
  if (v === "didnt_match" || v === "product_missing") return "danger";
  if (v === "not_readable") return "warning";
  return "neutral";
}

const LABELS: { value: FrameLabel; text: string }[] = [
  { value: "correct", text: "Correct" },
  { value: "wrong", text: "Wrong" },
  { value: "not_readable", text: "Not readable" },
];

const FILTER_TEXT: Record<QueueFilter, string> = { todo: "To label", labelled: "Labelled", misses: "Misses" };

/** A 10-bin histogram: one neutral series, bars on a shared baseline, each bar's count on hover. */
function Histogram({ bins, from, to, format, markers = [] }: { bins: number[]; from: number; to: number; format: (v: number) => string; markers?: { at: number; text: string }[] }) {
  const max = Math.max(1, ...bins);
  const width = (to - from) / bins.length;
  return (
    <div>
      <div className="relative flex h-24 items-end gap-[2px] border-b border-atelier-rule">
        {bins.map((n, i) => (
          <div
            key={i}
            className="group relative flex h-full flex-1 items-end"
            title={`${format(from + i * width)}–${format(from + (i + 1) * width)}: ${n.toLocaleString()} frame${n === 1 ? "" : "s"}`}
          >
            <div className="w-full rounded-t-[4px] bg-atelier-ink/70 transition-colors group-hover:bg-atelier-ink" style={{ height: n === 0 ? 0 : `${Math.max(3, (n / max) * 100)}%` }} />
          </div>
        ))}
        {markers.map((m) => (
          <div key={m.text} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-atelier-muted" style={{ left: `${((m.at - from) / (to - from)) * 100}%` }}>
            {/* A marker past the middle labels to its left, so the text stays inside the chart. */}
            <span className={cn("absolute -top-0.5 whitespace-nowrap text-[10px] text-atelier-muted", (m.at - from) / (to - from) > 0.6 ? "right-1" : "left-1")}>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-atelier-muted">
        <span>{format(from)}</span>
        <span>{format(to)}</span>
      </div>
    </div>
  );
}

/** A ranked list: quiet fill behind, label left, count right (the Stats page's pattern). */
function Ranked({ items, empty }: { items: { value: string; count: number }[]; empty: string }) {
  if (items.length === 0) return <p className="mt-2 text-sm text-atelier-muted">{empty}</p>;
  const max = items[0].count || 1;
  return (
    <ul className="mt-2 space-y-[2px]">
      {items.slice(0, 8).map((it) => (
        <li key={it.value} className="relative overflow-hidden rounded-[6px]" title={`${it.value}: ${it.count.toLocaleString()}`}>
          <span className="absolute inset-y-0.5 left-0 rounded-[5px] bg-atelier-ink/[0.07]" style={{ width: `${Math.max(4, Math.round((it.count / max) * 100))}%` }} />
          <span className="relative flex items-center justify-between gap-3 px-2 py-1 text-sm">
            <span className="min-w-0 truncate text-atelier-ink">{VERDICT_WORD[it.value] ?? it.value}</span>
            <span className="flex-shrink-0 tabular-nums text-atelier-muted">{it.count.toLocaleString()}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const done = value >= target;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-atelier-ink">{label}</span>
        <span className={cn("tabular-nums", done ? "text-emerald-700 dark:text-emerald-400" : "text-atelier-muted")}>
          {value.toLocaleString()} / {target.toLocaleString()}
          {done ? " ✓" : ""}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-atelier-ink/[0.07]">
        <div className="h-full rounded-full bg-atelier-ink/70" style={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
      </div>
    </div>
  );
}

function RateLine({ name, rate, bars }: { name: string; rate: { k: number; n: number; rate: number | null; upper: number }; bars: { text: string; bar: number }[] }) {
  return (
    <div className="rounded-control border border-atelier-rule p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{name}</p>
      <p className="mt-1 font-numeral text-2xl tabular-nums text-atelier-ink">{pct(rate.rate)}</p>
      <p className="text-xs tabular-nums text-atelier-muted">
        {rate.k} of {rate.n} · upper bound {rate.n > 0 ? pct(rate.upper) : "—"}
      </p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {bars.map((b) => {
          const met = rate.rate !== null && rate.rate <= b.bar && rate.upper <= 2 * b.bar;
          return (
            <li key={b.text} className="flex justify-between gap-2">
              <span className="text-atelier-muted">{b.text}</span>
              <span className={met ? "text-emerald-700 dark:text-emerald-400" : "text-atelier-muted"}>
                ≤ {(b.bar * 100).toFixed(0)}% · {met ? "met" : "not yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProductChecksView({ error, show, calibrated, reshootOn, refundOn, minConfidence, load }: ProductChecksViewProps) {
  const d = load.state === "ok" ? load.d : null;
  const cards = load.state === "ok" ? load.cards : [];
  return (
    <div>
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Press Tour</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Product checks</h1>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-atelier-muted">
        Every frame the product checker read, how its scores spread, and the hand labels that calibrate it. Record-only: nothing here, and
        nothing the checker drives yet, re-shoots, refunds or blocks anything (the one exception: a still the check finds wrong is repainted once, on
        the house). Meeting the gate turns nothing on — the switches stay in{" "}
        <Link href="/admin/flags" className="underline underline-offset-2 hover:text-atelier-ink">
          Feature flags
        </Link>
        .
      </p>

      <AdminErrorBanner error={error} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Badge tone={calibrated ? "success" : "neutral"}>{calibrated ? "Calibrated" : "Record-only"}</Badge>
        <Badge tone="neutral">
          Min confidence {minConfidence}
          {calibrated ? "" : " (ignored until calibrated)"}
        </Badge>
        <Badge tone={reshootOn ? "warning" : "neutral"}>Re-shoot {reshootOn ? "on" : "off"}</Badge>
        <Badge tone={refundOn ? "warning" : "neutral"}>Refunds {refundOn ? "on" : "off"}</Badge>
        {d ? (
          <>
            <Badge tone="neutral">{d.total.toLocaleString()} frames read</Badge>
            <Badge tone="neutral">${d.costUsd.toFixed(2)} spent reading them</Badge>
          </>
        ) : null}
      </div>

      {load.state === "missing_table" ? (
        <Card className="mt-6">
          <p className="text-sm text-atelier-ink">The frame record isn&apos;t in the database yet.</p>
          <p className="mt-1 text-sm text-atelier-muted">
            Paste <code className="text-xs">supabase/applied/2026-09-26/press-tour-03-campaigns.sql</code> (it creates product_frame_checks); frames read before that are not kept.
          </p>
        </Card>
      ) : load.state === "error" ? (
        <Card className="mt-6">
          <p className="text-sm text-red-600">Couldn&apos;t load the record: {load.message}</p>
        </Card>
      ) : d ? (
        <>
          <Card className="mt-6" pad="md">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-atelier-ink">The calibration gate</h2>
              <p className="text-xs text-atelier-muted">
                {d.report.labelled.toLocaleString()} labelled · {d.toLabel.toLocaleString()} waiting for a label · {d.report.humanUnreadable} a person couldn&apos;t read · {d.report.missedReads} the checker
                couldn&apos;t read but a person could
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Progress label="True matches" value={d.report.trueMatches} target={GATE.trueMatches} />
              <Progress label="True mismatches" value={d.report.trueMismatches} target={GATE.trueMismatches} />
              <Progress label="…from real renders" value={d.report.realMismatches} target={GATE.realMismatches} />
              <Progress label="Products" value={d.report.products} target={GATE.products} />
              <Progress label="Lanes" value={d.report.lanes} target={GATE.lanes} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <RateLine
                name="False mismatch (a right product called wrong)"
                rate={d.report.falseMismatch}
                bars={[
                  { text: "Automatic re-shoot", bar: GATE.reshootFalseMismatch },
                  { text: "Refunds", bar: GATE.refundFalseMismatch },
                ]}
              />
              <RateLine name="False match (a wrong product called right)" rate={d.report.falseMatch} bars={[{ text: "Refunds", bar: GATE.refundFalseMatch }]} />
            </div>
            <p className="mt-4 text-xs text-atelier-muted">
              Each rate must meet its bar as a point estimate and with its Wilson 95% upper bound no more than twice the bar. Re-shoot bar:{" "}
              <span className="text-atelier-ink">{d.report.reshootReady ? "met" : "not met"}</span>. Refund bars:{" "}
              <span className="text-atelier-ink">{d.report.refundReady ? "met (still needs your yes)" : "not met"}</span>. The word &ldquo;locked&rdquo; needs a separate yes.
            </p>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card pad="md">
              <h2 className="text-sm font-semibold text-atelier-ink">Frame verdicts</h2>
              <Ranked items={d.byVerdict.filter((v) => v.count > 0).map((v) => ({ value: v.verdict, count: v.count }))} empty="No frames read yet." />
              <p className="mt-3 text-xs text-atelier-muted">
                {d.escalated.toLocaleString()} sent for a second reading · {d.customerFrames.toLocaleString()} customer frame{d.customerFrames === 1 ? "" : "s"} kept as numbers only
              </p>
            </Card>
            <Card pad="md" className="lg:col-span-2">
              <h2 className="text-sm font-semibold text-atelier-ink">Judge confidence, by frame verdict</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {d.confidence.map((c) => (
                  <div key={c.verdict}>
                    <p className="mb-2 flex items-center gap-2 text-xs text-atelier-muted">
                      <Badge tone={verdictTone(c.verdict)} className="px-2 py-0.5 text-[10.5px]">
                        {VERDICT_WORD[c.verdict]}
                      </Badge>
                      {c.bins.reduce((a, b) => a + b, 0).toLocaleString()}
                    </p>
                    <Histogram bins={c.bins} from={0} to={100} format={(v) => v.toFixed(0)} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-atelier-muted">{CONFIDENCE_BUCKETS} bins of 10 points. Hover a bar for its count.</p>
            </Card>
            <Card pad="md">
              <h2 className="text-sm font-semibold text-atelier-ink">Confirmed words: best similarity</h2>
              <div className="mt-5">
                <Histogram
                  bins={d.ocr}
                  from={0}
                  to={1}
                  format={(v) => v.toFixed(1)}
                  markers={[
                    { at: CONFLICT_SIMILARITY, text: "foreign" },
                    { at: LABEL_MATCH_SIMILARITY, text: "read" },
                  ]}
                />
              </div>
              <p className="mt-2 text-xs text-atelier-muted">{OCR_BUCKETS} bins. At or above 0.85 a confirmed word counts as read.</p>
            </Card>
            <Card pad="md">
              <h2 className="text-sm font-semibold text-atelier-ink">By source and lane</h2>
              <Ranked items={d.bySource} empty="—" />
              <Ranked items={d.byLane} empty="—" />
            </Card>
            <Card pad="md">
              <h2 className="text-sm font-semibold text-atelier-ink">By scorer version</h2>
              <Ranked items={d.byScorer} empty="—" />
              <p className="mt-2 text-xs text-atelier-muted">Frames from two versions are not one calibration set.</p>
            </Card>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-atelier-ink">Label frames</h2>
              <p className="text-sm text-atelier-muted">
                Was the checker&apos;s verdict on this frame right? Only frames that kept their picture (yours, the bake-off&apos;s) can be labelled.
              </p>
            </div>
            <nav className="flex rounded-full border border-atelier-rule p-0.5 text-xs">
              {(Object.keys(FILTER_TEXT) as QueueFilter[]).map((f) => (
                <Link
                  key={f}
                  href={`/admin/product-checks?show=${f}`}
                  className={cn("rounded-full px-3 py-1.5", f === show ? "bg-atelier-ink text-atelier-paper" : "text-atelier-muted hover:text-atelier-ink")}
                >
                  {FILTER_TEXT[f]}
                </Link>
              ))}
            </nav>
          </div>

          {cards.length === 0 ? (
            <Card className="mt-4 text-center">
              <p className="text-sm text-atelier-muted">
                {show === "todo" ? "Nothing waiting for a label." : show === "labelled" ? "No labels yet." : "No misses among the frames that kept their picture."}
              </p>
            </Card>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(({ card: c, url }) => {
                return (
                  <Card key={c.id} pad="none" className="overflow-hidden">
                    <div className="flex justify-center bg-atelier-ink/[0.04] p-3">
                      <div className="relative inline-block">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={`Frame, verdict ${VERDICT_WORD[c.frameVerdict] ?? c.frameVerdict}`} className="block max-h-72 w-auto rounded-[6px]" />
                        ) : (
                          <div className="flex h-48 w-28 items-center justify-center text-xs text-atelier-muted">No picture</div>
                        )}
                        {url && c.box ? (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute rounded-[3px] border-2 border-atelier-accent"
                            style={{ left: `${c.box.x * 100}%`, top: `${c.box.y * 100}%`, width: `${c.box.w * 100}%`, height: `${c.box.h * 100}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={verdictTone(c.frameVerdict)}>{VERDICT_WORD[c.frameVerdict] ?? c.frameVerdict}</Badge>
                        <span className="text-xs text-atelier-muted">shot: {VERDICT_WORD[c.shotVerdict] ?? c.shotVerdict}</span>
                        {c.label ? <Badge tone="neutral">labelled {LABELS.find((l) => l.value === c.label)?.text.toLowerCase()}</Badge> : null}
                      </div>
                      {c.reason ? <p className="text-sm text-atelier-ink">{c.reason}</p> : null}
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-atelier-muted">Where</dt>
                        <dd className="text-atelier-ink">
                          {c.where} · {c.source}
                          {c.lane ? ` · ${c.lane}` : ""}
                        </dd>
                        {c.judge ? (
                          <>
                            <dt className="text-atelier-muted">Judge</dt>
                            <dd className="tabular-nums text-atelier-ink">{c.judge}</dd>
                          </>
                        ) : null}
                        {c.second ? (
                          <>
                            <dt className="text-atelier-muted">Second reading</dt>
                            <dd className="text-atelier-ink">{c.second}</dd>
                          </>
                        ) : null}
                        {c.words ? (
                          <>
                            <dt className="text-atelier-muted">Words</dt>
                            <dd className="break-words text-atelier-ink">{c.words}</dd>
                          </>
                        ) : null}
                        {c.read.length ? (
                          <>
                            <dt className="text-atelier-muted">Read</dt>
                            <dd className="break-words text-atelier-muted">{c.read.join(" / ")}</dd>
                          </>
                        ) : null}
                        <dt className="text-atelier-muted">When</dt>
                        <dd className="text-atelier-muted">{new Date(c.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd>
                      </dl>
                      <form action={labelFrameCheck} className="flex flex-wrap gap-1.5 pt-1">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="show" value={show} />
                        {LABELS.map((l) => (
                          <SubmitButton
                            key={l.value}
                            name="label"
                            value={l.value}
                            // The chosen label is the one filled button; the others are outlined.
                            variant={c.label === l.value ? "primary" : "secondary"}
                            size="sm"
                            aria-pressed={c.label === l.value}
                            className="min-h-[36px]"
                            pendingLabel="Saving…"
                          >
                            {l.text}
                          </SubmitButton>
                        ))}
                        {c.label ? (
                          <SubmitButton name="label" value="clear" variant="ghost" size="sm" className="min-h-[36px]" pendingLabel="Saving…">
                            Clear
                          </SubmitButton>
                        ) : null}
                      </form>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          {d.customerFrames > 0 ? (
            <p className="mt-4 text-xs text-atelier-muted">
              {d.customerFrames.toLocaleString()} customer frame{d.customerFrames === 1 ? " is" : "s are"} counted above and not shown: labelling them waits for the privacy page
              to disclose human review.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
