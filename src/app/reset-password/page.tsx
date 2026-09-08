import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getServerMessages } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

// "Set a new password | Picacho" in the tab and in a search result, via the root layout's
// title.template — in the reader's language, since the heading already is.
// Until 2026-09-08 the four account pages set no title of their own, so all
// of them wore the homepage's, and someone with three tabs open could not
// tell the login from the signup from the reset. Not in the sitemap on
// purpose (see truth-contracts.test.ts); a title is for the person, not the
// crawler.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  return { title: t.auth.resetPassword.title, description: t.auth.resetPassword.subtitle };
}

export default async function ResetPasswordPage() {
  // Only reachable with a valid (recovery) session — someone landing here
  // without one hasn't gone through the emailed reset link, so send them to
  // request one instead of showing a form that would just fail.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/forgot-password");

  const { t } = await getServerMessages();
  const r = t.auth.resetPassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>
          <h1 className="text-xl font-semibold text-neutral-900">{r.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{r.subtitle}</p>

          <div className="mt-6">
            <ResetPasswordForm />
          </div>
        </Card>
      </div>
    </main>
  );
}
