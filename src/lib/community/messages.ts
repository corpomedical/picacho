// Wire strings the community actions return that the client recognizes by
// exact match (a "use server" module may export only async functions, so the
// shared constant lives here).

/** Returned when a share asked to leave the prompt out and the server could not — nothing was inserted. */
export const SHARE_PROMPT_HIDE_FAILED = "Couldn't share without the prompt, so nothing was shared — try again.";
