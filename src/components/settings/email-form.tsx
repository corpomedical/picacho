"use client";

import { useState } from "react";
import { updateEmail } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Atelier form idiom (settings-popover, extended): caps label over an
// ink-hairline input at the control radius; accent only marks focus.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";

export function EmailForm({ initialEmail }: { initialEmail: string }) {
  const { t } = useLocale();
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  // The password field only appears once the address has actually been
  // edited — the common case (glancing at your settings) shouldn't show a
  // password challenge for a change nobody is making.
  const dirty = email !== initialEmail;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");

    const formData = new FormData();
    formData.set("email", email);
    // Re-authentication for a sensitive change — verified server-side in
    // updateEmail (lib/profile/actions.ts). OAuth-only accounts can leave it
    // empty; the server skips the check for them.
    formData.set("current_password", currentPassword);
    const result = await updateEmail(formData);

    if (result.error !== null) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
    setCurrentPassword("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor="email" className={LABEL}>{t.settings.emailLabel}</label>
        <input
          id="email"
          className={FIELD}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setStatus("idle");
          }}
        />
        {dirty && (
          <div className="mt-2">
            <label htmlFor="email_current_password" className={LABEL}>{t.settings.currentPasswordLabel}</label>
            <input
              id="email_current_password"
              className={FIELD}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setStatus("idle");
              }}
            />
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {status === "saved" && (
          <p className="mt-1.5 text-xs text-atelier-muted">
            {t.settings.emailChangeNote}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="secondary"
        className="rounded-control! border-atelier-rule! bg-transparent! text-atelier-ink! hover:border-atelier-muted! hover:bg-atelier-ink/5!"
        disabled={!dirty}
        pending={status === "saving"}
        pendingLabel={t.common.saving}
      >
        {t.common.save}
      </Button>
    </form>
  );
}
