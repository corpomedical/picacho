"use client";

import { useEffect, useRef, useState } from "react";
import { checkUsernameAvailability } from "@/lib/auth/actions";
import { Input, Label } from "@/components/ui/field";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// The signup form's username field, with a live availability check.
//
// Plain controlled input inside the surrounding server-action <form> — it
// contributes name="username" to the POST like any other field; the client
// side only adds the debounced check and its verdict line. The server
// re-validates on submit regardless (see signup in lib/auth/actions.ts):
// this check is a courtesy, not the enforcement.
type Verdict = "idle" | "checking" | "available" | "taken" | "invalid";

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export function SignupUsernameField() {
  const { t } = useLocale();
  const a = t.auth.signup;
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against out-of-order responses: a slow check for "eva" must not
  // overwrite the verdict for "eva_films" typed afterwards.
  const seq = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(raw: string) {
    // Normalize as they type: usernames are lowercase by definition here,
    // and silently lowercasing beats rejecting "Eva" as invalid.
    const v = raw.toLowerCase().replace(/\s+/g, "_");
    setValue(v);
    if (timer.current) clearTimeout(timer.current);

    if (v.length === 0) {
      setVerdict("idle");
      return;
    }
    if (!USERNAME_RE.test(v)) {
      setVerdict("invalid");
      return;
    }
    setVerdict("checking");
    const mySeq = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailability(v);
        if (seq.current !== mySeq) return;
        setVerdict(available ? "available" : "taken");
      } catch {
        // Network hiccup: stay quiet rather than wrongly claiming taken —
        // the server still enforces on submit.
        if (seq.current === mySeq) setVerdict("idle");
      }
    }, 450);
  }

  return (
    <div>
      <Label htmlFor="signup-username">{a.usernameLabel}</Label>
      <Input
        id="signup-username"
        name="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={3}
        maxLength={24}
        autoComplete="username"
        spellCheck={false}
        aria-describedby="signup-username-status"
      />
      <p
        id="signup-username-status"
        aria-live="polite"
        className={cn(
          "mt-1.5 min-h-[1rem] text-xs",
          verdict === "available" && "text-emerald-600",
          verdict === "taken" && "text-red-600",
          verdict === "invalid" && "text-amber-600",
          (verdict === "checking" || verdict === "idle") && "text-neutral-400",
        )}
      >
        {verdict === "checking"
          ? a.usernameChecking
          : verdict === "available"
            ? a.usernameAvailable
            : verdict === "taken"
              ? a.usernameTaken
              : verdict === "invalid"
                ? a.usernameInvalid
                : a.usernameHint}
      </p>
    </div>
  );
}
