import { describe, expect, it } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isStaleDeployError } from "./stale-deploy";

// Next 16.3's client throws exactly this from fetchServerAction
// (router-reducer/reducers/server-action-reducer.js) when the server answers
// x-nextjs-action-not-found: a deploy landed while the tab was open. The
// composer's own copy of the detector knew only the older wording and showed
// "submit failed" instead of reloading (2026-09-11). Built from Next's real
// class, so an upgrade that renames it fails here rather than in a stale tab.
function nextUnrecognizedAction(actionId: string) {
  return new UnrecognizedActionError(
    `Server Action "${actionId}" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action`,
  );
}

describe("isStaleDeployError", () => {
  it("recognises Next 16's UnrecognizedActionError by its name, even reworded", () => {
    expect(isStaleDeployError(nextUnrecognizedAction("7f3a9c"))).toBe(true);
    expect(isStaleDeployError(new UnrecognizedActionError("reworded by a later Next"))).toBe(true);
  });

  it("recognises its message as bare text, which is all the error reporter may get", () => {
    expect(isStaleDeployError(nextUnrecognizedAction("7f3a9c").message)).toBe(true);
  });

  it("still recognises the older wording", () => {
    expect(isStaleDeployError(new Error("An unexpected response was received from the server."))).toBe(true);
  });

  it("leaves real failures alone", () => {
    for (const err of [
      new Error("Failed to fetch"),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      "Unhandled promise rejection",
      undefined,
      null,
    ]) {
      expect(isStaleDeployError(err)).toBe(false);
    }
  });
});
