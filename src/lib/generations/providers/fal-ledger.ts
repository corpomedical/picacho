// fal's own request ledger — the authoritative answer to "did a failed render
// cost us money?" (2026-08-30).
//
// WHY THIS EXISTS. Until now the only evidence that a failed render was free
// was OUR pipeline log: a failure with no "Generated via …" step was assumed
// to have consumed no provider work, and refund-rules.ts force-refunds on
// that basis. That is an inference from our side of the wire, and it was
// wrong to state it as fact — fal's own FAQ is explicit that a 422 "may still
// be charged if a runner spent GPU time processing the request before the
// error was detected." Whether a rejection is free depends on WHERE in the
// provider's pipeline it happens, which is an implementation detail that can
// change without notice and without telling us.
//
// So this reads the ledger instead of guessing at it. Verified against the
// live endpoint on 2026-08-30: 235 requests over the project's whole life,
// 31 of them non-2xx (24 Seedance 2.5 reference-to-video rejections among
// them), and NOT ONE carried a billable unit.
//
// ENDPOINT CONTRACT, established by probing it rather than from docs (fal's
// published API reference does not document this route):
//   GET https://rest.alpha.fal.ai/requests/
//   auth   : Authorization: Key <FAL_KEY>   (the ordinary key; no admin key needed)
//   params : start_time, end_time — both REQUIRED ISO strings, 422 without them
//            size — max 100; 200 returns 422
//            page — 1-based
//   returns: { items, total, page, size, pages }
//            …but `total` and `pages` come back NULL, so pagination has to walk
//            until a short page rather than trusting the count. Getting this
//            wrong is how a first pass saw only 50 of 235 requests.
//   fields : status_code, billable_units, endpoint, error_type, cost,
//            cost_estimate_nano_usd, billing_status, started_at
//
// billable_units is the field that matters. fal bills units x unit price, so
// zero units is zero money. `cost` reads 0 even on successful requests, so it
// is simply not populated on this route — do not read money out of it.

const LEDGER = "https://rest.alpha.fal.ai/requests/";
const MAX_PAGE_SIZE = 100;

export type LedgerRequest = {
  request_id: string;
  endpoint?: string | null;
  status_code?: number | null;
  billable_units?: number | null;
  error_type?: string | null;
  started_at?: string | null;
  billing_status?: string | null;
};

export type LedgerReconciliation = {
  ok: boolean;
  /** Why the ledger could not be read, when ok is false. */
  error?: string;
  windowDays: number;
  total: number;
  succeeded: number;
  failed: number;
  /** THE NUMBER THIS PAGE EXISTS FOR: failures fal charged us for. */
  billedFailures: LedgerRequest[];
  billableUnitsOnFailures: number;
  billableUnitsOnSuccess: number;
  oldest: string | null;
  newest: string | null;
  /** Failure counts by endpoint, most first. */
  failuresByEndpoint: { endpoint: string; count: number }[];
};

/**
 * Reconcile our failures against fal's billing.
 *
 * Best-effort by contract: an admin page must not break because a provider's
 * undocumented endpoint moved. Every failure path returns ok:false with a
 * readable reason rather than throwing.
 */
export async function reconcileFalLedger(windowDays = 30): Promise<LedgerReconciliation> {
  const empty: LedgerReconciliation = {
    ok: false,
    windowDays,
    total: 0,
    succeeded: 0,
    failed: 0,
    billedFailures: [],
    billableUnitsOnFailures: 0,
    billableUnitsOnSuccess: 0,
    oldest: null,
    newest: null,
    failuresByEndpoint: [],
  };

  const key = process.env.FAL_KEY;
  if (!key) return { ...empty, error: "FAL_KEY is not set." };

  const params = {
    start_time: new Date(Date.now() - windowDays * 86_400_000).toISOString(),
    end_time: new Date().toISOString(),
    size: String(MAX_PAGE_SIZE),
  };

  const items: LedgerRequest[] = [];
  try {
    // `pages` is null on this route, so walk until a short page. Hard stop at
    // 25 pages (2,500 requests) so a busy account can never turn an admin
    // page load into an unbounded crawl.
    for (let page = 1; page <= 25; page++) {
      const url = `${LEDGER}?${new URLSearchParams({ ...params, page: String(page) })}`;
      const res = await fetch(url, {
        headers: { authorization: `Key ${key}` },
        cache: "no-store",
      });
      if (!res.ok) {
        return { ...empty, error: `fal ledger returned ${res.status}` };
      }
      const body = (await res.json()) as { items?: LedgerRequest[] };
      const batch = body.items ?? [];
      items.push(...batch);
      if (batch.length < MAX_PAGE_SIZE) break;
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "fal ledger unreachable" };
  }

  const isFailure = (r: LedgerRequest) => /^[45]/.test(String(r.status_code ?? ""));
  const units = (r: LedgerRequest) => Number(r.billable_units ?? 0);

  const failures = items.filter(isFailure);
  const successes = items.filter((r) => !isFailure(r));

  const byEndpoint = new Map<string, number>();
  for (const r of failures) {
    const k = r.endpoint ?? "(unknown)";
    byEndpoint.set(k, (byEndpoint.get(k) ?? 0) + 1);
  }

  const times = items.map((r) => r.started_at).filter((t): t is string => Boolean(t)).sort();

  return {
    ok: true,
    windowDays,
    total: items.length,
    succeeded: successes.length,
    failed: failures.length,
    billedFailures: failures.filter((r) => units(r) > 0),
    billableUnitsOnFailures: failures.reduce((s, r) => s + units(r), 0),
    billableUnitsOnSuccess: successes.reduce((s, r) => s + units(r), 0),
    oldest: times[0] ?? null,
    newest: times[times.length - 1] ?? null,
    failuresByEndpoint: [...byEndpoint.entries()]
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export type FalBalance =
  | { ok: true; balanceUsd: number; currency: string }
  | { ok: false; error: string };

/**
 * The account's remaining fal credit (2026-08-30).
 *
 * Needs an ADMIN-scope key — the ordinary FAL_KEY returns 403 "not permitted"
 * here (verified). Kept in a separate env var rather than upgrading FAL_KEY
 * because admin scope also covers CLI operations and serverless deployment,
 * and the render path has no business holding that.
 *
 * `expand=credits` is what adds the balance; without it the response is just
 * the username. The FOCUS billing report on the sibling endpoint would give a
 * spend breakdown, but it is gated: verified 2026-08-30, this account gets
 * 403 "FOCUS reports require additional permissions."
 */
export async function getFalBalance(): Promise<FalBalance> {
  const key = process.env.FAL_ADMIN_KEY;
  if (!key) return { ok: false, error: "FAL_ADMIN_KEY is not set." };
  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { authorization: `Key ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 403
            ? "FAL_ADMIN_KEY is not Admin scope (fal returned 403)."
            : `fal billing returned ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      credits?: { current_balance?: number; currency?: string };
    };
    const balance = body.credits?.current_balance;
    if (typeof balance !== "number") return { ok: false, error: "No balance in fal's response." };
    return { ok: true, balanceUsd: balance, currency: body.credits?.currency ?? "USD" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fal billing unreachable" };
  }
}
