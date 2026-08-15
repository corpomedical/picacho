import Link from "next/link";
import { redirect } from "next/navigation";
import { signup } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label, Input } from "@/components/ui/field";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getServerMessages } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  // Already signed in — skip the form and send them straight into the app.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/app");

  // Real kill switch — Admin > Feature flags. Missing/errored row fails
  // open (signups stay on) so a database hiccup can't silently lock
  // everyone out; only an explicit `enabled: false` closes signups.
  //
  // maybeSingle, not single: anonymous visitors read this flag through a
  // dedicated anon RLS policy, and .single() turns "no visible row" into a
  // 406 error. Before that policy existed, anon could never see the row at
  // all — which meant the kill switch silently didn't work for the exact
  // audience it targets. Fixed 2026-08-12 (policy + this).
  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "signups_enabled")
    .maybeSingle();
  const signupsEnabled = flag?.enabled !== false;

  const { t } = await getServerMessages();
  const a = t.auth.signup;

  // Post-signup confirmation screen. Reached by the signup action's redirect
  // to /signup?sent=1 — a clear "we emailed you, go click the link" state
  // instead of silently landing on the login form.
  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center">
            <Logo className="h-8" />
          </div>
          <Card>
            <div className="flex justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                  aria-hidden
                >
                  <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
                  <path d="m3.5 7 8.5 6 8.5-6" />
                </svg>
              </span>
            </div>
            <h1 className="mt-5 text-center text-xl font-semibold text-neutral-900">
              {a.checkEmailTitle}
            </h1>
            <p className="mt-2 text-center text-sm leading-relaxed text-neutral-500">
              {a.checkEmailBody}
            </p>
            <p className="mt-4 text-center text-xs leading-relaxed text-neutral-400">
              {a.checkEmailSpam}
            </p>
            <Link href="/login" className="mt-6 block">
              <Button variant="secondary" className="w-full">
                {a.backToLogin}
              </Button>
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  if (!signupsEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center">
            <Logo className="h-8" />
          </div>
          <Card>
            <h1 className="text-xl font-semibold text-neutral-900">{a.closedTitle}</h1>
            <p className="mt-2 text-sm text-neutral-500">{a.closedBody}</p>
            <Link href="/login" className="mt-6 block">
              <Button variant="secondary" className="w-full">
                {a.loginLink}
              </Button>
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>
          <h1 className="text-xl font-semibold text-neutral-900">{a.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{a.subtitle}</p>

          <div className="mt-6">
            <OAuthButtons />
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs text-neutral-400">{a.or}</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          <form action={signup} className="space-y-4">
            <div>
              <Label htmlFor="email">{a.emailLabel}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="password">{a.passwordLabel}</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-neutral-500">
              <input
                type="checkbox"
                name="agree_to_terms"
                required
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded border-neutral-300"
              />
              <span>
                {t.signup.agreeToTerms}{" "}
                <span className="whitespace-nowrap">
                  (
                  <Link href="/terms" className="underline hover:text-neutral-900">
                    {t.marketing.footer.terms}
                  </Link>
                  {" · "}
                  <Link href="/privacy" className="underline hover:text-neutral-900">
                    {t.marketing.footer.privacy}
                  </Link>
                  {" · "}
                  <Link href="/content-policy" className="underline hover:text-neutral-900">
                    {t.marketing.footer.contentPolicy}
                  </Link>
                  )
                </span>
              </span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <SubmitButton className="w-full" pendingLabel={a.submit}>
              {a.submit}
            </SubmitButton>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500">
            {a.haveAccount}{" "}
            <Link href="/login" className="font-medium text-neutral-900 underline">
              {a.loginLink}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
