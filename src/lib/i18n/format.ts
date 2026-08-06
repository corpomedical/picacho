// Tiny {token} interpolation helper — the Messages dictionary stores plain
// strings (so TypeScript can enforce every locale has the same keys via
// `satisfies`), so parameterized text uses {placeholder} tokens replaced at
// the call site instead of template functions.
export function formatMsg(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
