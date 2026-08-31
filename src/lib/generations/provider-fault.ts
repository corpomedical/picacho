// Whether a failure means the MODEL is broken (2026-08-31: extracted from
// model-health.ts so it can be tested — that module imports the admin client
// through "@/", which vitest-without-config cannot resolve).
//
// Failures that mean the MODEL is broken, as opposed to this particular
// request being unreasonable.
//
// The distinction matters: counting a rejected prompt as a provider failure
// would let three people writing content-policy-violating prompts take a
// perfectly healthy model offline for everyone. Only infrastructure-shaped
// failures count.
export function isProviderFault(message: string): boolean {
  const m = message.toLowerCase();
  // Matched against fal's REAL tokens, not English prose. The original list
  // said "content policy" with a space, while fal writes
  // "content_policy_violation" — so every Seedance 2.5 likeness refusal was
  // counted as the MODEL failing. Observed in production on 2026-08-31:
  // seedance sat at consecutive_failures = 20 from one user's rejected
  // photos, one distinct-user short of the breaker silently substituting a
  // different model for everyone. A rejection is the provider ANSWERING,
  // not the provider being down.
  const requestFault =
    m.includes("content policy") ||
    m.includes("content_policy") ||
    m.includes("moderation") ||
    m.includes("nsfw") ||
    m.includes("safety") ||
    m.includes("likeness") ||
    m.includes("invalid prompt") ||
    m.includes("prompt is too long") ||
    m.includes("partner_validation") ||
    m.includes("aspect_ratio") ||
    m.includes("invalid parameters");
  if (requestFault) return false;
  // Any 4xx apart from 429 is the provider judging THIS request — bad input,
  // policy, auth scope — and says nothing about whether the model works for
  // the next person. 429 stays a provider fault on purpose: a stream of
  // rate-limit errors is capacity, which is exactly what the breaker is for.
  const status = m.match(/error \((4\d\d)\)/);
  if (status && status[1] !== "429") return false;
  return true;
}

