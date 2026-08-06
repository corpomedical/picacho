import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AdminModerationPage() {
  const supabase = await createClient();

  const { data: generations, error } = await supabase
    .from("generations")
    .select("id, user_id, prompt_input, status, attempts, created_at")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(50);

  const userIds = Array.from(new Set((generations ?? []).map((g) => g.user_id)));
  const { data: users } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Moderation</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Generations that failed to pass validation after every retry.
      </p>

      <div className="mt-6 space-y-3">
        {error ? (
          <Card className="text-center">
            <p className="text-sm text-red-600">Couldn&apos;t load: {error.message}</p>
          </Card>
        ) : !generations || generations.length === 0 ? (
          <Card className="text-center">
            <p className="text-sm text-neutral-500">Nothing flagged. All clear.</p>
          </Card>
        ) : (
          generations.map((g) => (
            <Link key={g.id} href={`/app/history/${g.id}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.12)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {g.prompt_input}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {emailById.get(g.user_id) ?? "Unknown user"} ·{" "}
                    {new Date(g.created_at).toLocaleDateString()} · {g.attempts} attempts
                  </p>
                </div>
                <Badge tone="danger" className="flex-shrink-0">
                  failed
                </Badge>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
