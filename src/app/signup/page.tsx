import Link from "next/link";
import { redirect } from "next/navigation";
import { signup } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Input } from "@/components/ui/field";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getServerMessages } from "@/lib/i18n/server";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Already signed in — skip the form and send them straight into the app.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/app");

  const { t } = await getServerMessages();
  const a = t.auth.signup;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
            P
          </span>
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

            <Button type="submit" className="w-full">
              {a.submit}
            </Button>
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
