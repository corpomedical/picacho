"use server";

// The Starring tile's answer, from the browser: "Who is Eva?" and "Eva may
// appear in ads for products I sell" (star-consent.ts decides and writes).
// Who first, exactly as the product card's actions do (card-service.ts
// pressTourCaller: Press Tour on, open to the person, email confirmed), then
// the real clients.

import { headers } from "next/headers";
import { getLocale } from "@/lib/i18n/server";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pressTourCaller } from "./card-service";
import { STAR_CONSENT_FAILED, keepStarConsent, type StarConsentResult } from "./star-consent";

export async function recordStarConsent(input: { characterId: string; answer: string; adsOk: boolean }): Promise<StarConsentResult> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const who = await pressTourCaller(supabase, data.user);
    if (who.error !== null) return { error: who.error };
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return await keepStarConsent(
      { db: supabase, admin: createAdminClient(), rateLimited, hashKey: hashedRateKey },
      who.caller.userId,
      input,
      { locale: await getLocale(), ip },
    );
  } catch (err) {
    console.error(`[press-tour] star consent failed: ${err instanceof Error ? err.message : String(err)}`);
    return { error: STAR_CONSENT_FAILED };
  }
}
