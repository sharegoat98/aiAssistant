import { describe, expect, it } from "vitest";
import { KB_ARTICLES, type KbArticle } from "../src/data/kb";
import { MAX_RESULTS, searchKnowledge, SNIPPET_CHARS } from "../src/mcp/search";

const ITEM = (id: string, title: string, body: string): KbArticle => ({
  id,
  domain: "it",
  title,
  body,
});

describe("searchKnowledge", () => {
  it("finds the matching article", () => {
    const results = searchKnowledge("vpn", "it");
    expect(results[0]?.id).toBe("it-vpn");
    expect(results[0]?.title).toBe("VPN connection problems");
  });

  it("is case-insensitive", () => {
    expect(searchKnowledge("VPN", "it")).toEqual(searchKnowledge("vpn", "it"));
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchKnowledge("xyzzy-nonexistent", "it")).toEqual([]);
  });

  it("returns an empty list for a query without tokens", () => {
    expect(searchKnowledge("  ?! ", "it")).toEqual([]);
  });

  it("never crosses domains", () => {
    const hr = searchKnowledge("leave vpn laptop account", "hr");
    expect(hr.length).toBeGreaterThan(0);
    for (const r of hr) {
      expect(KB_ARTICLES.find((a) => a.id === r.id)?.domain).toBe("hr");
    }
    const it = searchKnowledge("leave vpn laptop account", "it");
    for (const r of it) {
      expect(KB_ARTICLES.find((a) => a.id === r.id)?.domain).toBe("it");
    }
  });

  it("orders by score then id and caps results", () => {
    const articles = [
      ITEM("d", "Other", "cat"),
      ITEM("b", "Other", "cat"),
      ITEM("a", "Other", "cat"),
      ITEM("c", "cat", "cat"), // title + body hit => highest score
      ITEM("e", "Other", "dog"),
    ];
    const results = searchKnowledge("cat", "it", articles);
    expect(results.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(results.length).toBeLessThanOrEqual(MAX_RESULTS);
  });

  it("truncates long snippets and keeps short bodies intact", () => {
    const long = ITEM("l", "Long", `needle ${"word ".repeat(1000)}`);
    const short = ITEM("s", "Short", "needle only");
    const [l, s] = [
      searchKnowledge("needle", "it", [long])[0],
      searchKnowledge("needle", "it", [short])[0],
    ];
    expect(l?.snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS + 1);
    expect(l?.snippet.endsWith("…")).toBe(true);
    expect(s?.snippet).toBe("needle only");
  });

  it("returns the complete body for every article in the KB (nothing is silently cut)", () => {
    for (const a of KB_ARTICLES) {
      expect(a.body.length).toBeLessThanOrEqual(SNIPPET_CHARS);
      const hit = searchKnowledge(a.title, a.domain).find((r) => r.id === a.id);
      expect(hit?.snippet).toBe(a.body);
    }
  });
});
