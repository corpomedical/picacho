"use client";

import { useState } from "react";
import { updateEmail } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

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
        <Label htmlFor="email">{t.settings.emailLabel}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setStatus("idle");
          }}
        />
        {dirty && (
          <div className="mt-2">
            <Label htmlFor="email_current_password">{t.settings.currentPasswordLabel}</Label>
            <Input
              id="email_current_password"
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
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        {status === "saved" && (
          <p className="mt-1.5 text-xs text-neutral-500">
            {t.settings.emailChangeNote}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={!dirty}
        pending={status === "saving"}
        pendingLabel={t.common.saving}
      >
        {t.common.save}
      </Button>
    </form>
  );
}
