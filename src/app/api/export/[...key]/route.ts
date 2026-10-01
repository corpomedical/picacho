import crypto from "crypto";
import { NextResponse } from "next/server";
import { freeMarkApplies, markedCopy, type ExportProfile } from "@/lib/media/free-mark-export";
import { isMediaBucket, mediaSig, mediaUrl } from "@/lib/media/url";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// The download door (2026-10-02): /api/export/<bucket>/<path>?v=<sig>, the
// same capability as /api/media (the same signature, checked the same way).
// Every Download and Share in the app asks here (download-button.tsx
// exportUrl). A free account's own picture or video comes back with the
// Picacho "P" (lib/media/free-mark-export.ts); everyone else is sent to the
// original's /api/media address.
//
// Never cached by the CDN or the browser: the answer depends on who asks
// and on their plan today, and an upgrade must download clean at once.

export const runtime = "nodejs";
// A first video download burns the mark (a few seconds for a 5-10 s clip).
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const [bucket, ...pathParts] = key ?? [];
  if (!bucket || pathParts.length === 0 || !isMediaBucket(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const objectPath = pathParts.join("/");
  const provided = new URL(request.url).searchParams.get("v") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(mediaSig(bucket, objectPath));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const original = () =>
    NextResponse.redirect(new URL(mediaUrl(bucket, objectPath), request.url), { status: 302, headers: NO_STORE });

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    let profile: ExportProfile | null = null;
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select("plan, role, purchased_credits")
        .eq("id", userId)
        .maybeSingle();
      profile = (data as ExportProfile | null) ?? null;
    }
    if (!freeMarkApplies(userId, profile, bucket, objectPath)) return original();

    const marked = await markedCopy(createAdminClient(), bucket, objectPath);
    if (!marked) return original();
    return new NextResponse(new Uint8Array(marked.bytes), {
      headers: {
        ...NO_STORE,
        "content-type": marked.contentType,
        "content-length": String(marked.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    // A download never fails over the mark: the original goes instead.
    console.error("[free-mark] export failed, serving the original", { bucket, objectPath, err });
    return original();
  }
}
