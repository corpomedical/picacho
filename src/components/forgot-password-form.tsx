"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { clientOrigin } from "@/lib/client-origin";

export function ForgotPasswordForm() {
  const { t } = useLocale();
  const f = t.auth.forgotPassword;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    // Errors here (e.g. "no user with that email") are intentionally not
    // surfaced — always show the same message either way, so this can't be
    // used to check which emails have an account.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${clientOrigin()}/auth/callback?next=/reset-password`,
    });

    setStatus("sent");
  }

  if (status === "sent") {
    return <p className="text-sm text-neutral-600">{f.checkEmail}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">{f.emailLabel}</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" pending={status === "sending"} pendingLabel={f.submit}>
        {f.submit}
      </Button>
    </form>
  );
}
