import { describe, expect, it } from "vitest";
import { citedSources, hostOf, parseSources } from "./sources";
import { DEFAULT_PERSONALITY, PERSONALITIES, PERSONALITY_LABELS, PERSONALITY_RULES, parsePersonality } from "./personality";

describe("an answer's sources", () => {
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "news" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
    {
      type: "text",
      text: "It launched last week.",
      citations: [
        { type: "web_search_result_location", url: "https://www.theverge.com/a", title: "The Verge story", cited_text: "…" },
        { type: "web_search_result_location", url: "https://www.theverge.com/a", title: "The Verge story", cited_text: "…" },
        { type: "web_search_result_location", url: "https://example.com/b", title: "", cited_text: "…" },
      ],
    },
    { type: "text", text: "No citation here." },
  ];

  it("lists each cited page once, in the order first cited, titled", () => {
    expect(citedSources(content)).toEqual([
      { url: "https://www.theverge.com/a", title: "The Verge story" },
      { url: "https://example.com/b", title: "example.com" },
    ]);
  });

  it("finds nothing in an answer without web citations, and drops what isn't a web link", () => {
    expect(citedSources([{ type: "text", text: "Hi" }])).toEqual([]);
    expect(citedSources("not blocks")).toEqual([]);
    expect(citedSources([{ type: "text", citations: [{ type: "web_search_result_location", url: "javascript:alert(1)", title: "x" }] }])).toEqual([]);
  });

  it("reads stored sources back, keeping only proper links", () => {
    expect(parseSources([{ url: "https://a.com", title: "A" }, { url: "ftp://b", title: "B" }, "junk"])).toEqual([{ url: "https://a.com", title: "A" }]);
    expect(hostOf("https://www.bbc.co.uk/news")).toBe("bbc.co.uk");
  });
});

describe("her personality", () => {
  it("is the default (the Aly he knows), sarcastic or rude", () => {
    expect([...PERSONALITIES]).toEqual(["default", "sarcastic", "rude"]);
    expect(DEFAULT_PERSONALITY).toBe("default");
    expect(PERSONALITY_LABELS.default.name).toBe("Default");
    expect(parsePersonality("rude")).toBe("rude");
    expect(parsePersonality(null)).toBe("default");
    expect(parsePersonality("evil")).toBe("default");
  });

  it("keeps the rude one within limits and never lets a personality cost an answer", () => {
    expect(PERSONALITY_RULES).toContain("no slurs");
    expect(PERSONALITY_RULES).toContain("drop the act at once and be kind");
    expect(PERSONALITY_RULES).toContain("never what you know, how carefully you work or what you will do");
  });
});
