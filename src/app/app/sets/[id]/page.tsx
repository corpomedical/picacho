import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isNativeApp } from "@/lib/native/server";
import { getSetPage } from "@/lib/sets/data";
import { finisherCanRun } from "@/lib/sets/finisher";
import { buildingHintKey } from "@/lib/sets/leaving";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_UNAVAILABLE, SET_NOT_FOUND } from "@/lib/sets/messages";
import { SHOT_WORDS_MAX_CHARS } from "@/lib/sets/shot-words";
import { SetBuilding } from "@/components/sets/set-building";
import { SetView } from "@/components/sets/set-view";

// One Set, open (Astra Sets, 2026-09-10; a conversation with Astra since
// 2026-09-14). Everything the view needs — the normalised set, the person's
// saved arrangement, their characters, the stills already shot here with
// the words that asked for them — arrives in one read, so the page paints
// its real state at once.
//
// A message sent from the Sets home rides in the address (?ask=, with the
// character picked and whether Astra should wait): a ready set asks it of
// the stage the moment the stage is ready, then forgets it; a set still
// building shows it above the building step and refreshes into the
// conversation when the build settles. The address is the person's own;
// nothing in it is logged.
//
// A set still building says how long it takes and whether it can be left:
// with the finisher running (finisherCanRun, read here on the server) it
// completes on its own and the owner's browser is told — the "ready"
// notification opens this page; without it, only an open Sets page collects
// it. The line is the Sets list's own (lib/sets/leaving.ts buildingHintKey).

// A shot awaits runGeneration inside the server action, which runs under
// THIS route's function budget — the same 300 s the generate page declares.
// So does Match this shot, which waits for its read (set-config.ts times it).
export const maxDuration = 300;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const [data, query] = await Promise.all([getSetPage(id), searchParams]);
  if (data.error === SETS_SESSION_EXPIRED) redirect("/login");
  if (data.error === SETS_UNAVAILABLE || data.error === SETS_NOT_OPEN || data.error === SET_NOT_FOUND) notFound();

  const { t } = await getServerMessages();
  const s = t.sets;
  const native = await isNativeApp();
  const set = data.error === null ? data.set : null;
  const finisherOn = finisherCanRun();
  const ask = (first(query.ask) ?? "").trim().slice(0, SHOT_WORDS_MAX_CHARS) || null;
  const character = first(query.character);
  const askFirst = first(query.askFirst) !== "0";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/app/sets" className="text-xs font-medium text-atelier-muted hover:text-atelier-ink">
          ← {s.back}
        </Link>
        <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">
          {set?.title || s.untitled}
        </h1>
        {set && (
          <p className="mt-1 max-w-2xl text-sm text-atelier-muted">
            {/* A photo set has no brief: it says where it came from, and the photographer's notes if any. */}
            {set.fromPhoto ? (set.brief ? `${s.fromPhoto} · ${set.brief}` : s.fromPhoto) : set.brief}
          </p>
        )}
      </div>

      {native ? (
        <p className="text-sm text-atelier-muted">{s.webOnly}</p>
      ) : data.error !== null ? (
        <p className="text-sm text-atelier-muted">{localizeServerText(data.error, t)}</p>
      ) : data.set.status === "building" ? (
        <SetBuilding setId={data.set.id} ask={ask} hint={s[buildingHintKey(data.set.fromPhoto, finisherOn)]} />
      ) : data.set.status === "failed" || !data.set.spec ? (
        <div className="space-y-2 text-sm text-atelier-muted">
          {ask && <p>{s.buildFailedLine}</p>}
          <p>{data.set.failure ? localizeServerText(data.set.failure, t) : s.loadFailed}</p>
        </div>
      ) : (
        <SetView
          setId={data.set.id}
          spec={data.set.spec}
          initialLayout={data.set.layout}
          hasThumb={data.set.hasThumb}
          sourcePhotoUrl={data.set.sourcePhotoUrl}
          description={data.set.description}
          characters={data.characters}
          initialShots={data.shots}
          identityBar={data.identityBar}
          matchOn={data.matchOn}
          initialAsk={ask}
          initialCharacterId={character}
          initialAskFirst={askFirst}
        />
      )}
    </div>
  );
}
