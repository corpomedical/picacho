import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getServerMessages } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/app");

  const { t } = await getServerMessages();
  const f = t.auth.forgotPassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>
          <h1 className="text-xl font-semibold text-neutral-900">{f.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{f.subtitle}</p>

          <div className="mt-6">
            <ForgotPasswordForm />
          </div>

          <p className="mt-6 text-center text-sm text-neutral-500">
            <Link href="/login" className="font-medium text-neutral-900 underline">
              {f.backToLogin}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
