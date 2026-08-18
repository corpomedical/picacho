"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePasswordFromRecovery } from "@/lib/profile/actions";
import { useLocale } from "@/lib/i18n/provider";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

// Reached only via the recovery link from /forgot-password — by the time
// this renders, /auth/callback has already exchanged the code for a
// (recovery) session. Uses updatePasswordFromRecovery, NOT the Settings
// updatePassword: this flow's whole premise is that the person doesn't know
// their current password, so it's the one entry point allowed to skip the
// current-password check (the emailed link already proved inbox control).
// Success sends the person straight into the app instead of showing yet
// another "log in" screen.
export function ResetPasswordForm() {
  const { t } = useLocale();
  const r = t.auth.resetPassword;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(r.mismatch);
      return;
    }

    setStatus("saving");
    const formData = new FormData();
    formData.set("password", password);
    formData.set("confirm_password", confirmPassword);
    const result = await updatePasswordFromRecovery(formData);

    if (result.error !== null) {
      setError(result.error);
      setStatus("idle");
      return;
    }

    setStatus("saved");
    setTimeout(() => router.push("/app"), 1200);
  }

  if (status === "saved") {
    return <p className="text-sm text-emerald-600 dark:text-emerald-400">{r.success}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="password">{r.newPasswordLabel}</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="confirm_password">{r.confirmPasswordLabel}</Label>
        <Input
          id="confirm_password"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" pending={status === "saving"} pendingLabel={r.submit}>
        {r.submit}
      </Button>
    </form>
  );
}
