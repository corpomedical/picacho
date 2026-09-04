"use client";

import { PERSPECTIVE_SHOTS } from "@/lib/characters/perspectives";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  saveCharacterProfile,
  deleteCharacterProfile,
  generateReferenceImage,
} from "@/lib/characters/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { ImageLightbox } from "@/components/image-lightbox";
import { VoicePreviewButton } from "@/components/voice-preview-button";
import { LocalDate } from "@/components/local-date";
import { QuietVideo } from "@/components/quiet-video";

// `url` is the real file (lightbox, and the anchor a generation uses);
// `thumbUrl` is the small version for the grid tile. Kept as two fields
// rather than one so a resized image can never be mistaken for the
// original — this grid sits right next to the identity photo, which is the
// one image in the product that must never be a downscale.
type ExistingImage = { path: string; url: string; thumbUrl?: string };

// Atelier idiom for this form (settings-popover, extended): paper sheets
// with hairline rules, caps section titles, ink-hairline fields at the
// control radius. Accent only ever marks focus; photos keep the media radius.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";
const SHEET_TITLE = "text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
// The Ledger eyebrow — the masthead and every fold heading use it, so a
// bare section can carry a heading without wearing a card.
const EYEBROW = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted";
const LABEL = "block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

// THE FOLD (project + character redesign, direction A, operator pick
// 2026-09-04). On an EXISTING character this page is a profile — portrait,
// figures, the work — so the seven form sheets that used to BE the page
// group into three disclosures a click away. While CREATING a character
// there is no profile to show and nothing to fold: `folded` is false and
// every section renders exactly as it did before.
//
// A closed <details> keeps its inputs in the DOM, so folding changes
// nothing about what the form submits. It would change one thing —
// browsers refuse to submit when a `required` field is hidden, and they do
// it silently — which is why the one required field, the name, is never in
// a fold: in edit mode it IS the masthead.
function Fold({
  folded,
  title,
  meta,
  children,
}: {
  folded: boolean;
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  if (!folded) return <>{children}</>;
  return (
    <details className="group border-t border-atelier-rule pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
          {title}
        </h2>
        <span className="flex items-center gap-2 text-xs text-atelier-muted">
          {meta}
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="h-3.5 w-3.5 transition-transform group-[[open]]:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="mt-4 space-y-6">{children}</div>
    </details>
  );
}

type Initial = {
  id?: string;
  name?: string;
  traits?: {
    hair?: string;
    outfit?: string;
    personality?: string;
    distinguishing_features?: string;
  };
  motion_style?: string | null;
  voice_tone_tags?: string[];
  project_id?: string | null;
};

type ProjectOption = { id: string; name: string };
type VoiceOption = { id: string; label: string; description: string | null };

export function CharacterForm({
  userId,
  initial,
  existingImages = [],
  existingOutfitImages = [],
  errorMessage,
  projects = [],
  voices = [],
  recentRenders,
  stats,
}: {
  userId: string;
  initial?: Initial & { voice_id?: string | null; outfit_description?: string | null };
  existingImages?: ExistingImage[];
  existingOutfitImages?: ExistingImage[];
  errorMessage?: string;
  projects?: ProjectOption[];
  voices?: VoiceOption[];
  // "In action" (2026-08-27 redesign, case 4): this character's recent
  // succeeded image renders, queried by the edit page. Empty array = show
  // the first-shot nudge; undefined/new-character = no strip at all.
  recentRenders?: { id: string; url: string; score: number | null; isVideo?: boolean }[];
  /** The three figures on the masthead — see the project page for why the
      counts are read separately from the grid they sit above. */
  stats?: { renders: number; meanIdentity: number | null; lastWorkedAt: string | null };
}) {
  const { t } = useLocale();
  const c = t.character;
  const [name, setName] = useState(initial?.name ?? "");
  const [projectId, setProjectId] = useState(initial?.project_id ?? "");
  const [hair, setHair] = useState(initial?.traits?.hair ?? "");
  const [outfit, setOutfit] = useState(initial?.traits?.outfit ?? "");
  const [personality, setPersonality] = useState(initial?.traits?.personality ?? "");
  const [distinguishing, setDistinguishing] = useState(
    initial?.traits?.distinguishing_features ?? "",
  );
  const [motionStyle, setMotionStyle] = useState(initial?.motion_style ?? "");
  const [voiceId, setVoiceId] = useState(initial?.voice_id ?? "");
  const [tags, setTags] = useState<string[]>(initial?.voice_tone_tags ?? []);
  const [tagInput, setTagInput] = useState("");

  const [keptImages, setKeptImages] = useState<ExistingImage[]>(existingImages);
  const [newFiles, setNewFiles] = useState<{ file: File; preview: string }[]>([]);
  // Outfit photos (2026-08-24) — clothing shots, kept apart from the identity
  // references above. Same bucket, own field, capped at 2.
  const [keptOutfit, setKeptOutfit] = useState<ExistingImage[]>(existingOutfitImages);
  const [newOutfitFiles, setNewOutfitFiles] = useState<{ file: File; preview: string }[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Every preview above is a URL.createObjectURL — each one pins its File's
  // bytes in memory until it's explicitly revoked, and nothing was revoking
  // them: not removing a tile, not leaving the page. On a phone, a few
  // multi-megapixel photos picked and discarded across a couple of visits is
  // real memory that never comes back. Removal revokes inline (see the tile's
  // ✕ handler below); this ref + effect pair covers unmount, where the
  // cleanup closure can't see current state directly.
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    previewUrlsRef.current = [
      ...newFiles.map((f) => f.preview),
      ...newOutfitFiles.map((f) => f.preview),
    ];
  }, [newFiles, newOutfitFiles]);
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(errorMessage ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outfitFileInputRef = useRef<HTMLInputElement>(null);

  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  // Perspective (2026-08-27): the one-tap reference sheet. `done` collects
  // finished shot ids for the progress chips; `current` names the shot
  // rendering right now; a run stops (keeping what landed) on first error.
  const [perspective, setPerspective] = useState<{
    running: boolean;
    current: string | null;
    done: string[];
  }>({ running: false, current: null, done: [] });

  const totalImages = keptImages.length + newFiles.length;

  // What the ROW already holds. Starts as the photos the page loaded with;
  // grows when a generated photo auto-persists (result.saved). Anything in
  // the form beyond this baseline is unsaved work the guards below protect.
  const [persistedPaths, setPersistedPaths] = useState<string[]>(() =>
    existingImages.map((i) => i.path),
  );

  // The Save button is real but forgettable (2026-08-27, operator lost a
  // Perspective run to it): generated photos now persist themselves, and
  // everything that still legitimately needs Save — renames, traits, photo
  // removals, fresh uploads — gets a leave guard instead of silent loss.
  const dirty =
    !submitting &&
    (name !== (initial?.name ?? "") ||
      projectId !== (initial?.project_id ?? "") ||
      hair !== (initial?.traits?.hair ?? "") ||
      outfit !== (initial?.traits?.outfit ?? "") ||
      personality !== (initial?.traits?.personality ?? "") ||
      distinguishing !== (initial?.traits?.distinguishing_features ?? "") ||
      motionStyle !== (initial?.motion_style ?? "") ||
      voiceId !== (initial?.voice_id ?? "") ||
      JSON.stringify(tags) !== JSON.stringify(initial?.voice_tone_tags ?? []) ||
      newFiles.length > 0 ||
      newOutfitFiles.length > 0 ||
      JSON.stringify(keptImages.map((i) => i.path)) !== JSON.stringify(persistedPaths) ||
      JSON.stringify(keptOutfit.map((i) => i.path)) !==
        JSON.stringify(existingOutfitImages.map((i) => i.path)));

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // In-app navigations never hit beforeunload, so a capture-phase click
    // guard covers the sidebar, tab bar and every other internal link.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (!window.confirm(c.unsavedLeaveConfirm)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, c.unsavedLeaveConfirm]);

  async function handleGenerateReference() {
    setGenError("");
    if (!genPrompt.trim()) {
      setGenError(c.describeFirst);
      return;
    }
    if (totalImages >= 5) {
      setGenError(c.maxImages);
      return;
    }

    setGenerating(true);
    const formData = new FormData();
    formData.set("prompt", genPrompt);
    // Anchor to the character's existing photos + typed visual traits so a
    // generated photo is the SAME person as the rest of the gallery — see
    // generateReferenceImage for why. Only server-stored photos can anchor;
    // newly picked local files haven't been uploaded yet at this point.
    formData.set("anchor_paths", JSON.stringify(keptImages.map((i) => i.path)));
    formData.set("trait_hair", hair);
    formData.set("trait_outfit", outfit);
    formData.set("trait_distinguishing_features", distinguishing);
    // Editing an existing character: the action appends the photo to the
    // row itself, so it can never be lost to an unpressed Save.
    if (initial?.id) formData.set("character_id", initial.id);

    // This call itself (not just what it returns) can fail — on a weak
    // mobile connection the fetch Next.js makes to invoke the server action
    // can drop before a response ever comes back, throwing a raw network
    // TypeError. Uncaught, that became an unhandled rejection: no message
    // ever reached genError, the button stayed stuck on "Generating…"
    // forever, and the only trace was an auto-filed report with a bare
    // "TypeError: network error" — exactly what surfaced this bug. Provider
    // errors (bad prompt, safety filter, etc.) still come back as a normal
    // result.error below; this catch is only for the request never
    // completing at all.
    let result;
    try {
      result = await generateReferenceImage(formData);
    } catch (err) {
      console.error("generateReferenceImage request failed:", err);
      setGenError(c.connectionError);
      setGenerating(false);
      return;
    }

    if (result.error !== null) {
      setGenError(result.error);
      setGenerating(false);
      return;
    }

    if (result.saved) setPersistedPaths((prev) => [...prev, result.path]);
    setKeptImages((prev) => [...prev, { path: result.path, url: result.url }]);
    setGenPrompt("");
    setGenerating(false);
  }

  async function handleGeneratePerspectives() {
    setGenError("");
    if (keptImages.length === 0) {
      // Perspective RENDERS the same person from new angles — with no saved
      // photo there is no person to anchor to, and four unanchored renders
      // would be four strangers (the exact bug the anchor exists to stop).
      //
      // An UPLOADED photo is not a saved one: onFilesSelected puts files in
      // `newFiles` and they only reach storage on submit. Telling someone to
      // "add a photo first" while their photo is on the screen reads as a
      // broken button, so say the real thing.
      setGenError(newFiles.length > 0 ? c.perspectiveNeedsSaved : c.perspectiveNeedsPhoto);
      return;
    }
    const slots = 5 - totalImages;
    if (slots <= 0) {
      setGenError(c.maxImages);
      return;
    }

    setPerspective({ running: true, current: null, done: [] });
    // Every shot anchors to the photos that existed BEFORE the run — the
    // user's chosen source of truth — never to the shots the run itself
    // just added, so a drifted early shot can't compound into later ones.
    const anchorPathsJson = JSON.stringify(keptImages.map((i) => i.path));

    for (const shot of PERSPECTIVE_SHOTS.slice(0, slots)) {
      setPerspective((prev) => ({ ...prev, current: shot.id }));
      const formData = new FormData();
      formData.set("prompt", shot.prompt);
      formData.set("anchor_paths", anchorPathsJson);
      formData.set("trait_hair", hair);
      formData.set("trait_outfit", outfit);
      formData.set("trait_distinguishing_features", distinguishing);
      // The Perspective set persists shot by shot on an existing character —
      // the exact run the operator lost to the unpressed Save button.
      if (initial?.id) formData.set("character_id", initial.id);

      let result;
      try {
        result = await generateReferenceImage(formData);
      } catch (err) {
        console.error("generateReferenceImage (perspective) failed:", err);
        setGenError(c.connectionError);
        setPerspective((prev) => ({ ...prev, running: false, current: null }));
        return;
      }
      if (result.error !== null) {
        // Stop, keep what landed — each finished shot is a real reference
        // photo whatever happened after it (allowance ran out, provider
        // hiccup). The error line says why the set is partial.
        setGenError(result.error);
        setPerspective((prev) => ({ ...prev, running: false, current: null }));
        return;
      }
      if (result.saved) setPersistedPaths((prev) => [...prev, result.path]);
      setKeptImages((prev) => [...prev, { path: result.path, url: result.url }]);
      setPerspective((prev) => ({ ...prev, done: [...prev.done, shot.id] }));
    }
    setPerspective((prev) => ({ ...prev, running: false, current: null }));
  }

  function addTag() {
    const value = tagInput.trim();
    if (value && !tags.includes(value)) {
      setTags([...tags, value]);
    }
    setTagInput("");
  }

  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    const remainingSlots = 5 - totalImages;
    const picked = Array.from(files).slice(0, Math.max(remainingSlots, 0));
    setNewFiles([
      ...newFiles,
      ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }

  const totalOutfitImages = keptOutfit.length + newOutfitFiles.length;
  function onOutfitFilesSelected(files: FileList | null) {
    if (!files) return;
    const remainingSlots = 2 - totalOutfitImages;
    const picked = Array.from(files).slice(0, Math.max(remainingSlots, 0));
    setNewOutfitFiles([
      ...newOutfitFiles,
      ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError(c.giveName);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const uploadedPaths: string[] = [];

      for (const { file } of newFiles) {
        const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("character-references")
          .upload(path, file);
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
      }

      // Outfit photos share the bucket; the "outfit-" name prefix is purely
      // for humans reading the storage browser — the row's outfit_image_urls
      // column is what actually separates them from identity references.
      const uploadedOutfitPaths: string[] = [];
      for (const { file } of newOutfitFiles) {
        const path = `${userId}/outfit-${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("character-references")
          .upload(path, file);
        if (uploadError) throw uploadError;
        uploadedOutfitPaths.push(path);
      }

      const formData = new FormData();
      if (initial?.id) formData.set("id", initial.id);
      formData.set("name", name);
      formData.set("trait_hair", hair);
      formData.set("trait_outfit", outfit);
      formData.set("trait_personality", personality);
      formData.set("trait_distinguishing_features", distinguishing);
      formData.set("motion_style", motionStyle);
      formData.set("project_id", projectId);
      formData.set("voice_id", voiceId);
      formData.set("tags", JSON.stringify(tags));
      formData.set(
        "reference_image_paths",
        JSON.stringify([...keptImages.map((i) => i.path), ...uploadedPaths]),
      );
      formData.set(
        "outfit_image_paths",
        JSON.stringify([...keptOutfit.map((i) => i.path), ...uploadedOutfitPaths]),
      );

      const result = await saveCharacterProfile(formData);

      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      // A full navigation here (rather than router.push) guarantees the
      // destination page re-fetches from the database instead of showing a
      // cached, pre-save version. For a brand-new character, send the user
      // straight into Generate instead of back to the list — it's the next
      // thing they actually want to do, and Generate defaults its character
      // picker to the most recently created one, so the character they just
      // made is already selected.
      window.location.assign(initial?.id ? "/app/character" : "/app/generate");
    } catch (err) {
      console.error("Failed to save character:", err);
      // The direct-to-storage photo upload above can hit the same raw
      // network TypeError as the reference-image generator on a weak
      // connection — same fix here: recognize it and show the plain
      // connection message instead of the technical one.
      const message = err instanceof Error ? err.message : "";
      const isNetworkError = /network|fetch|failed to load/i.test(message);
      setError(isNetworkError ? c.connectionError : message || c.somethingWrong);
      setSubmitting(false);
    }
  }

  // Lifted out of the JSX so it can render in two places without being
  // written twice: FIRST while creating (the old order — name, then photos),
  // and LAST when editing, inside the "Character settings" fold. The name
  // field itself only appears here during creation; on an existing character
  // the masthead carries it.
  const basicsSection = (
    <section className={SHEET}>
      <div className="mt-4">
        <label htmlFor="project" className={LABEL}>
          {c.project}
        </label>
        <select
          id="project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={`mt-1 w-full ${FIELD}`}
        >
          <option value="">{c.noProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );

  return (
    <div className={initial?.id ? "space-y-6" : "mx-auto max-w-3xl space-y-6"}>
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* MASTHEAD (direction A, 2026-09-04): the same Ledger head the
           project shelf and the project page carry — eyebrow, the name set
           in the serif, the three figures on the right. The name is an input
           styled as the title: the field that used to sit in "Basics" is now
           the heading you click and type into, which is also why no
           `required` control ever ends up hidden inside a fold.

           It renders while CREATING too (2026-09-04, operator: "the create
           new character page still has the same UI"). There, naming the
           character IS the first move, so the empty serif field with its own
           prompt is the whole top of the page — and the figures, which have
           nothing to count yet, simply do not render. */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-atelier-rule pb-5">
          <div className="min-w-0 flex-1">
            <h1 className="sr-only">{initial?.id ? name || c.eyebrowOne : c.newTitle}</h1>
            <p className={EYEBROW} aria-hidden>
              {initial?.id ? c.eyebrowOne : c.newTitle}
            </p>
            <input
              id="name"
              aria-label={c.characterName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              placeholder={initial?.id ? c.namePlaceholder : c.nameTitlePlaceholder}
              className="-mx-1.5 mt-1 w-[calc(100%+0.75rem)] truncate rounded-control border border-transparent bg-transparent px-1.5 py-0.5 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink outline-none transition-colors hover:border-atelier-rule focus:border-atelier-accent"
            />
          </div>
          {stats && (
            <dl className="flex flex-shrink-0 gap-8">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {c.statRenders}
                </dt>
                <dd className="mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-ink">
                  {stats.renders}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {c.statIdentity}
                </dt>
                <dd
                  className={
                    stats.meanIdentity === null
                      ? "mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-muted"
                      : "mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-accent"
                  }
                >
                  {stats.meanIdentity ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {c.statLastWorked}
                </dt>
                <dd className="mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-ink">
                  {stats.lastWorkedAt ? (
                    <LocalDate
                      date={stats.lastWorkedAt}
                      mode="since"
                      labels={{ minutes: c.agoMinutes, hours: c.agoHours, days: c.agoDays, weeks: c.agoWeeks }}
                    />
                  ) : (
                    c.statNever
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>

      {initial?.id && (
        /* Profile hero (2026-08-27 redesign, case 2): meet the character
           first, edit second. Portrait, live name, the lock meter, and the
           two actions that matter. The meter lives HERE in edit mode; the
           in-section copy of it below renders only during creation. */
        <div className="flex items-stretch gap-5">
          <span className="block h-40 w-32 flex-none overflow-hidden rounded-[16px] bg-atelier-ink/5">
            {keptImages[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={keptImages[0].url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-atelier-ink to-[#3a3f4c] font-display text-4xl font-semibold text-atelier-paper/60">
                {name?.[0]?.toUpperCase() ?? "?"}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1 py-1">
            <span aria-hidden className="flex items-center gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={
                    i < totalImages
                      ? "h-1.5 w-6 rounded-full bg-atelier-accent"
                      : "h-1.5 w-6 rounded-full bg-atelier-rule"
                  }
                />
              ))}
            </span>
            <p className="mt-1 text-xs text-atelier-muted">
              {totalImages <= 1 ? c.lockTipOne : totalImages <= 3 ? c.lockTipFew : c.lockTipMax}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={`/app/generate?character=${encodeURIComponent(initial.id)}`}
                className="rounded-full bg-atelier-ink px-4 py-2 text-xs font-semibold text-atelier-paper transition-opacity hover:opacity-90"
              >
                {formatMsg(c.heroGenerateWith, { name: name || "…" })}
              </Link>
              <button
                type="button"
                onClick={handleGeneratePerspectives}
                disabled={perspective.running || generating || totalImages >= 5 || keptImages.length === 0}
                className="rounded-full px-4 py-2 text-xs font-medium text-atelier-ink shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] transition-colors hover:bg-atelier-ink/5 disabled:opacity-50"
              >
                {perspective.running ? c.perspectiveRunning : `◇ ${c.perspectiveButton}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {initial?.id && recentRenders && (
        /* "In action" (case 4): the receipts. Consistency is the product's
           pitch; the profile shows the character actually holding up. */
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
              {c.inActionTitle}
            </h2>
            {recentRenders.length > 0 && (
              <Link href="/app/history" className="text-[11px] text-atelier-muted underline underline-offset-2 hover:text-atelier-ink">
                {c.inActionViewAll}
              </Link>
            )}
          </div>
          {recentRenders.length === 0 ? (
            <p className="mt-2 text-sm text-atelier-muted">{c.inActionEmpty}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {recentRenders.map((r) => (
                <Link
                  key={r.id}
                  href={`/app/history/${r.id}`}
                  className="group relative block aspect-[4/3] overflow-hidden rounded-media bg-atelier-stage"
                >
                  {r.isVideo ? (
                    <QuietVideo
                      pending="disc"
                      src={`${r.url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      // A receipt that can't paint isn't a receipt. Old rows can
                      // hold externally-hosted URLs (pre-persist era) that rot —
                      // drop the whole tile rather than show a broken image.
                      onError={(e) => {
                        (e.currentTarget.closest("a") as HTMLElement | null)?.style.setProperty("display", "none");
                      }}
                    />
                  )}
                  {r.score !== null && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#1b1c20]/72 px-2 py-1 backdrop-blur-sm">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#e0a468]" />
                      <span className="font-numeral text-[11px] font-semibold tabular-nums text-[#f4ede4]">
                        {r.score}
                      </span>
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The photos never fold while creating: giving the character a face is
          the one thing that cannot be put off, and on a fresh page it is the
          only section that is open. Bare rather than in a card, so the page
          reads masthead → the work → two quiet folds. */}
      <Fold folded={!!initial?.id} title={c.referenceImages} meta={String(totalImages)}>
      <section className={initial?.id ? SHEET : ""}>
        {!initial?.id && <h2 className={EYEBROW}>{c.referenceImages}</h2>}
        <p className="mt-1 text-sm text-atelier-muted">
          {c.referenceImagesSubtitle}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {keptImages.map((img, idx) => (
            <div key={img.path} className="group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
              <button
                type="button"
                onClick={() => setLightboxUrl(img.url)}
                aria-label={c.viewImage}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl ?? img.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
              {idx === 0 && (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-atelier-ink">
                  {c.identityPhoto}
                </span>
              )}
              <button
                type="button"
                onClick={() => setKeptImages(keptImages.filter((i) => i.path !== img.path))}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-atelier-rule bg-atelier-surface/95 text-xs text-atelier-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {newFiles.map((f, idx) => (
            <div key={f.preview} className="group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
              <button
                type="button"
                onClick={() => setLightboxUrl(f.preview)}
                aria-label={c.viewImage}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.preview} alt="" className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => {
                  // Release the blob the moment the tile goes — and close the
                  // lightbox first if it's showing this exact preview, since a
                  // revoked object URL renders as a broken image.
                  if (lightboxUrl === f.preview) setLightboxUrl(null);
                  URL.revokeObjectURL(f.preview);
                  setNewFiles(newFiles.filter((_, i) => i !== idx));
                }}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-atelier-rule bg-atelier-surface/95 text-xs text-atelier-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {totalImages < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-media border border-dashed border-atelier-rule text-xs text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
            >
              {c.addImage}
            </button>
          )}
        </div>

        {/* Lock-strength coaching (competitive research, 2026-08-21): every
            serious competitor teaches the same recipe — front face, a
            three-quarter angle, full body, an expression — but makes users
            find it in a blog. Coach it right where the photos live. The
            meter is count-based (we can't classify pose from pixels); the
            tip supplies the variety advice. */}
        {!initial?.id && (
          <div className="mt-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
                {c.lockStrength}
              </span>
              <span aria-hidden className="flex items-center gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={
                      i < totalImages
                        ? "h-1.5 w-5 rounded-full bg-atelier-accent"
                        : "h-1.5 w-5 rounded-full bg-atelier-rule"
                    }
                  />
                ))}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-atelier-muted">
              {totalImages === 0
                ? c.lockTipNone
                : totalImages <= 1
                  ? c.lockTipOne
                  : totalImages <= 3
                    ? c.lockTipFew
                    : c.lockTipMax}
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />

        <div className="mt-4 border-t border-atelier-rule/60 pt-4">
          <p className="text-sm text-atelier-muted">{c.noPhotoYet}</p>
          <div className="mt-2 flex gap-2">
            <input
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              onKeyDown={(e) => {
                // Enter here means "generate this description", never
                // "save the character" — which is what the form's default
                // submit button would otherwise do, ending the visit on a
                // character with no face.
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!generating && totalImages < 5) void handleGenerateReference();
              }}
              disabled={generating || totalImages >= 5}
              placeholder={c.describePlaceholder}
              // min-w-0 overrides the browser's default intrinsic min-width
              // on text inputs (~170-200px) — without it, flex-1 can still
              // grow but can't shrink past that floor, so on a phone-width
              // screen the input refuses to compress enough to leave room
              // for the Generate button, pushing it out past the card edge.
              className={`min-w-0 flex-1 ${FIELD} disabled:opacity-60`}
            />
            <button
              type="button"
              onClick={handleGenerateReference}
              disabled={generating || totalImages >= 5}
              className="flex-shrink-0 rounded-control border border-atelier-rule px-4 py-2 text-sm text-atelier-ink transition-colors hover:border-atelier-muted hover:bg-atelier-ink/5 disabled:opacity-50"
            >
              {generating ? c.generating : c.generate}
            </button>
          </div>
            {totalImages >= 5 && (
              /* The input and button above are disabled at the 5-photo cap,
                 which used to happen with no explanation at all — the box
                 just looked broken. Reuses the same message the button
                 would have shown if it were clickable. */
              <p className="mt-1.5 text-xs text-atelier-muted">{c.maxImages}</p>
            )}
          {genError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{genError}</p>}

          {/* Perspective (2026-08-27): the one-tap reference sheet — front,
              three-quarter, profile, full-body — through the same generate
              action as the box above, one allowance unit per photo. Chips
              double as live progress during a run. */}
          <div className="mt-3 border-t border-atelier-rule/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGeneratePerspectives}
                disabled={perspective.running || generating || totalImages >= 5}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-control border border-atelier-rule px-4 py-2 text-sm text-atelier-ink transition-colors hover:border-atelier-muted hover:bg-atelier-ink/5 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 2 3 7v10l9 5 9-5V7z" />
                  <path d="M3 7l9 5 9-5M12 12v10" />
                </svg>
                {perspective.running ? c.perspectiveRunning : c.perspectiveButton}
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                {PERSPECTIVE_SHOTS.map((shot) => {
                  const label =
                    (c.perspectiveShots as Record<string, string>)[shot.id] ?? shot.id;
                  const done = perspective.done.includes(shot.id);
                  const active = perspective.current === shot.id;
                  return (
                    <span
                      key={shot.id}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        done
                          ? "bg-atelier-accent/10 text-atelier-accent"
                          : active
                            ? "animate-pulse bg-atelier-ink/10 text-atelier-ink"
                            : "text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)]"
                      }`}
                    >
                      {done ? "✓ " : ""}
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-atelier-muted">{c.perspectiveHint}</p>
          </div>

        </div>
      </section>
      </Fold>

      {/* Everything below is refinement — an outfit, traits, a voice — and
          none of it is needed to save a character for the first time. Folded
          in BOTH modes; while creating, the meta says so out loud. */}
      <Fold folded title={c.foldLookVoice} meta={initial?.id ? c.foldOpen : c.foldOptional}>
      {/* Outfit photos (2026-08-24, from the bmazloum support case): clothing
          shots finally get their own home, so product photos never end up in
          the identity slots above — where a second person's photo (or a
          flat-lay with no person at all) destroys character consistency. */}
      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.outfitSection}</h2>
        <p className="mt-1 text-sm text-atelier-muted">{c.outfitSubtitle}</p>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {keptOutfit.map((img) => (
            <div key={img.path} className="group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
              <button
                type="button"
                onClick={() => setLightboxUrl(img.url)}
                aria-label={c.viewImage}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl ?? img.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => setKeptOutfit(keptOutfit.filter((i) => i.path !== img.path))}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-atelier-rule bg-atelier-surface/95 text-xs text-atelier-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {newOutfitFiles.map((f, idx) => (
            <div key={f.preview} className="group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
              <button
                type="button"
                onClick={() => setLightboxUrl(f.preview)}
                aria-label={c.viewImage}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.preview} alt="" className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (lightboxUrl === f.preview) setLightboxUrl(null);
                  URL.revokeObjectURL(f.preview);
                  setNewOutfitFiles(newOutfitFiles.filter((_, i) => i !== idx));
                }}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-atelier-rule bg-atelier-surface/95 text-xs text-atelier-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {totalOutfitImages < 2 && (
            <button
              type="button"
              onClick={() => outfitFileInputRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-media border border-dashed border-atelier-rule text-xs text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
            >
              {c.outfitAddImage}
            </button>
          )}
        </div>
        <input
          ref={outfitFileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onOutfitFilesSelected(e.target.files)}
        />

        {/* The stored auto-description, shown so the user can see what the
            Kling-family models (which can't take a clothing photo) will be
            told. Refreshes on save whenever the photo set changes. */}
        {initial?.outfit_description && keptOutfit.length > 0 && newOutfitFiles.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-control bg-atelier-ink/[0.045] px-3 py-2.5">
            <span className="mt-0.5 flex-shrink-0 rounded-full bg-atelier-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-atelier-accent">
              {c.outfitAutoLabel}
            </span>
            <p className="min-w-0 text-xs italic text-atelier-muted">{initial.outfit_description}</p>
          </div>
        )}
      </section>

      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.fixedTraits}</h2>
        <p className="mt-1 text-sm text-atelier-muted">
          {c.fixedTraitsSubtitle}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>{c.hair}</label>
            <input
              value={hair}
              onChange={(e) => setHair(e.target.value)}
              className={`mt-1 w-full ${FIELD}`}
              placeholder={c.hairPlaceholder}
            />
          </div>
          <div>
            <label className={LABEL}>{c.outfit}</label>
            <input
              value={outfit}
              onChange={(e) => setOutfit(e.target.value)}
              className={`mt-1 w-full ${FIELD}`}
              placeholder={c.outfitPlaceholder}
            />
          </div>
          <div>
            <label className={LABEL}>{c.personality}</label>
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className={`mt-1 w-full ${FIELD}`}
              placeholder={c.personalityPlaceholder}
            />
          </div>
          <div>
            <label className={LABEL}>{c.distinguishingFeatures}</label>
            <input
              value={distinguishing}
              onChange={(e) => setDistinguishing(e.target.value)}
              className={`mt-1 w-full ${FIELD}`}
              placeholder={c.distinguishingPlaceholder}
            />
          </div>
        </div>
      </section>

      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.motionStyle}</h2>
        <input
          value={motionStyle}
          onChange={(e) => setMotionStyle(e.target.value)}
          className={`mt-4 w-full ${FIELD}`}
          placeholder={c.motionStylePlaceholder}
        />
      </section>

      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.dialogueVoice}</h2>
        <p className="mt-1 text-sm text-atelier-muted">{c.dialogueVoiceSubtitle}</p>
        {voices.length === 0 ? (
          <p className="mt-4 text-sm text-atelier-muted/80">{c.noVoicesYet}</p>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className={`w-full ${FIELD}`}
            >
              <option value="">{c.noVoice}</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.description ? ` — ${v.description}` : ""}
                </option>
              ))}
            </select>
            <VoicePreviewButton voicePresetId={voiceId} label={c.previewVoice} />
          </div>
        )}
      </section>

      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.voiceToneTags}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full border border-atelier-rule bg-atelier-paper px-3 py-1 text-xs text-atelier-ink"
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                className="text-atelier-muted hover:text-atelier-ink"
              >
                ✕
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder={c.tagPlaceholder}
            className="min-w-[140px] flex-1 rounded-control border border-atelier-rule bg-transparent px-3 py-1.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent"
          />
        </div>
      </section>
      </Fold>

      {projects.length > 0 && (
        <Fold
          folded
          title={c.foldSettings}
          meta={projects.find((pr) => pr.id === projectId)?.name ?? c.noProject}
        >
          {basicsSection}
        </Fold>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <Link href="/app/character" className="text-sm text-atelier-muted hover:text-atelier-ink">
          {c.cancel}
        </Link>
        <Button
          type="submit"
          pending={submitting}
          pendingLabel={c.saving}
          className="px-6 rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
        >
          {c.saveCharacter}
        </Button>
      </div>

    </form>

      {initial?.id && (
        <form
          action={deleteCharacterProfile}
          className="border-t border-atelier-rule/60 pt-4 text-center"
          onSubmit={(e) => {
            if (!window.confirm(formatMsg(c.deleteConfirm, { name: initial.name || "" }))) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={initial.id} />
          <button type="submit" className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
            {c.deleteCharacter}
          </button>
        </form>
      )}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
