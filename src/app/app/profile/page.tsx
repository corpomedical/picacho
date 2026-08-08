import { redirect } from "next/navigation";

// Folded into the consolidated /app/settings page — kept as a redirect in
// case anything still links here. "Profile" maps to the Account tab, which
// is also the default, but this is explicit for clarity.
export default function ProfilePage() {
  redirect("/app/settings?tab=account");
}
