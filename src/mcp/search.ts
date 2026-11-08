import { KB_ARTICLES, type KbArticle, type KbDomain } from "../data/kb";

export const MAX_RESULTS = 3;
/**
 * Upper cap on the text returned per result. KB articles are short (well under 1000 chars), so
 * the snippet is the complete article; the cap only bounds a future oversized article.
 */
export const SNIPPET_CHARS = 2_000;
const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

export interface SearchResult {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
}

function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0))];
}

function makeSnippet(body: string): string {
  if (body.length <= SNIPPET_CHARS) return body;
  const cut = body.slice(0, SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Case-insensitive keyword search within one domain. Score = per-token substring hits
 * (title weighted higher than body). Order is deterministic: score desc, then id asc.
 */
export function searchKnowledge(
  query: string,
  domain: KbDomain,
  articles: readonly KbArticle[] = KB_ARTICLES,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return articles
    .filter((a) => a.domain === domain)
    .map((a) => {
      const title = a.title.toLowerCase();
      const body = a.body.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t)) score += TITLE_WEIGHT;
        if (body.includes(t)) score += BODY_WEIGHT;
      }
      return { article: a, score };
    })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || x.article.id.localeCompare(y.article.id))
    .slice(0, MAX_RESULTS)
    .map(({ article }) => ({
      id: article.id,
      title: article.title,
      snippet: makeSnippet(article.body),
    }));
}
