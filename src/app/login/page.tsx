import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Input } from "@/components/ui/field";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getServerMessages } from "@/lib/i18n/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  // Already signed in — no reason to show the form and make them
  // re-authenticate, just send them straight back into the app.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/app");

  const { t } = await getServerMessages();
  const a = t.auth.login;

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

          <form action={login} className="space-y-4">
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

            {message && <p className="text-sm text-neutral-600">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" className="w-full">
              {a.submit}
            </Button>
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
