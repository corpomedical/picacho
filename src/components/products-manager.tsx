"use client";

import { useRef, useState } from "react";
import { saveProduct, deleteProduct, type ProductRecord } from "@/lib/products/actions";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// Client half of the Products library: card grid + one inline editor. The
// editor is deliberately small — name, up to 3 photos, optional logo —
// because a product's real life happens in the Studio, not here.

const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-6";
const FIELD =
  "rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

type Draft = {
  id: string | null;
  name: string;
  kept: { path: string; url: string }[];
  newFiles: { file: File; preview: string }[];
  keptLogo: { path: string; url: string } | null;
  newLogo: { file: File; preview: string } | null;
};

const EMPTY: Draft = { id: null, name: "", kept: [], newFiles: [], keptLogo: null, newLogo: null };

export function ProductsManager({ initial }: { initial: ProductRecord[] }) {
  const { t } = useLocale();
  const s = t.studio;
  const [products, setProducts] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(initial.length === 0 ? { ...EMPTY } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function openEditor(p?: ProductRecord) {
    setError("");
    setDraft(
      p
        ? { id: p.id, name: p.name, kept: [...p.images], newFiles: [], keptLogo: p.logo, newLogo: null }
        : { ...EMPTY },
    );
  }

  async function handleSave() {
    if (!draft) return;
    setError("");
    setSaving(true);
    const formData = new FormData();
    if (draft.id) formData.set("id", draft.id);
    formData.set("name", draft.name);
    formData.set("kept_paths", JSON.stringify(draft.kept.map((k) => k.path)));
    if (draft.keptLogo) formData.set("kept_logo_path", draft.keptLogo.path);
    for (const f of draft.newFiles) formData.append("images", f.file);
    if (draft.newLogo) formData.set("logo", draft.newLogo.file);

    let result;
    try {
      result = await saveProduct(formData);
    } catch (err) {
      console.error("saveProduct request failed:", err);
      setError(s.connectionError);
      setSaving(false);
      return;
    }
    setSaving(false);
    if (result.error !== null || !result.product) {
      setError(result.error ?? s.connectionError);
      return;
    }
    const saved = result.product;
    setProducts((prev) => {
      const rest = prev.filter((p) => p.id !== saved.id);
      return [saved, ...rest];
    });
    setDraft(null);
  }

  async function handleDelete(id: string) {
    setError("");
    const formData = new FormData();
    formData.set("id", id);
    const result = await deleteProduct(formData);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
    if (draft?.id === id) setDraft(null);
  }

  const totalPhotos = draft ? draft.kept.length + draft.newFiles.length : 0;

  return (
    <div className="space-y-6">
      {error && !draft && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <div key={p.id} className="group overflow-hidden rounded-control border border-atelier-rule bg-atelier-surface">
            <button type="button" onClick={() => openEditor(p)} className="block w-full text-left">
              <span className="block aspect-square w-full overflow-hidden bg-atelier-ink/5">
                {p.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0].url} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
              </span>
              <span className="block px-3 py-2.5">
                <span className="block truncate text-sm font-semibold text-atelier-ink">{p.name}</span>
                <span className="block text-[11px] text-atelier-muted">
                  {p.images.length} {s.photosWord}
                  {p.logo ? ` · ${s.logoWord}` : ""}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleDelete(p.id)}
              className="w-full border-t border-atelier-rule/60 px-3 py-1.5 text-left text-[11px] text-atelier-muted transition-colors hover:text-red-600 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            >
              {s.deleteProduct}
            </button>
          </div>
        ))}
        {!draft && (
          <button
            type="button"
            onClick={() => openEditor()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed border-atelier-rule text-sm text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
          >
            + {s.addProduct}
          </button>
        )}
      </div>

      {draft && (
        <div className={SHEET}>
          <h2 className="text-sm font-semibold text-atelier-ink">
            {draft.id ? s.editProduct : s.addProduct}
          </h2>
          <div className="mt-4 space-y-4">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={s.namePlaceholder}
              maxLength={80}
              className={`w-full ${FIELD}`}
            />

            <div>
              <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                {s.photosLabel}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {draft.kept.map((img) => (
                  <div key={img.path} className="group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, kept: draft.kept.filter((k) => k.path !== img.path) })}
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {draft.newFiles.map((f, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.preview} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, newFiles: draft.newFiles.filter((_, j) => j !== i) })}
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {totalPhotos < 3 && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center rounded-media border-2 border-dashed border-atelier-rule text-xs text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink"
                  >
                    + {s.addPhoto}
                  </button>
                )}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []).slice(0, 3 - totalPhotos);
                  setDraft({
                    ...draft,
                    newFiles: [
                      ...draft.newFiles,
                      ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
                    ],
                  });
                  e.target.value = "";
                }}
              />
            </div>

            <div>
              <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                {s.logoLabel}
              </p>
              <div className="mt-2 flex items-center gap-3">
                {(draft.newLogo || draft.keptLogo) && (
                  <span className="relative block h-14 w-14 overflow-hidden rounded-media border border-atelier-rule bg-white p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={draft.newLogo?.preview ?? draft.keptLogo!.url}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, keptLogo: null, newLogo: null })}
                      className="absolute right-0 top-0 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="rounded-control border border-atelier-rule px-3 py-1.5 text-xs text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink"
                >
                  {draft.newLogo || draft.keptLogo ? s.replaceLogo : s.addLogo}
                </button>
                <span className="text-[11px] text-atelier-muted">{s.logoHint}</span>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setDraft({ ...draft, newLogo: { file, preview: URL.createObjectURL(file) }, keptLogo: null });
                  }
                  e.target.value = "";
                }}
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(
                  "rounded-control bg-atelier-ink px-5 py-2 text-sm font-medium text-atelier-paper transition-opacity disabled:opacity-50",
                )}
              >
                {saving ? s.saving : s.saveProduct}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="text-sm text-atelier-muted hover:text-atelier-ink"
              >
                {s.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
