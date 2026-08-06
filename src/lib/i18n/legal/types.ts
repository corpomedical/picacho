export type LegalSection = {
  heading: string;
  paragraphs: string[];
  // Visual emphasis for especially critical rules (e.g. the Content
  // Policy's minors section) — "critical" renders a red callout,
  // "high" an amber one. Omitted for normal sections.
  emphasis?: "critical" | "high";
};

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};
