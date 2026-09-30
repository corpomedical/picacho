// A timed part of a server render says how long its steps took, where it renders (lib/server-timing.ts):
// an inert <template>, nothing shown, step names and milliseconds only.
export function ServerTimingMark({ value }: { value: string }) {
  return <template data-server-timing={value} />;
}
