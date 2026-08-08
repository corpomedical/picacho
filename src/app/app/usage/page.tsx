import { redirect } from "next/navigation";

// Folded into the consolidated /app/settings page — kept as a redirect in
// case anything still links here. Deep-links straight to the Usage & plan
// tab rather than dropping onto the default Account tab.
export default function UsagePage() {
  redirect("/app/settings?tab=usage");
}
