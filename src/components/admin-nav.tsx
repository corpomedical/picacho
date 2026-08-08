"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/stats", label: "Stats" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/moderation", label: "Moderation" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/system", label: "System health" },
  { href: "/admin/providers", label: "AI providers" },
  { href: "/admin/voices", label: "Voices" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/settings", label: "Settings" },
] as const;

// "/admin" itself needs an exact match (otherwise it'd stay highlighted on
// every other /admin/* page, since they all start with that prefix) — every
// other tab matches on prefix so a detail page like /admin/users/[id] still
// highlights "Users".
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-6xl gap-6 px-8 text-sm text-neutral-500">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 py-3 transition-colors",
              active
                ? "border-neutral-900 font-medium text-neutral-900"
                : "border-transparent hover:text-neutral-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
