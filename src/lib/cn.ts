// Plain string-join — this does NOT resolve conflicting utility classes the
// way a Tailwind-aware merge (e.g. `tailwind-merge`) would. If two classes
// in the same call target the same CSS property at the same breakpoint
// (e.g. an unconditional "md:w-64" alongside a conditionally-added
// "md:w-14"), the one that wins is whichever Tailwind happens to place
// later in its generated stylesheet — NOT whichever argument comes last
// here. This has already caused one real bug (the sidebar collapse toggle
// silently failing to shrink because "md:w-64" was unconditional while
// "md:w-14" was conditional).
//
// Rule when writing a conditional className with cn(): if a property can
// vary (width, height, padding, translate, inset, z-index, grid-cols,
// display, position...), put ALL of its variants inside the SAME
// ternary/branch so only one ever appears in the output — never split one
// branch unconditionally and the other conditionally. After any such change,
// verify by actually rendering both states, not just by reading the classes.
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
