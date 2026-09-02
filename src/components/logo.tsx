import { cn } from "@/lib/cn";

// Wordmark logo — trimmed to content with a transparent background. Most of
// the mark is near-black, but the accent line beneath it is a deliberate
// burnt-orange, not part of the "ink" color. A blanket `dark:invert` filter
// (the first attempt at this) flipped that orange to cyan along with the
// text, which is wrong — inversion can't tell "text" and "accent" apart, it
// just flips every pixel. Fixed properly instead: /logo-dark.png is a second
// export with only the near-black pixels recolored to white (orange pixels
// copied through untouched, same alpha/anti-aliasing), and we swap which
// image is visible with the same class-based dark mode the rest of the app
// uses. Sized by height; width scales automatically via the image's own
// aspect ratio (source is 1942x595, ~3.26:1) so callers just pick an h-*
// class — applied to both images identically so the swap is invisible.
export function Logo({ className, forceDark }: { className?: string; forceDark?: boolean }) {
  // forceDark: the dark front page always sits on near-black regardless of
  // the site theme, so it always needs the white-text export.
  if (forceDark) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/logo-dark.png" alt="Picacho" className={cn("w-auto", className)} />
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Picacho" className={cn("w-auto dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-dark.png"
        alt="Picacho"
        className={cn("hidden w-auto dark:block", className)}
      />
    </>
  );
}
