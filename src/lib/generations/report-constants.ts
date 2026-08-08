// Split out from reports.ts on purpose: that file is "use server", and
// Next.js only allows a "use server" file to export async functions —
// exporting this const array from there broke the whole module the moment a
// client component (result-actions.tsx) imported it ("A 'use server' file
// can only export async functions, found object."). Everything that needs
// the reason list — the server actions in reports.ts and the client-side
// report popover — imports it from here instead.
export const REPORT_REASONS = [
  "wrong_result",
  "inappropriate",
  "technical_error",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
