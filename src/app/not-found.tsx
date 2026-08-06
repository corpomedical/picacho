import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getServerMessages();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
        P
      </span>
      <p className="mt-6 text-6xl font-semibold tracking-tight text-neutral-200">404</p>
      <h1 className="mt-2 text-xl font-semibold text-neutral-900">{t.errors.notFoundTitle}</h1>
      <p className="mt-2 max-w-sm text-sm text-neutral-500">{t.errors.notFoundSubtitle}</p>
      <Link href="/" className="mt-6">
        <Button>{t.errors.goHome}</Button>
      </Link>
    </main>
  );
}
