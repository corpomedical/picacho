import { cn } from "@/lib/cn";

// Wordmark logo (/public/logo.png) — trimmed to content with a transparent
// background, drawn in a single near-black color. That made it disappear on
// dark surfaces (a real user report — the site follows the OS dark-mode
// setting by default, so a phone with system dark mode on shows a dark
// background here with no manual toggle involved). Since the mark is
// effectively monochrome, `dark:invert` flips near-black to near-white
// without needing a second logo asset — cheaper than exporting/maintaining
// a separate white PNG, and the transparent background is unaffected by the
// invert filter. Sized by height; width is left to scale automatically via
// the image's own aspect ratio (source is 1942x595, ~3.26:1) so callers just
// pick an h-* class.
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Picacho"
      className={cn("w-auto dark:invert", className)}
    />
  );
}
