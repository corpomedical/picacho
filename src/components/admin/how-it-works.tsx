import type { ReactNode } from "react";

/**
 * The long explanation behind a panel, folded (Admin · Apple, 2026-10-02:
 * "clean up"). Closed by default; the words stay one tap away. Styled in
 * admin-apple.css (details[data-how]).
 */
export function HowItWorks({ children, label = "How this works" }: { children: ReactNode; label?: string }) {
  return (
    <details data-how>
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
