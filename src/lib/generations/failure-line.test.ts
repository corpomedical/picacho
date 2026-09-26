import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttemptLog } from "./pipeline";
import en from "../i18n/messages/en";
import { pickFailureLine, rulesBlockOf } from "./failure-line";

const attempt = (steps: AttemptLog["steps"], issues: string[] = []): AttemptLog => ({
  attempt: 1,
  passed: false,
  issues,
  compiledPrompt: "",
  steps,
});

describe("pickFailureLine", () => {
  it("puts the photo the person can fix ahead of the budget stub", () => {
    const log = [
      attempt([{ step: "generate", detail: 'OpenAI images error (400): {"error":{"message":"Invalid image file"}}' }], ["provider_error"]),
      attempt([{ step: "generate", detail: "This request already used its 3 generation attempts without producing a usable image." }], ["provider_error"]),
    ];
    expect(pickFailureLine(log, en.generate)).toBe(en.generate.failAttachmentUnreadable);
  });

  it("shows a content-policy verdict verbatim", () => {
    const log = [attempt([{ step: "validate", detail: "This prompt asks for something Picacho doesn't make." }], ["content_policy"])];
    expect(pickFailureLine(log, en.generate)).toBe("This prompt asks for something Picacho doesn't make.");
  });

  it("has no line for an ending it doesn't recognise", () => {
    expect(pickFailureLine([attempt([{ step: "generate", detail: "This render didn't finish in time and was stopped." }])], en.generate)).toBeNull();
  });
});

describe("rulesBlockOf", () => {
  it("finds the brand-rules story on the last attempt only", () => {
    const block = 'Blocked by brand rules: No logos (triggered by: "nike")';
    expect(rulesBlockOf([attempt([{ step: "validate", detail: block }])])).toBe(block);
    expect(rulesBlockOf([attempt([{ step: "validate", detail: block }]), attempt([{ step: "generate", detail: "x" }])])).toBeNull();
  });
});

describe("one copy", () => {
  it("the composer imports it rather than keeping its own", () => {
    const form = readFileSync(join(__dirname, "..", "..", "components", "generate-form.tsx"), "utf8");
    expect(form).toContain('import { pickFailureLine, rulesBlockOf } from "@/lib/generations/failure-line";');
    expect(form).not.toMatch(/function (pickFailureLine|rulesBlockOf)\(/);
  });
});
