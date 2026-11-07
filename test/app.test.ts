import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import fixture from "./fixture.md";

describe("worker", () => {
  it("GET /health returns {ok:true}", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes the SESSION Durable Object binding", () => {
    expect(typeof env.SESSION.idFromName).toBe("function");
  });

  it("loads .md files as Text", () => {
    expect(fixture).toContain("Fixture loaded as Text");
  });
});

describe("GET /api/_smoke", () => {
  it("is 404 when ENABLE_SMOKE is not set", async () => {
    const res = await app.request("/api/_smoke", {}, { ...env, ENABLE_SMOKE: "" });
    expect(res.status).toBe(404);
  });

  it("returns a clear error when the API key is missing (no network call)", async () => {
    const res = await app.request(
      "/api/_smoke",
      {},
      { ...env, ENABLE_SMOKE: "true", ANTHROPIC_API_KEY: "" },
    );
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("ANTHROPIC_API_KEY is not set");
  });
});
