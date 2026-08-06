"use client";

import { useState } from "react";
import { updateUsername } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

export function UsernameForm({ initialUsername }: { initialUsername: string }) {
  const { t } = useLocale();
  const [username, setUsername] = useState(initialUsername);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");

    const formData = new FormData();
    formData.set("username", username);
    const result = await updateUsername(formData);

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
        <Label htmlFor="username">{t.settings.usernameLabel}</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setStatus("idle");
          }}
          maxLength={24}
        />
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
      <Button type="submit" variant="secondary" disabled={status === "saving" || username === initialUsername}>
        {status === "saving" ? t.common.saving : status === "saved" ? t.common.saved : t.common.save}
      </Button>
    </form>
  );
}
