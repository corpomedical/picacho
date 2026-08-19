"use client";

import { useState } from "react";
import { updateUsername } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Atelier form idiom (settings-popover, extended): caps label over an
// ink-hairline input at the control radius; accent only marks focus.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

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
        <label htmlFor="username" className={LABEL}>{t.settings.usernameLabel}</label>
        <input
          id="username"
          className={FIELD}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setStatus("idle");
          }}
          maxLength={24}
        />
        {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <Button
        type="submit"
        variant="secondary"
        className="rounded-control! border-atelier-rule! bg-transparent! text-atelier-ink! hover:border-atelier-muted! hover:bg-atelier-ink/5!"
        disabled={username === initialUsername}
        pending={status === "saving"}
        pendingLabel={t.common.saving}
      >
        {status === "saved" ? t.common.saved : t.common.save}
      </Button>
    </form>
  );
}
