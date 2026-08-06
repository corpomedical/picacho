import { redirect } from "next/navigation";

// Folded into the consolidated /app/settings page — kept as a redirect in
// case anything still links here.
export default function UsagePage() {
  redirect("/app/settings");
}
