"use client";

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
const LABEL = "block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

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
}: {
  userId: string;
  initial?: Initial & { voice_id?: string | null; outfit_description?: string | null };
  existingImages?: ExistingImage[];
  existingOutfitImages?: ExistingImage[];
  errorMessage?: string;
  projects?: ProjectOption[];
  voices?: VoiceOption[];
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

  const totalImages = keptImages.length + newFiles.length;

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

    setKeptImages((prev) => [...prev, { path: result.path, url: result.url }]);
    setGenPrompt("");
    setGenerating(false);
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.basics}</h2>
        <div className="mt-4">
          <label htmlFor="name" className={LABEL}>
            {c.characterName}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className={`mt-1 w-full ${FIELD}`}
            placeholder={c.namePlaceholder}
          />
        </div>
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

      <section className={SHEET}>
        <h2 className={SHEET_TITLE}>{c.referenceImages}</h2>
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
                className="absolute right-1 top-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 text-xs text-atelier-ink opacity-0 group-hover:opacity-100"
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
                className="absolute right-1 top-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 text-xs text-atelier-ink opacity-0 group-hover:opacity-100"
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
        {totalImages > 0 && (
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
              {totalImages <= 1 ? c.lockTipOne : totalImages <= 3 ? c.lockTipFew : c.lockTipMax}
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
        </div>
      </section>

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
                className="absolute right-1 top-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 text-xs text-atelier-ink opacity-0 group-hover:opacity-100"
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
                className="absolute right-1 top-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 text-xs text-atelier-ink opacity-0 group-hover:opacity-100"
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
