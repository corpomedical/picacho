"use client";

import { useState } from "react";
import { deleteAccount } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

export function DeleteAccountForm({ username }: { username: string }) {
  const { t } = useLocale();
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText.trim().toLowerCase() === username.toLowerCase();

  return (
    <form action={deleteAccount} className="space-y-3">
      <p className="text-sm text-neutral-600">
        {t.settings.deleteWarning}
      </p>
      <div>
        <Label htmlFor="confirm_delete">
          {t.settings.typeToConfirm.split("{username}")[0]}
          <span className="font-semibold text-neutral-900">{username}</span>
          {t.settings.typeToConfirm.split("{username}")[1]}
        </Label>
        <Input
          id="confirm_delete"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
      </div>
      <Button type="submit" variant="destructive" disabled={!canDelete}>
        {t.settings.deleteMyAccount}
      </Button>
    </form>
  );
}
