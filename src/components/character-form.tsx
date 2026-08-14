"use client";

import { useRef, useState } from "react";
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

type ExistingImage = { path: string; url: string };

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
  errorMessage,
  projects = [],
  voices = [],
}: {
  userId: string;
  initial?: Initial & { voice_id?: string | null };
  existingImages?: ExistingImage[];
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(errorMessage ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.basics}</h2>
        <div className="mt-4">
          <label htmlFor="name" className="block text-sm text-neutral-700">
            {c.characterName}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className="mt-1 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            placeholder={c.namePlaceholder}
          />
        </div>
        <div className="mt-4">
          <label htmlFor="project" className="block text-sm text-neutral-700">
            {c.project}
          </label>
          <select
            id="project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
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

      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.referenceImages}</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {c.referenceImagesSubtitle}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {keptImages.map((img, idx) => (
            <div key={img.path} className="group relative aspect-square overflow-hidden rounded-[10px] bg-neutral-100">
              <button
                type="button"
                onClick={() => setLightboxUrl(img.url)}
                aria-label={c.viewImage}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" />
              </button>
              {idx === 0 && (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 shadow-sm">
                  {c.identityPhoto}
                </span>
              )}
              <button
                type="button"
                onClick={() => setKeptImages(keptImages.filter((i) => i.path !== img.path))}
                className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-xs text-neutral-700 opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {newFiles.map((f, idx) => (
            <div key={f.preview} className="group relative aspect-square overflow-hidden rounded-[10px] bg-neutral-100">
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
                onClick={() => setNewFiles(newFiles.filter((_, i) => i !== idx))}
                className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-xs text-neutral-700 opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          {totalImages < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-[10px] border border-dashed border-neutral-300 text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-600"
            >
              {c.addImage}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />

        <div className="mt-4 border-t border-neutral-100 pt-4">
          <p className="text-sm text-neutral-700">{c.noPhotoYet}</p>
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
              className="min-w-0 flex-1 rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:bg-neutral-50"
            />
            <button
              type="button"
              onClick={handleGenerateReference}
              disabled={generating || totalImages >= 5}
              className="flex-shrink-0 rounded-[10px] border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
            >
              {generating ? c.generating : c.generate}
            </button>
          </div>
            {totalImages >= 5 && (
              /* The input and button above are disabled at the 5-photo cap,
                 which used to happen with no explanation at all — the box
                 just looked broken. Reuses the same message the button
                 would have shown if it were clickable. */
              <p className="mt-1.5 text-xs text-neutral-400">{c.maxImages}</p>
            )}
          {genError && <p className="mt-2 text-sm text-red-600">{genError}</p>}
        </div>
      </section>

      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.fixedTraits}</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {c.fixedTraitsSubtitle}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-neutral-700">{c.hair}</label>
            <input
              value={hair}
              onChange={(e) => setHair(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              placeholder={c.hairPlaceholder}
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-700">{c.outfit}</label>
            <input
              value={outfit}
              onChange={(e) => setOutfit(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              placeholder={c.outfitPlaceholder}
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-700">{c.personality}</label>
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              placeholder={c.personalityPlaceholder}
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-700">{c.distinguishingFeatures}</label>
            <input
              value={distinguishing}
              onChange={(e) => setDistinguishing(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              placeholder={c.distinguishingPlaceholder}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.motionStyle}</h2>
        <input
          value={motionStyle}
          onChange={(e) => setMotionStyle(e.target.value)}
          className="mt-4 w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          placeholder={c.motionStylePlaceholder}
        />
      </section>

      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.dialogueVoice}</h2>
        <p className="mt-1 text-sm text-neutral-500">{c.dialogueVoiceSubtitle}</p>
        {voices.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">{c.noVoicesYet}</p>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
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

      <section className="rounded-[18px] border border-neutral-100 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-neutral-900">{c.voiceToneTags}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                className="text-neutral-400 hover:text-neutral-700"
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
            className="min-w-[140px] flex-1 rounded-[10px] border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-between">
        <Link href="/app/character" className="text-sm text-neutral-500 hover:text-neutral-700">
          {c.cancel}
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[10px] bg-neutral-900 px-6 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting ? c.saving : c.saveCharacter}
        </button>
      </div>

    </form>

      {initial?.id && (
        <form
          action={deleteCharacterProfile}
          className="border-t border-neutral-100 pt-4 text-center"
          onSubmit={(e) => {
            if (!window.confirm(formatMsg(c.deleteConfirm, { name: initial.name || "" }))) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={initial.id} />
          <button type="submit" className="text-sm text-red-500 hover:text-red-700">
            {c.deleteCharacter}
          </button>
        </form>
      )}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
