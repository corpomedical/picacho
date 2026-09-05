import Link from "next/link";
import { CARD_SHEET } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getServerMessages } from "@/lib/i18n/server";
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/templates";

// The template library — curated scenes that hand off to the composer with
// the prompt prefilled (review-and-edit, never auto-send). Content lives in
// src/lib/templates.ts; this page is just the shelf it sits on.

function TypeBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-atelier-ink/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-atelier-muted">
      {label}
    </span>
  );
}

export default async function TemplatesPage() {
  const { t } = await getServerMessages();
  const tp = t.templates;

  const categoryLabels: Record<TemplateCategory, string> = {
    portrait: tp.catPortrait,
    product: tp.catProduct,
    social: tp.catSocial,
    marketing: tp.catMarketing,
    story: tp.catStory,
  };

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {tp.eyebrow}
      </p>
      <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
        {tp.title}
      </h1>
      <p className="mt-1 text-sm text-atelier-muted">{tp.subtitle}</p>

      {TEMPLATE_CATEGORIES.map((category) => {
        const inCategory = TEMPLATES.filter((tpl) => tpl.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} className="mt-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
              {categoryLabels[category]}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inCategory.map((tpl) => (
                <Link
                  key={tpl.id}
                  href={`/app/generate?prompt=${encodeURIComponent(tpl.prompt)}&type=${tpl.contentType}`}
                  className={cn(
                    CARD_SHEET,
                    "group flex flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-atelier-muted/50 hover:shadow-[0_1px_2px_rgba(33,29,22,0.05),0_20px_48px_-20px_rgba(33,29,22,0.2)]",
                  )}
                >
                  {/* Sample render (2026-08-26): a real generation of this
                      exact template prompt with the brand character — same
                      proof-not-promise rule as the composer's cinema
                      presets. Files in public/templates/<id>.jpg. */}
                  <span className="block aspect-video w-full overflow-hidden bg-atelier-ink/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/templates/${tpl.id}.jpg`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-atelier-ink">{tpl.title}</h3>
                    <TypeBadge label={tpl.contentType === "video" ? t.generate.video : t.generate.image} />
                  </div>
                  <p className="mt-1 text-xs text-atelier-muted">{tpl.description}</p>
                  <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-atelier-muted/80">
                    {tpl.prompt}
                  </p>
                  <span className="mt-3 text-xs font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2 group-hover:decoration-atelier-accent">
                    {tp.use}
                  </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <p className="mt-8 text-[11px] text-atelier-muted/80">{tp.promptNote}</p>
    </div>
  );
}
