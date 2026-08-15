"use client";

import { deleteUser } from "@/lib/admin/actions";
import { SubmitButton } from "@/components/ui/submit-button";

// Delete is irreversible and cascades across every table the user owns, so it
// gets an explicit confirm before the server action runs — a mis-click here
// wipes an account's whole history with no undo.
export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  return (
    <form
      action={deleteUser}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Permanently delete ${email}?\n\nThis removes their account and ALL their data — characters, generations, projects, billing records, feedback — and cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="user_id" value={userId} />
      <SubmitButton
        size="sm"
        className="w-full bg-red-600 text-white hover:bg-red-700"
        pendingLabel="Deleting…"
      >
        Delete this user
      </SubmitButton>
    </form>
  );
}
