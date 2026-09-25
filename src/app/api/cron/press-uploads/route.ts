import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sweepStaleUploads } from "@/lib/press-tour/upload-sweep";

// The hourly sweep of Press Tour's staged uploads (2026-09-26, review
// SEC-3): a photo the browser put in press-uploads and nobody read is
// removed once it is older than its upload token's two hours plus a margin
// (lib/press-tour/upload-sweep.ts). Without it such a file stayed in storage
// for good, and a script could fill places it never meant to use.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await sweepStaleUploads(createAdminClient());
  if (result.error) console.error("press-uploads: sweep stopped:", result.error, { removed: result.removed });
  else if (result.removed > 0 || !result.done) console.info("press-uploads: staged uploads removed", result);
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}
