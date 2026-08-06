"use client";

import { useState } from "react";
import { updateEmail } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

export function EmailForm({ initialEmail }: { initialEmail: string }) {
  const { t } = useLocale();
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");

    const formData = new FormData();
    formData.set("email", email);
    const result = await updateEmail(formData);

    if (result.error !== null) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
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
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        {status === "saved" && (
          <p className="mt-1.5 text-xs text-neutral-500">
            {t.settings.emailChangeNote}
          </p>
        )}
      </div>
      <Button type="submit" variant="secondary" disabled={status === "saving" || email === initialEmail}>
        {status === "saving" ? t.common.saving : t.common.save}
      </Button>
    </form>
  );
}
