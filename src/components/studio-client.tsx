"use client";

import Link from "next/link";
import { useState } from "react";
import { runGeneration } from "@/lib/generations/actions";
import { STUDIO_RECIPES, STUDIO_VARIATIONS, getStudioRecipe } from "@/lib/studio/recipes";
import type { ProductRecord } from "@/lib/products/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";

// The Studio floor: three decisions (product → shot → star), then a
// contact sheet of four. Every cell is an ordinary runGeneration image
// send — the recipe prompt plus the product photo (or logo) riding the
// neutral reference lane — so credits, allowance, refunds, History and
// identity scoring are all the same machinery the composer uses. The run
// is sequential and stops on the first error, keeping finished takes
// (each one is already a real render in History whatever happens next).

type StudioCharacter = {
  id: string;
  name: string;
  photoUrl: string | null;
  hasPhoto: boolean;
};

type Cell =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; url: string; score: number | null }
  | { state: "failed"; message: string };

export function StudioClient({
  products,
  characters,
}: {
  products: ProductRecord[];
  characters: StudioCharacter[];
}) {
  const { t } = useLocale();
  const s = t.studio;
  const [productId, setProductId] = useState<string | null>(products[0]?.id ?? null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string>("");
  const [cells, setCells] = useState<Cell[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const product = products.find((p) => p.id === productId) ?? null;
  const recipe = recipeId ? getStudioRecipe(recipeId) : null;
  const eligibleCharacters = characters.filter((c) => c.hasPhoto);
  const needsLogo = recipe?.reference === "logo";
  const referenceUrl = !product ? null : needsLogo ? (product.logo?.url ?? null) : (product.images[0]?.url ?? null);
  const characterMissing = Boolean(recipe?.needsCharacter) && !characterId;
  const ready = Boolean(product && recipe && referenceUrl && !characterMissing && !running);

  async function generateSheet() {
    if (!product || !recipe || !referenceUrl) return;
    setError("");
    setRunning(true);
    setCells(STUDIO_VARIATIONS.map(() => ({ state: "idle" }) as Cell));

    for (let i = 0; i < STUDIO_VARIATIONS.length; i++) {
      setCells((prev) => prev.map((c, j) => (j === i ? { state: "running" } : c)));

      const formData = new FormData();
      formData.set("generation_id", crypto.randomUUID());
      formData.set("prompt", recipe.prompt(product.name) + STUDIO_VARIATIONS[i]);
      formData.set("character_id", recipe.needsCharacter ? characterId : "");
      formData.set("content_type", "image");
      formData.set("attachment_roles", JSON.stringify([{ url: referenceUrl, role: "reference" }]));
      formData.set("payload_version", "2");
      formData.set("use_outfit", "0");

      let result;
      try {
        result = await runGeneration(formData);
      } catch (err) {
        console.error("studio runGeneration failed:", err);
        setCells((prev) => prev.map((c, j) => (j === i ? { state: "failed", message: s.connectionError } : c)));
        setError(s.connectionError);
        setRunning(false);
        return;
      }

      if (result.error !== null) {
        setCells((prev) => prev.map((c, j) => (j === i ? { state: "failed", message: result.error! } : c)));
        setError(result.error);
        setRunning(false);
        return;
      }
      if (!result.succeeded || !result.resultUrl) {
        const message = s.takeFailed;
        setCells((prev) => prev.map((c, j) => (j === i ? { state: "failed", message } : c)));
        continue;
      }
      const url = result.resultUrl;
      const score = result.matchScore ?? null;
      setCells((prev) => prev.map((c, j) => (j === i ? { state: "done", url, score } : c)));
    }
    setRunning(false);
  }

  return (
    <div className="space-y-8">
      {/* Step 1 — product */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
          1 · {s.stepProduct}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProductId(p.id)}
              aria-pressed={p.id === productId}
              className={cn(
                "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm transition-colors",
                p.id === productId
                  ? "bg-atelier-accent/10 font-medium text-atelier-accent"
                  : "text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] hover:text-atelier-ink",
              )}
            >
              <span className="block h-7 w-7 overflow-hidden rounded-full bg-atelier-ink/5">
                {p.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0].url} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              {p.name}
            </button>
          ))}
          <Link
            href="/app/products"
            className="rounded-full px-3.5 py-1.5 text-sm text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] transition-colors hover:text-atelier-ink"
          >
            {products.length === 0 ? `+ ${s.firstProductCta}` : s.manageProducts}
          </Link>
        </div>
      </section>

      {/* Step 2 — shot recipe */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
          2 · {s.stepShot}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STUDIO_RECIPES.map((r) => {
            const label = (s.recipes as Record<string, string>)[r.id] ?? r.id;
            const sub = (s.recipeSubs as Record<string, string>)[r.id] ?? "";
            const selected = r.id === recipeId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRecipeId(selected ? null : r.id)}
                aria-pressed={selected}
                className={cn(
                  "overflow-hidden rounded-control border text-left transition-shadow",
                  selected
                    ? "border-transparent shadow-[0_0_0_2px_var(--color-atelier-accent)]"
                    : "border-atelier-rule hover:border-atelier-muted/60",
                )}
              >
                <span className="block aspect-[16/10] w-full overflow-hidden bg-atelier-ink/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/studio/${r.id}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" />
                </span>
                <span className="block px-3 py-2">
                  <span className="block text-xs font-semibold text-atelier-ink">{label}</span>
                  <span className="block text-[10.5px] text-atelier-muted">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        {needsLogo && product && !product.logo && (
          <p className="mt-2 text-xs text-atelier-muted">
            {formatMsg(s.needsLogoHint, { name: product.name })}{" "}
            <Link href="/app/products" className="underline underline-offset-2">
              {s.manageProducts}
            </Link>
          </p>
        )}
      </section>

      {/* Step 3 — star + generate */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
          3 · {s.stepStar}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {recipe && !recipe.needsCharacter ? (
            <span className="rounded-full bg-atelier-ink/5 px-3.5 py-1.5 text-sm text-atelier-muted">
              {s.productOnly}
            </span>
          ) : (
            <>
              {eligibleCharacters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCharacterId(c.id === characterId ? "" : c.id)}
                  aria-pressed={c.id === characterId}
                  className={cn(
                    "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm transition-colors",
                    c.id === characterId
                      ? "bg-atelier-accent/10 font-medium text-atelier-accent"
                      : "text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] hover:text-atelier-ink",
                  )}
                >
                  <span className="block h-7 w-7 overflow-hidden rounded-full bg-atelier-ink/5">
                    {c.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photoUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  {c.name}
                </button>
              ))}
              {eligibleCharacters.length === 0 && (
                <span className="text-sm text-atelier-muted">{s.noCharacters}</span>
              )}
            </>
          )}
          <button
            type="button"
            onClick={generateSheet}
            disabled={!ready}
            className="ml-auto rounded-full bg-atelier-ink px-6 py-2.5 text-sm font-semibold text-atelier-paper transition-opacity disabled:opacity-40"
          >
            {running ? s.generating : s.generateSheet}
          </button>
        </div>
      </section>

      {/* Contact sheet */}
      {cells.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
              {s.contactSheet}
            </h2>
            <span className="font-numeral text-[11px] tabular-nums text-atelier-muted">{s.sheetCost}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cells.map((cell, i) => (
              <div
                key={i}
                className="relative aspect-square overflow-hidden rounded-control border border-atelier-rule bg-atelier-ink/5"
              >
                {cell.state === "running" && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-atelier-muted/40 border-t-atelier-accent" />
                  </span>
                )}
                {cell.state === "done" && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cell.url} alt="" className="h-full w-full object-cover" />
                    {cell.score !== null && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-2 py-0.5 font-numeral text-[10.5px] tabular-nums text-white">
                        {cell.score}%
                      </span>
                    )}
                  </>
                )}
                {cell.state === "failed" && (
                  <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-[11px] text-atelier-muted">
                    {cell.message}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-atelier-muted">{s.sheetNote}</p>
        </section>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
