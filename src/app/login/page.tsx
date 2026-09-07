import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label, Input } from "@/components/ui/field";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp, nativeSupportsAuthReturn } from "@/lib/native/server";
import { Logo } from "@/components/logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Already signed in — no reason to show the form and make them
  // re-authenticate, just send them straight back into the app.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/app");

  const { t } = await getServerMessages();
  const a = t.auth.login;

  // ?error is a CODE mapped to this page's own translated wording — never
  // text (2026-09-05 flaw hunt: the page printed whatever a crafted link put
  // there, official-looking, on the page where people type passwords). Any
  // unrecognized non-empty value gets the generic line, so an old
  // bookmarked link still shows something honest.
  const errors = t.auth.errors;
  const errorText = error
    ? Object.prototype.hasOwnProperty.call(errors, error)
      ? errors[error as keyof typeof errors]
      : errors.failed
    : null;

  // OAuth in the app works only on a shell that can catch the redirect coming
  // back (custom-scheme intent filter + NativeAuthReturn). Before that existed,
  // the provider redirect bounced to the system browser and the session landed
  // in Chrome's cookies, not the app's — the app stayed signed out (verified on
  // the Play internal build, 2026-08-20).
  //
  // So the question asked here is "can this build return?", NOT "is this the
  // app?". The website reaches every installed binary the moment Vercel
  // deploys; older ones have no way back and must keep the buttons hidden.
  // Server-side so they never render-then-vanish.
  const native = await isNativeApp();
  const showOAuth = !native || (await nativeSupportsAuthReturn());

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>
          <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-neutral-900">{a.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{a.subtitle}</p>

          {showOAuth && (
            <>
              <div className="mt-6">
                <OAuthButtons nativeReturn={native} />
              </div>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-neutral-200" />
                <span className="text-xs text-neutral-400">{a.or}</span>
                <div className="h-px flex-1 bg-neutral-200" />
              </div>
            </>
          )}

          <form action={login} className={showOAuth ? "space-y-4" : "mt-6 space-y-4"}>
            <div>
              <Label htmlFor="email">{a.emailLabel}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{a.passwordLabel}</Label>
                <Link href="/forgot-password" className="text-xs text-neutral-500 hover:text-neutral-900">
                  {a.forgotPassword}
                </Link>
              </div>
              <Input id="password" name="password" type="password" required />
            </div>

            {errorText && <p className="text-sm text-red-600">{errorText}</p>}

            <SubmitButton className="w-full" pendingLabel={a.submit}>
              {a.submit}
            </SubmitButton>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500">
            {a.noAccount}{" "}
            <Link href="/signup" className="font-medium text-neutral-900 underline">
              {a.signupLink}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
