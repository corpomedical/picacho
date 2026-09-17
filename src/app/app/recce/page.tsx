import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";
import { getSetsHome } from "@/lib/sets/data";
import { isRecceEnabled } from "@/lib/sets/enabled";
import { finisherCanRun } from "@/lib/sets/finisher";
import { readRecceSeconds } from "@/lib/sets/recce-store";
import { SETS_SESSION_EXPIRED } from "@/lib/sets/messages";
import { RecceDoor } from "@/components/recce/recce-door";

// The Recce door (board K, "Build A as Recce", 2026-09-17): the theatre.
// Its own page and its own name — Helios runs underneath (a read IS a set;
// opening one lands in the studio) but this page never says set, build or
// Astra. Admins only while in testing, behind astra_recce with both Sets
// switches under it; to anyone else this page does not exist.
//
// The clip's read runs inside the server action this page hosts
// (submitSetRecceBuild: the words reader, then the picture check's
// 10–100 s), so the route declares the same budget the Sets page does.
export const maxDuration = 300;

export default async function ReccePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin") notFound();
  if (!(await isRecceEnabled(supabase))) notFound();

  const data = await getSetsHome();
  if (data.error === SETS_SESSION_EXPIRED) redirect("/login");
  if (data.error !== null) notFound();

  // The door's list is the same rows Helios lists, filtered to reads —
  // nothing is stored twice. The seconds come with the filter.
  const seconds = await readRecceSeconds(
    supabase,
    data.sets.map((s) => s.id),
    userData.user.id,
  );
  const reads = data.sets.filter((s) => seconds.has(s.id)).map((s) => ({ ...s, seconds: seconds.get(s.id) ?? 0 }));

  const { t } = await getServerMessages();
  const native = await isNativeApp();
  if (native) {
    // Web-only while Helios is (lib/native/platform.ts): same rule, said quietly.
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{t.nav.recce}</h1>
        <p className="mt-2 text-sm text-atelier-muted">{t.sets.webOnly}</p>
      </div>
    );
  }

  return <RecceDoor initialReads={reads} finisherOn={finisherCanRun()} />;
}
