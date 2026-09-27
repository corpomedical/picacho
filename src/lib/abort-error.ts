/** A DOMException (or anything named like one) that says it was aborted: something stopped on purpose. */
export function isAbortError(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "AbortError";
}
