// Split out from actions.ts so pipeline.ts can import these types without
// pulling in a "use server" module (and without the two files importing each
// other — actions.ts needs ContentType from pipeline.ts).

export type BrandRuleKind = "require" | "forbid";
export type BrandRuleSeverity = "block" | "warn";

export type BrandRule = {
  id: string;
  kind: BrandRuleKind;
  label: string;
  value: string;
  appliesTo: "all" | "image" | "video";
  severity: BrandRuleSeverity;
  active: boolean;
};
