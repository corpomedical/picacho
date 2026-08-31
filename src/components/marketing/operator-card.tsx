import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { ObfuscatedEmail } from "@/components/marketing/obfuscated-email";

// The LSSI-CE Art. 10 identification block, shown on the legal pages
// (2026-09-01). Data lives in legal-entity.ts; the four labels ride the
// normal i18n dictionaries so every locale reads naturally.
export function OperatorCard({
  labels,
}: {
  labels: { provider: string; nif: string; address: string; contact: string };
}) {
  return (
    <div className="mt-6 rounded-[10px] border border-neutral-200 bg-white px-4 py-3.5 text-xs leading-relaxed text-neutral-600">
      <p>
        <span className="font-semibold text-neutral-900">{labels.provider}:</span>{" "}
        {LEGAL_ENTITY.name}
      </p>
      <p>
        <span className="font-semibold text-neutral-900">{labels.nif}:</span> {LEGAL_ENTITY.nif}
      </p>
      <p>
        <span className="font-semibold text-neutral-900">{labels.address}:</span>{" "}
        {LEGAL_ENTITY.addressLines.join(", ")}
      </p>
      {LEGAL_ENTITY.registryLine && <p>{LEGAL_ENTITY.registryLine}</p>}
      <p>
        <span className="font-semibold text-neutral-900">{labels.contact}:</span>{" "}
        <ObfuscatedEmail
          user={LEGAL_ENTITY.emailUser}
          domain={LEGAL_ENTITY.emailDomain}
          className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
        />
      </p>
    </div>
  );
}
