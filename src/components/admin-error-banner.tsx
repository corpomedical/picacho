// Admin server actions are wired to plain <form action={...}> elements
// with no client-side result handling — on failure they redirect back to
// the same page with ?error=..., and each admin page renders this at the
// top so the failure is actually visible instead of only landing in a
// server log nobody's watching.
export function AdminErrorBanner({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="mb-6 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error}
    </div>
  );
}
