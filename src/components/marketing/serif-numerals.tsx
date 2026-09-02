import { cn } from "@/lib/cn";

// The Ticket Wall's typographic rule (board B, 2026-09-02): inside sans
// prose, every numeral wears the Iowan serif — the same proof idiom as the
// scores and prices. Splitting on digit-runs keeps this locale-safe: the
// i18n strings stay whole, and whatever numbers they carry get dressed at
// render time.
export function SerifNumerals({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split(/(\d[\d,.]*%?)/g).map((part, i) =>
        /^\d/.test(part) ? (
          <span key={i} className={cn("font-numeral tabular-nums", className)}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
