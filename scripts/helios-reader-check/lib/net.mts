// The check's network fence (Helios Cut 2, step 13, 2026-09-25): the Astra
// Sets eval's own guard (scripts/astra-sets-eval/lib/net-guard.mts) wraps
// every fetch before any product module loads, and this check narrows it to
// one address — POST https://api.openai.com/v1/chat/completions — and only
// in a --live run. A dry run is the guard's "offline": every host is
// blocked, the summary counts it, and a clean dry run ends with
// "network: 0 live calls, 0 blocked".
//
// Nothing here imports a product module: run.mts installs this before any
// is loaded. The per-call fence is fence.mts.

import { installNetGuard, NetGuardBlocked, type NetGuard } from "../../astra-sets-eval/lib/net-guard.mts";

/** Installs the guard ("offline" unless live) and, for a live run, narrows it to the reader's one address. */
export function installReaderFence(live: boolean): NetGuard {
  const guard = installNetGuard(live ? "live" : "offline");
  if (live) {
    const guarded = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let ok = false;
      let host = "(unparseable url)";
      try {
        const u = new URL(url);
        host = u.hostname;
        ok = u.protocol === "https:" && u.hostname === "api.openai.com" && u.pathname === "/v1/chat/completions";
      } catch {
        ok = false;
      }
      if (!ok) {
        const why = "the reader check calls only api.openai.com/v1/chat/completions";
        guard.blocked.push({ host, why, at: new Date().toISOString() });
        throw new NetGuardBlocked(host, why);
      }
      return guarded(input, init);
    }) as typeof fetch;
  }
  return guard;
}
