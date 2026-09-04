import Link from "next/link";
import { DeleteCharacterButton } from "@/components/delete-character-button";

// One card on the cast wall (2026-08-27 redesign, case 1): photo-first
// portrait cards — the page's first job is "these are your stars", not "here
// is a database row". The whole card opens the profile via a stretched link;
// Generate and Delete sit above it as siblings (never nested anchors).
//
// LEGIBILITY, 2026-09-04 (operator, with a screenshot: "the text is
// unreadable"). Everything here sits on a PHOTOGRAPH, so contrast is decided
// by whatever the photo happens to be doing behind each glyph — not by the
// theme. Two ways it was failing:
//
//   1. The scrim ran from-black/70 via-black/10 to-transparent. The name sits
//      about 40px up from the bottom edge, which on a 3:4 card is where that
//      gradient has already faded to roughly 10% black — so white text over a
//      bright photo (a beach, a pale sky) had almost nothing behind it. The
//      band is now opaque enough across the whole height the text occupies,
//      and every line carries a shadow as well, because a scrim tuned for an
//      average photo still loses to a specular highlight.
//   2. The two controls were bare black over the photo, which vanishes on a
//      DARK photo exactly as white text vanishes on a bright one. They now
//      carry a hairline ring, so they have an edge whatever is behind them.
//
// Extracted from the page so both extremes can actually be rendered and
// looked at — a signed-out dev machine cannot open the real wall.
export function CastCard({
  id,
  name,
  thumbnailUrl,
  photoCount,
  subtitle,
  generateLabel,
}: {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  photoCount: number;
  subtitle: string | null;
  generateLabel: string;
}) {
  return (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-[16px] border border-atelier-rule bg-atelier-ink">
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-atelier-ink to-[#3a3f4c] font-display text-5xl font-semibold text-atelier-paper/60">
          {name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/88 from-0% via-black/68 via-14% to-transparent to-46%"
      />
      <Link href={`/app/character/${id}`} aria-label={name} className="absolute inset-0 z-[1]" />
      <div className="pointer-events-none absolute inset-x-3 bottom-2.5 z-[2]">
        <p className="truncate text-sm font-semibold text-onmedia [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
          {name}
        </p>
        <span aria-hidden className="mt-1.5 flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={
                i < photoCount
                  ? "h-1 w-4 rounded-full bg-atelier-accent"
                  : "h-1 w-4 rounded-full bg-onmedia/35"
              }
            />
          ))}
        </span>
        {subtitle && (
          <p className="mt-1 truncate text-[10.5px] text-onmedia/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
            {subtitle}
          </p>
        )}
      </div>
      <Link
        href={`/app/generate?character=${encodeURIComponent(id)}`}
        className="absolute right-2 top-2 z-[2] rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-medium text-onmedia ring-1 ring-onmedia/20 backdrop-blur transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        {generateLabel}
      </Link>
      <DeleteCharacterButton
        id={id}
        name={name}
        className="absolute left-2 top-2 z-[2] h-8 w-8 rounded-full bg-black/60 text-onmedia ring-1 ring-onmedia/20 backdrop-blur"
      />
    </div>
  );
}
