import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isNativeApp } from "@/lib/native/server";
import { getSetPage, getStudioPage } from "@/lib/sets/data";
import { finisherCanRun } from "@/lib/sets/finisher";
import { buildingHintKey } from "@/lib/sets/leaving";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_UNAVAILABLE, SET_NOT_FOUND } from "@/lib/sets/messages";
import { HELIOS_CYCLES_FOR_ALL, HELIOS_STUDIO_FOR_ALL, SETS_OPEN_TO_PLANS } from "@/lib/sets/set-config";
import { SHOT_WORDS_MAX_CHARS } from "@/lib/sets/shot-words";
import { tryAgainWords } from "@/lib/sets/try-again";
import { SetBuilding } from "@/components/sets/set-building";
import { SetEditor } from "@/components/sets/set-editor";
import { SetView } from "@/components/sets/set-view";
import { SetsUpgrade } from "@/components/sets/sets-upgrade";
import { HeliosStudio } from "@/components/studio/helios-studio";
import { StudioOpening } from "@/components/studio/studio-opening";
import { canUseRecast } from "@/lib/recast/actions";
import { readRecastCharacters } from "@/lib/recast/data";

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
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Helios Studio (?studio=1, 2026-09-30 — "Speed up the loading"): "Opening the set…" streams at once, and
  // the Studio's own few reads fill it in (StudioRoute). Anything it can't open goes to the set page.
  if (first(query.studio) === "1") {
    const { t } = await getServerMessages();
    return (
      <Suspense fallback={<StudioOpening words={t.sets.studioOpening} />}>
        <StudioRoute id={id} />
      </Suspense>
    );
  }
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const data = await getSetPage(id);
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
  const studioOn = data.error === null && (data.modelsOn || HELIOS_STUDIO_FOR_ALL);

  // The set's second life (the Set Editor, drawn on canvas page G and built
  // 2026-09-14): ?build=1 opens the same set as a full-screen editor — Build
  // beside Shoot. It replaces the workspace whole, so only one stage runs.
  // Helios Studio (2026-09-26): the Blender-style workspace, admins first.
  if (ready && data.error === null && data.set.spec && first(query.build) === "1") {
    return (
      <SetEditor
        setId={data.set.id}
        original={data.set.spec}
        initialEdited={data.set.editedSpec}
        closeHref={`/app/sets/${data.set.id}`}
        astraEditsLeft={data.astraEditsLeft}
        astraPaused={data.astraPaused}
        initialSeal={data.set.seal}
        originalSeal={data.set.originalSeal}
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
        studioHref={studioOn ? `/app/sets/${data.set.id}?studio=1` : null}
        namingOn={data.namingOn}
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
        astraPaused={data.astraPaused}
        readerV2={data.readerV2}
        producerOn={data.producerOn}
        initialSeal={data.set.seal}
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

/**
 * Helios Studio's page (?studio=1): only what it needs, read at once (lib/sets/data.ts getStudioPage) — the
 * set, its working copy, the characters, the saved scene, Recast's characters when Recast lets them in.
 * A set it can't open (not ready, not theirs, closed to them, the Android shell) goes to the set page, which
 * says why.
 */
async function StudioRoute({ id }: { id: string }) {
  const [data, native, recastGate] = await Promise.all([
    getStudioPage(id, (db, userId) => readRecastCharacters(db, userId)),
    isNativeApp(),
    canUseRecast(),
  ]);
  if (data.error !== null || native || !data.set.ready || !data.set.spec || !(data.modelsOn || HELIOS_STUDIO_FOR_ALL)) redirect(`/app/sets/${id}`);
  return (
    <HeliosStudio
      setId={data.set.id}
      title={data.set.title}
      spec={data.set.spec}
      savedScene={data.savedScene}
      characters={data.characters}
      cyclesOn={data.modelsOn || HELIOS_CYCLES_FOR_ALL}
      recastCharacters={recastGate.error === null ? data.also : null}
      castId={data.set.castId}
    />
  );
}
