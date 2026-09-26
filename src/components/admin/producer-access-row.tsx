import { setProducerAccess } from "@/lib/admin/actions";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ProducerAccessState } from "@/lib/producer/enabled";

// The admin user page's "Assistant" row (2026-09-26, operator: "Give me an
// option to grant users access to The assistant in the admin area"): who has
// the Producer and why, and the grant itself. The rule it reports is
// lib/producer/enabled.ts producerAllowed; the grant is
// profiles.producer_access (supabase/applied/2026-09-26/producer-access.sql). Why an
// account has it (or not) is producerAccessState, next to that rule.

const LABELS: Record<ProducerAccessState, { label: string; tone: "success" | "neutral" }> = {
  suspended: { label: "off — suspended", tone: "neutral" },
  admin: { label: "always (admin)", tone: "success" },
  granted: { label: "granted", tone: "success" },
  elite: { label: "included with Elite", tone: "success" },
  "elite-closed": { label: "off — Elite not open", tone: "neutral" },
  off: { label: "off", tone: "neutral" },
};

export function ProducerAccessRow({
  userId,
  state,
  granted,
  grantReady,
  producerOn,
  eliteUnits,
  eliteUnitsUsd,
}: {
  userId: string;
  state: ProducerAccessState;
  /** profiles.producer_access as stored (a grant can sit on an admin or a suspended account). */
  granted: boolean;
  /** Whether producer-access.sql has run (the row carries the column). */
  grantReady: boolean;
  /** feature_flags.producer, with the key and the environment switch. */
  producerOn: boolean;
  eliteUnits: number;
  eliteUnitsUsd: number;
}) {
  const { label, tone } = LABELS[state];
  // An admin has it anyway: the button shows only to take back a grant left
  // on an account that later became an admin.
  const button = state !== "admin" || granted;
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Assistant (Aly)</p>
      {grantReady && button ? (
        <form action={setProducerAccess} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="producer_access" value={String(!granted)} />
          <Badge tone={tone}>{label}</Badge>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Updating…" className="shrink-0 whitespace-nowrap">
            {granted ? "Revoke grant" : "Grant access"}
          </SubmitButton>
        </form>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
        </div>
      )}
      <p className="mt-1.5 text-xs text-neutral-400">
        {grantReady
          ? state === "admin"
            ? "Admins always have it."
            : `For anyone the Elite rule doesn't cover: a pilot, a partner, another plan, or Elite before Aly opens to Elite. They get the lamp on every page and Elite's allowance: ${eliteUnits.toLocaleString("en-US")} units a month, at most $${eliteUnitsUsd.toFixed(0)} of turns. Revoking stops it at once: it refuses their next message and takes its lamp away (or the lamp goes on their next full page load). Their conversation and notes stay.`
          : "Granting needs supabase/applied/2026-09-26/producer-access.sql. Run it in Supabase, then reload this page."}
      </p>
      {!producerOn && (
        <p className="mt-1 text-xs text-amber-600">
          Aly is switched off for everyone right now (Flags: producer), granted or not.
        </p>
      )}
    </div>
  );
}
