import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getServerMessages } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

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
