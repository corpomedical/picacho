import { createClient } from "@/lib/supabase/server";
import { updateAppSetting } from "@/lib/admin/actions";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label, Input } from "@/components/ui/field";
import { AdminErrorBanner } from "@/components/admin-error-banner";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("*")
    .order("key", { ascending: true });

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">System</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Settings</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        App-wide configuration. Changes apply immediately, no redeploy needed.
      </p>

      <div className="mt-6 space-y-4">
        {(settings ?? []).map((setting) => (
          <Card key={setting.key}>
            <form action={updateAppSetting} className="flex items-end gap-4">
              <div className="flex-1">
                <Label htmlFor={setting.key}>{setting.key}</Label>
                <Input
                  id={setting.key}
                  name="value"
                  key={setting.value}
                  defaultValue={setting.value}
                />
                {setting.description && (
                  <p className="mt-1.5 text-xs text-neutral-500">{setting.description}</p>
                )}
              </div>
              <input type="hidden" name="key" value={setting.key} />
              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
