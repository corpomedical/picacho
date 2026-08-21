"use client";

// The US-only "buy on our website" handoff (see lib/native/external-purchase
// for the policy story). window.open on a host OUTSIDE allowNavigation makes
// Capacitor kick the URL to the system browser — the purchase happens on the
// website, in the user's real browser, never inside the app's frame.
export function ExternalCheckoutButton({
  url,
  label,
  note,
}: {
  url: string;
  label: string;
  note: string;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => window.open(url, "_blank")}
        className="w-full rounded-control bg-atelier-ink px-4 py-2.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90"
      >
        {label}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-atelier-muted">{note}</p>
    </div>
  );
}
