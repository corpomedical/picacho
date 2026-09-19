export type LegalSection = {
  /** An anchor other pages link to (the face check's consent links #facial-information). */
  id?: string;
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
