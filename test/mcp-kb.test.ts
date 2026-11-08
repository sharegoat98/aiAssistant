import { describe, expect, it } from "vitest";
import { SALARY_BANDS } from "../src/data/mock";
import { KB_ARTICLES } from "../src/data/kb";

describe("knowledge base content", () => {
  it("has 10 articles with unique ids across both domains", () => {
    expect(KB_ARTICLES).toHaveLength(10);
    expect(new Set(KB_ARTICLES.map((a) => a.id)).size).toBe(10);
    expect(KB_ARTICLES.filter((a) => a.domain === "it")).toHaveLength(5);
    expect(KB_ARTICLES.filter((a) => a.domain === "hr")).toHaveLength(5);
  });

  it("contains no salary figures (salary data is role-restricted)", () => {
    const text = KB_ARTICLES.map((a) => `${a.title} ${a.body}`).join("\n");
    const figures = SALARY_BANDS.flatMap((b) => [b.min, b.max]);
    for (const n of figures) {
      const raw = String(n);
      const head = raw.slice(0, -3);
      const tail = raw.slice(-3);
      const forms = [raw, `${head},${tail}`, `${head}.${tail}`, `${head} ${tail}`, `${head} ${tail}`, `${head}_${tail}`];
      for (const f of forms) {
        expect(text, `salary figure ${f} leaked into the KB`).not.toContain(f);
      }
    }
  });
});
