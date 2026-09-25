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
import { SETS_OPEN_TO_PLANS } from "@/lib/sets/set-config";
import { SHOT_WORDS_MAX_CHARS } from "@/lib/sets/shot-words";
import { tryAgainWords } from "@/lib/sets/try-again";
import { SetBuilding } from "@/components/sets/set-building";
import { SetEditor } from "@/components/sets/set-editor";
import { SetView } from "@/components/sets/set-view";
import { SetsUpgrade } from "@/components/sets/sets-upgrade";

// One Set, open (Astra Sets, 2026-09-10; a workspace with Astra since
// 2026-09-14). Everything the view needs — the normalised set, the person's
// saved arrangement, their characters, the stills already shot here with
// the words that asked for them — arrives in one read, so the page paints
// its real state at once.
//
// A ready set is a workspace and takes the app's full width (globals.css
// lifts the reading column's limit for a page that carries
// data-set-workspace): a compact bar with the set's name and Astra's
// description, then the stage and the conversation side by side. A set
// still building, or one that failed, keeps the ordinary column.
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
  const native = await isNativeApp();
  // A free account on the web gets the Sets home's upgrade page (Helios Cut
  // 3, step 3); in the Android shell, or while Helios is closed to the plans,
  // it stays 404. The access check runs before the set is looked up
  // (lib/sets/data.ts getSetPage), so the page says nothing about whether
  // this set exists. A set that isn't there, or isn't theirs, stays 404.
  if (
    data.error === SETS_UNAVAILABLE ||
    data.error === SET_NOT_FOUND ||
    (data.error === SETS_NOT_OPEN && (native || !SETS_OPEN_TO_PLANS))
  )
    notFound();

  const { t } = await getServerMessages();
  if (data.error === SETS_NOT_OPEN) return <SetsUpgrade t={t} native={native} />;
  const s = t.sets;
  const set = data.error === null ? data.set : null;
  const finisherOn = finisherCanRun();
  const ask = (first(query.ask) ?? "").trim().slice(0, SHOT_WORDS_MAX_CHARS) || null;
  const character = first(query.character);
  const askFirst = first(query.askFirst) !== "0";
  // The message is the one the Sets home built this set from (sets-home.tsx
  // threadHref): its place part is built already, never sent to Astra again.
  const askBuilt = ask !== null && first(query.from) === "build";
  const ready = data.error === null && data.set.status === "ready" && data.set.spec !== null && !native;

  // The set's second life (the Set Editor, drawn on canvas page G and built
  // 2026-09-14): ?build=1 opens the same set as a full-screen editor — Build
  // beside Shoot. It replaces the workspace whole, so only one stage runs.
  if (ready && data.error === null && data.set.spec && first(query.build) === "1") {
    return (
      <SetEditor
        setId={data.set.id}
        original={data.set.spec}
        initialEdited={data.set.editedSpec}
        closeHref={`/app/sets/${data.set.id}`}
        astraEditsLeft={data.astraEditsLeft}
      />
    );
  }
  // A ready set is the workspace itself: the viewport takes the whole
  // screen, the way 3D Jutsu's does, and carries its own bar — the page's
  // frame is only for a set still building, or one that failed.
  if (ready && data.error === null && data.set.spec) {
    return (
      <SetView
        setId={data.set.id}
        title={data.set.title}
        spec={data.set.editedSpec ?? data.set.spec}
        savedFilm={data.set.film}
        savedRig={data.set.rig}
        initialFilmOpen={first(query.film) === "1"}
        initialCutOpen={first(query.cut) === "1"}
        initialLayout={data.set.layout}
        hasThumb={data.set.hasThumb}
        sourcePhotoUrl={data.set.sourcePhotoUrl}
        characters={data.characters}
        initialShots={data.shots}
        identityBar={data.identityBar}
        matchOn={data.matchOn}
        modelsOn={data.modelsOn}
        simpleLayout={data.simpleLayout}
        initialThingModels={data.thingModels}
        takesOn={data.takesOn}
        liveOn={data.liveOn}
        initialElementPhotos={data.elementPhotos}
        stillModel={data.stillModel}
        unshootable={data.unshootable}
        initialAsk={ask}
        initialCharacterId={character}
        initialAskFirst={askFirst}
        initialAskBuilt={askBuilt}
        astraEditsLeft={data.astraEditsLeft}
        astraEditsCap={data.astraEditsCap}
        readerV2={data.readerV2}
        producerOn={data.producerOn}
      />
    );
  }

  // A photo set has no brief: it says where it came from, and the photographer's notes if any.
  const brief = set ? (set.fromPhoto ? (set.brief ? `${s.fromPhoto} · ${set.brief}` : s.fromPhoto) : set.brief) : "";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/app/sets" className="text-xs font-medium text-atelier-muted hover:text-atelier-ink">
          ← {s.back}
        </Link>
        <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{set?.title || s.untitled}</h1>
        {brief && <p className="mt-1 max-w-2xl text-sm text-atelier-muted">{brief}</p>}
      </div>

      {native ? (
        <p className="text-sm text-atelier-muted">{s.webOnly}</p>
      ) : data.error !== null ? (
        <p className="text-sm text-atelier-muted">{localizeServerText(data.error, t)}</p>
      ) : data.set.status === "building" ? (
        <SetBuilding setId={data.set.id} ask={ask} hint={s[buildingHintKey(data.set.fromPhoto, finisherOn)]} />
      ) : (
        <div className="space-y-2 text-sm text-atelier-muted">
          {ask && <p>{s.buildFailedLine}</p>}
          <p>{data.error === null && data.set.failure ? localizeServerText(data.set.failure, t) : s.loadFailed}</p>
          {/* A failed build from words: its words go back in the Sets home's box (Helios Cut 3, step 5). Nothing is spent until the build button there. */}
          {set && tryAgainWords(set) !== null && (
            <Link
              href={`/app/sets?again=${set.id}`}
              title={s.buildTryAgainHint}
              className="inline-flex items-center rounded-full bg-atelier-ink/[0.045] px-3 py-[7px] text-xs font-medium text-atelier-muted transition-colors hover:bg-atelier-ink/[0.07] hover:text-atelier-ink"
            >
              {s.buildTryAgain}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
