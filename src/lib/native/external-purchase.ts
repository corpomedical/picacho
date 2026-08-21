import { headers } from "next/headers";
import { isNativeApp } from "@/lib/native/server";

// May THIS request's native app show a link out to the website's purchase
// pages? Only in the United States — the Epic v. Google injunction (in
// force since late 2025) bars Google from prohibiting external purchase
// links for US users, and NOWHERE else without enrollment paperwork (EEA
// External Offers) that we haven't done. Everywhere outside the US the app
// stays pure reader-mode; a steering link shown to the wrong region is the
// classic Play-policy violation.
//
// Country comes from Vercel's edge geo header, server-side per request —
// never from the client, which could be spoofed into showing the link where
// it must not appear. FAIL CLOSED: no header (local dev, unknown geo) means
// no link. The decision is per-request, not per-account, matching how the
// policy itself applies (what the app SHOWS, where).
export async function allowExternalPurchaseLink(): Promise<boolean> {
  if (!(await isNativeApp())) return false;
  const country = (await headers()).get("x-vercel-ip-country");
  return country === "US";
}

// Where the link goes: the sibling domain, deliberately. picacho.io serves
// the same app but is NOT in the shell's allowNavigation list — so opening
// it bounces out of the WebView into the system browser, which is exactly
// the "external link" shape the injunction describes (and keeps the
// purchase flow out of the app's own frame).
export const EXTERNAL_PURCHASE_URL = "https://picacho.io/pricing";
