"use client";

import { useEffect, useState } from "react";

// Renders an email address that exists only AFTER hydration — see
// legal-entity.ts for why. Server HTML (what harvesters scrape) shows a
// human-readable hint; the real, clickable mailto appears on mount.
export function ObfuscatedEmail({
  user,
  domain,
  className,
}: {
  user: string;
  domain: string;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <span className={className}>
        {user}&nbsp;[at]&nbsp;{domain.replace(/\./g, " [dot] ")}
      </span>
    );
  }
  const address = `${user}@${domain}`;
  return (
    <a href={`mailto:${address}`} className={className}>
      {address}
    </a>
  );
}
