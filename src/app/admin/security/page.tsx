import { AdminMfaCard } from "@/components/admin-mfa-card";
import { HowItWorks } from "@/components/admin/how-it-works";

// Admin → Security (2026-09-05 flaw hunt): the enrollment home for the admin
// second factor. The /admin layout starts gating a session the moment its
// account has a VERIFIED factor, so this page is the switch that turns the
// gate on — and the place to turn it off again (unenroll) if the phone is
// lost while still signed in.
export default function AdminSecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Admin</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Security</h1>
        <p className="mt-1 text-sm text-atelier-muted">Two-step verification for admin accounts.</p>
        <HowItWorks>
          One password guards credits, plans, refunds, mass email, and every customer&apos;s data. This adds the
          second lock.
        </HowItWorks>
      </div>
      <AdminMfaCard />
    </div>
  );
}
