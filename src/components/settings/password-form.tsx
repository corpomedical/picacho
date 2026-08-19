"use client";

import { useState } from "react";
import { updatePassword } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Atelier form idiom (settings-popover, extended): caps label over an
// ink-hairline input at the control radius; accent only marks focus.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

export function PasswordForm() {
  const { t } = useLocale();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");

    const formData = new FormData();
    // Re-authentication for a sensitive change — the server verifies this
    // against the account's real password (see updatePassword in
    // lib/profile/actions.ts). OAuth-only accounts can leave it empty; the
    // server skips the check for them.
    formData.set("current_password", currentPassword);
    formData.set("password", password);
    formData.set("confirm_password", confirmPassword);
    const result = await updatePassword(formData);

    if (result.error !== null) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="current_password" className={LABEL}>{t.settings.currentPasswordLabel}</label>
        <input
          id="current_password"
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
      <div>
        <label htmlFor="password" className={LABEL}>{t.settings.newPasswordLabel}</label>
        <input
          id="password"
          className={FIELD}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setStatus("idle");
          }}
          minLength={8}
          placeholder={t.settings.passwordMinChars}
        />
      </div>
      <div>
        <label htmlFor="confirm_password" className={LABEL}>{t.settings.confirmNewPasswordLabel}</label>
        <input
          id="confirm_password"
          className={FIELD}
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setStatus("idle");
          }}
          minLength={8}
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {status === "saved" && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t.settings.passwordUpdated}</p>}
      <Button
        type="submit"
        variant="secondary"
        className="rounded-control! border-atelier-rule! bg-transparent! text-atelier-ink! hover:border-atelier-muted! hover:bg-atelier-ink/5!"
        disabled={!password || !confirmPassword}
        pending={status === "saving"}
        pendingLabel={t.common.saving}
      >
        {t.settings.updatePassword}
      </Button>
    </form>
  );
}
