import { cn } from "@/lib/cn";

// Wordmark logo (/public/logo.png) — trimmed to content with a transparent
// background so it drops cleanly onto any light surface. Sized by height;
// width is left to scale automatically via the image's own aspect ratio
// (source is 1942x595, ~3.26:1) so callers just pick an h-* class.
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Picacho"
      className={cn("w-auto", className)}
    />
  );
}
