import { headers } from "next/headers";

// Best-effort current origin for building absolute redirect URLs (e.g. for
// Stripe Checkout success/cancel URLs). Prefers NEXT_PUBLIC_SITE_URL when
// it's set (production), otherwise reads the incoming request's Host header
// so this also works correctly during local dev, before that env var exists.
export async function getOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const host = (await headers()).get("host");
  if (!host) return "http://localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${host}`;
}
