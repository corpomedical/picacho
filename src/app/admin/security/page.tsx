import { AdminMfaCard } from "@/components/admin-mfa-card";

// Admin → Security (2026-09-05 flaw hunt): the enrollment home for the admin
// second factor. The /admin layout starts gating a session the moment its
// account has a VERIFIED factor, so this page is the switch that turns the
// gate on — and the place to turn it off again (unenroll) if the phone is
// lost while still signed in.
export default function AdminSecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-atelier-ink">Security</h1>
        <p className="mt-1 text-sm text-atelier-muted">
          Two-step verification for admin accounts. One password guards credits, plans, refunds, mass
          email, and every customer&apos;s data — this adds the second lock.
        </p>
      </div>
      <AdminMfaCard />
    </div>
  );
}
