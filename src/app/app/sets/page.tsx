import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isNativeApp } from "@/lib/native/server";
import { getSetsHome } from "@/lib/sets/data";
import { finisherCanRun } from "@/lib/sets/finisher";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_UNAVAILABLE } from "@/lib/sets/messages";
import { SetsHome } from "@/components/sets/sets-home";

// Sets (Astra Sets, Phase 1, 2026-09-10): places GPT-6 Astra builds once,
// where the person shoots their characters from any angle. Admins only while
// in testing, behind the astra_sets flag — and to anyone else this page does
// not exist, rather than advertising a feature they cannot open.
//
// Whether a build can be left to finish is read here, on the server
// (finisherCanRun: the finisher cron runs only with CRON_SECRET set), and
// handed down as a yes or no — never the secret.

// A set from a photo runs the picture check inside its server action
// (submitSetPhotoBuild: two readers, a third on the line, 10–100 s), and a
// server action runs under THIS route's function budget — the same ceiling
// the community and generate pages declare for the same check (2026-09-11).
export const maxDuration = 300;

export default async function SetsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const data = await getSetsHome();
  if (data.error === SETS_SESSION_EXPIRED) redirect("/login");
  if (data.error === SETS_UNAVAILABLE || data.error === SETS_NOT_OPEN) notFound();

  const { t } = await getServerMessages();
  const s = t.sets;
  // Web-only until the Play listing is reinstated: the Android shell follows
  // the reader-mode rule (lib/native/platform.ts).
  const native = await isNativeApp();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{s.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-atelier-muted">{s.subtitle}</p>
        <p className="mt-2 inline-block rounded-full border border-atelier-accent/40 bg-atelier-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-atelier-ink">
          {s.previewNote}
        </p>
      </div>
      {native ? (
        <p className="text-sm text-atelier-muted">{s.webOnly}</p>
      ) : data.error !== null ? (
        <p className="text-sm text-atelier-muted">{localizeServerText(data.error, t)}</p>
      ) : (
        <SetsHome
          initialSets={data.sets}
          usedThisMonth={data.usedThisMonth}
          monthlyLimit={data.monthlyLimit}
          photoSetsOn={data.photoSetsOn}
          finisherOn={finisherCanRun()}
        />
      )}
    </div>
  );
}
