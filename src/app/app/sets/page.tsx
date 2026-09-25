import { SETS_OPEN_TO_PLANS } from "@/lib/sets/set-config";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readRenderNotifyPrefs } from "@/lib/generations/generation-defaults-server";
import { getServerMessages } from "@/lib/i18n/server";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isNativeApp } from "@/lib/native/server";
import { getSetsHome } from "@/lib/sets/data";
import { finisherCanRun } from "@/lib/sets/finisher";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_UNAVAILABLE } from "@/lib/sets/messages";
import { SetsHome } from "@/components/sets/sets-home";
import { SetsUpgrade } from "@/components/sets/sets-upgrade";

// Sets (Astra Sets, Phase 1, 2026-09-10; Astra chat since 2026-09-14): the
// home asks what we are shooting today. The person says who, where and
// what happens; Astra builds the place if there is none, and the set's page
// takes it from there as a conversation. On every paid plan since
// 2026-09-19 (SETS_OPEN_TO_PLANS). A free account on the web gets a page
// saying Helios is on the paid plans, with "See plans" (SetsUpgrade, Helios
// Cut 3, step 3), instead of "not found". While Helios is closed to the
// plans, and in the Android shell, a free account still gets "not found",
// rather than an advert for a feature it cannot open.
//
// Whether a build can be left to finish is read here, on the server
// (finisherCanRun: the finisher cron runs only with CRON_SECRET set), and
// handed down as a yes or no — never the secret. So are the person's two
// render switches (Settings → Notifications), which govern the notification
// a tab in the background shows for a build it collected itself, as they
// govern the finisher's push.
//
// A failed set's own page links back here with ?again=<id> (Helios Cut 3,
// step 5): the home puts that build's words back in its box, and only when
// that id is one of this person's failed builds from words that can be
// tried again (lib/sets/try-again.ts). Nothing is spent until the build
// button is pressed.

// A set from a photo runs the picture check inside its server action
// (submitSetPhotoBuild: two readers, a third on the line, 10–100 s), and a
// server action runs under THIS route's function budget — the same ceiling
// the community and generate pages declare for the same check (2026-09-11).
export const maxDuration = 300;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const [data, notify, query] = await Promise.all([
    getSetsHome(),
    readRenderNotifyPrefs(supabase, userData.user.id),
    searchParams,
  ]);
  if (data.error === SETS_SESSION_EXPIRED) redirect("/login");
  // Web-only until the Play listing is reinstated: the Android shell follows
  // the reader-mode rule (lib/native/platform.ts). Read before the 404 below,
  // which it decides for a free account.
  const native = await isNativeApp();
  if (data.error === SETS_UNAVAILABLE || (data.error === SETS_NOT_OPEN && (native || !SETS_OPEN_TO_PLANS))) notFound();

  const { t } = await getServerMessages();
  if (data.error === SETS_NOT_OPEN) return <SetsUpgrade t={t} native={native} />;
  const s = t.sets;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
        {/* Only while Helios 3D is closed to the plans: after the launch every
            paying customer saw "only admins can see Helios" (found 2026-09-21). */}
        {!SETS_OPEN_TO_PLANS && (
          <p className="inline-block rounded-full border border-atelier-accent/40 bg-atelier-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-atelier-ink">
            {s.previewNote}
          </p>
        )}
      </div>
      {native ? (
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{s.title}</h1>
          <p className="mt-2 text-sm text-atelier-muted">{s.webOnly}</p>
        </div>
      ) : data.error !== null ? (
        <p className="text-sm text-atelier-muted">{localizeServerText(data.error, t)}</p>
      ) : (
        <SetsHome
          initialSets={data.sets}
          usedThisMonth={data.usedThisMonth}
          usedKnown={data.usedKnown}
          monthlyLimit={data.monthlyLimit}
          shotsThisMonth={data.shotsThisMonth}
          photoSetsOn={data.photoSetsOn}
          characters={data.characters}
          finisherOn={finisherCanRun()}
          notifyReady={notify.ready}
          notifyFailed={notify.failed}
          againId={first(query.again)}
        />
      )}
    </div>
  );
}
