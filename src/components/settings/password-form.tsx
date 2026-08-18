"use client";

import { useState } from "react";
import { updatePassword } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

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
        <Label htmlFor="current_password">{t.settings.currentPasswordLabel}</Label>
        <Input
          id="current_password"
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
        <Label htmlFor="password">{t.settings.newPasswordLabel}</Label>
        <Input
          id="password"
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
        <Label htmlFor="confirm_password">{t.settings.confirmNewPasswordLabel}</Label>
        <Input
          id="confirm_password"
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setStatus("idle");
          }}
          minLength={8}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {status === "saved" && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t.settings.passwordUpdated}</p>}
      <Button
        type="submit"
        variant="secondary"
        disabled={!password || !confirmPassword}
        pending={status === "saving"}
        pendingLabel={t.common.saving}
      >
        {t.settings.updatePassword}
      </Button>
    </form>
  );
}
