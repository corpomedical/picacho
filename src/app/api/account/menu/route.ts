import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAccountMenu } from "@/lib/account-menu/summary";

// The account menu's numbers (components/account-menu), read fresh each time
// it opens, so a render made a minute ago is already counted. Only the
// caller's own account: the id comes from the session, never the request.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return NextResponse.json({ ok: false }, { status: 401 });
    const menu = await loadAccountMenu(supabase, data.user.id, data.user.email ?? "");
    return NextResponse.json({ ok: true, menu }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("account menu: read failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
