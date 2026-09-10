"use client";

import { useState } from "react";
import { deleteAccount } from "@/lib/profile/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { useLocale } from "@/lib/i18n/provider";

// Ink-hairline input at the control radius (atelier form idiom). The label
// here stays sentence-case rather than the caps treatment: it's a full
// sentence with the username embedded, not a short field name.
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";

export function DeleteAccountForm({ confirmWith }: { confirmWith: string }) {
  const { t } = useLocale();
  const [confirmText, setConfirmText] = useState("");
  // confirmWith is the account's real username or, where none exists, the
  // full email address — the same derivation deleteAccount checks, so the
  // page can never ask for a string the server will refuse. An empty
  // confirmWith can never delete.
  const canDelete = confirmWith.length > 0 && confirmText.trim().toLowerCase() === confirmWith.toLowerCase();

  return (
    <form action={deleteAccount} className="space-y-3">
      <p className="text-sm text-atelier-muted">
        {t.settings.deleteWarning}
      </p>
      <div>
        <label htmlFor="confirm_delete" className="mb-1.5 block text-[13px] text-atelier-muted">
          {t.settings.typeToConfirm.split("{username}")[0]}
          <span className="font-semibold text-atelier-ink">{confirmWith}</span>
          {t.settings.typeToConfirm.split("{username}")[1]}
        </label>
        <input
          id="confirm_delete"
          // name= was missing, so the typed confirmation was never submitted
          // and the entire gate was `disabled` on the button below — a state
          // no server has ever seen. deleteAccount now re-checks this value.
          name="confirm_delete"
          className={FIELD}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
      </div>
      <SubmitButton variant="destructive" disabled={!canDelete}>
        {t.settings.deleteMyAccount}
      </SubmitButton>
    </form>
  );
}
