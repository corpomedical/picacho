"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Next.js requires error.tsx to be a Client Component — it receives the
// thrown error and a reset() callback to re-render the segment without a
// full page reload.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
        P
      </span>
      <h1 className="mt-6 text-xl font-semibold text-neutral-900">{t.errors.somethingWrongTitle}</h1>
      <p className="mt-2 max-w-sm text-sm text-neutral-500">{t.errors.somethingWrongSubtitle}</p>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={() => reset()}>
          {t.errors.tryAgain}
        </Button>
        <Link href="/">
          <Button>{t.errors.goHome}</Button>
        </Link>
      </div>
    </main>
  );
}
