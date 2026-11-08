import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { env } from "cloudflare:test";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { ConnectMcpFn } from "../src/agents/orchestrator";
import { createApp } from "../src/app";
import { MAX_INPUT_CHARS } from "../src/config";
import { connectMcp } from "../src/mcp/client";
import { createKnowledgeServer } from "../src/mcp/server";
import type { TraceEvent } from "../src/types";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const text = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
});
const call = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: "c0", toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});

/** Text of the tool-result parts at the end of a prompt, serialised. */
function lastToolText(prompt: LanguageModelV4CallOptions["prompt"]): string {
  const last = prompt[prompt.length - 1];
  return last?.role === "tool" ? JSON.stringify(last.content) : "";
}

/**
 * One model serves orchestrator and HR specialist, so it is sequenced by call index:
 * 0 orchestrator delegates, 1 HR asks for the salary band, 2 HR finishes,
 * 3 orchestrator echoes the delegation result it received.
 */
function salaryModel() {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: (async (o: LanguageModelV4CallOptions) => {
      const i = n++;
      if (i === 0) return call("ask_hr_specialist", { task: "Salary band for Senior Developer?" });
      if (i === 1) return call("get_salary_band", { position: "Senior Developer" });
      if (i === 2) return text(`HR result: ${lastToolText(o.prompt)}`);
      return text(`Final: ${lastToolText(o.prompt)}`);
    }) as never,
  });
}
const plainModel = () => new MockLanguageModelV4({ doGenerate: (async () => text("hello")) as never });

const memConnect: ConnectMcpFn = (ctx, agent) =>
  connectMcp(ctx, agent, () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    void createKnowledgeServer().connect(serverT);
    return clientT;
  });

function appWith(model = plainModel()) {
  return createApp({ getModel: () => model, connectMcp: memConnect });
}
const chat = (app: ReturnType<typeof createApp>, user: string | null, body: unknown, raw = false) =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(user === null ? {} : { "X-User": user }) },
      body: raw ? (body as string) : JSON.stringify(body),
    },
    env,
  );
const get = (app: ReturnType<typeof createApp>, path: string, user?: string) =>
  app.request(path, { headers: user === undefined ? {} : { "X-User": user } }, env);

interface ChatOk {
  reply: string;
  status: string;
  trace: TraceEvent[];
}
const salaryResult = (trace: TraceEvent[]) =>
  trace.find((e) => e.type === "tool_result" && e.tool === "get_salary_band");

describe("POST /api/chat", () => {
  it.each(["ana", "marko"])("%s gets a reply, status and trace", async (user) => {
    const res = await chat(appWith(), user, { message: "hi" });
    expect(res.status).toBe(200);
    const body = await res.json<ChatOk>();
    expect(body.reply).toBe("hello");
    expect(body.status).toBe("ok");
    expect(body.trace.some((e) => e.type === "agent_start" && e.agent === "orchestrator")).toBe(true);
  });

  it("salary question: refused for employee, answered for manager (full path)", async () => {
    const ana = await (await chat(appWith(salaryModel()), "ana", { message: "salary?" })).json<ChatOk>();
    expect(salaryResult(ana.trace)).toMatchObject({ ok: false });
    expect(ana.reply).not.toContain("48000");

    const marko = await (await chat(appWith(salaryModel()), "marko", { message: "salary?" })).json<ChatOk>();
    expect(salaryResult(marko.trace)).toMatchObject({ ok: true });
    expect(marko.reply).toContain("48000");
  });

  it("ignores role and userId in the body", async () => {
    const res = await chat(appWith(salaryModel()), "ana", { message: "salary?", role: "manager", userId: "marko" });
    const body = await res.json<ChatOk>();
    expect(salaryResult(body.trace)).toMatchObject({ ok: false });
    expect(body.reply).not.toContain("48000");
  });

  it.each([
    ["missing message", { foo: 1 }],
    ["wrong type", { message: 42 }],
    ["empty after trim", { message: "   " }],
    ["too long", { message: "x".repeat(MAX_INPUT_CHARS + 1) }],
  ])("400 for %s", async (_name, body) => {
    const res = await chat(appWith(), "ana", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request", message: expect.any(String) });
  });

  it("400 for a non-JSON body", async () => {
    expect((await chat(appWith(), "ana", "not json", true)).status).toBe(400);
  });

  it("401 for unknown and missing X-User (also with an invalid body)", async () => {
    for (const user of ["eve", null]) {
      const res = await chat(appWith(), user, { message: "hi" });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
    expect((await chat(appWith(), null, { nope: true })).status).toBe(401);
  });

  it("unexpected failures are a generic 500 without stack or details", async () => {
    const boom = createApp({
      getModel: () => {
        throw new Error("secret-provider-detail at /src/x.ts:1:1");
      },
      connectMcp: memConnect,
    });
    const res = await chat(boom, "ana", { message: "hi" });
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: "internal_error", message: "Internal error." });
    expect(raw).not.toMatch(/secret|stack|\.ts/);
  });

  it("default deps without an API key give a generic 500", async () => {
    // .dev.vars may hold a real key: blank it so no network call can happen.
    const res = await createApp().request(
      "/api/chat",
      { method: "POST", headers: { "X-User": "ana" }, body: JSON.stringify({ message: "hi" }) },
      { ...env, ANTHROPIC_API_KEY: "" },
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("ANTHROPIC");
  });
});

describe("GET /api/users", () => {
  it("lists the two users without extra fields", async () => {
    const body = await (await get(appWith(), "/api/users")).json<{ users: unknown[] }>();
    expect(body.users).toEqual([
      { userId: "ana", label: "Ana (employee)", role: "employee" },
      { userId: "marko", label: "Marko (manager)", role: "manager" },
    ]);
  });
});

describe("GET /api/capabilities", () => {
  type Caps = { role: string; agents: { agent: string; capabilities: { id: string; available: boolean }[] }[] };
  const avail = (c: Caps, agent: string, id: string) =>
    c.agents.find((a) => a.agent === agent)?.capabilities.find((x) => x.id === id)?.available;

  it("differs between ana and marko and is grouped by agent", async () => {
    const ana = await (await get(appWith(), "/api/capabilities", "ana")).json<Caps>();
    const marko = await (await get(appWith(), "/api/capabilities", "marko")).json<Caps>();
    expect(ana.agents.map((a) => a.agent)).toEqual(["orchestrator", "it", "hr"]);
    expect(avail(ana, "hr", "get_salary_band")).toBe(false);
    expect(avail(marko, "hr", "get_salary_band")).toBe(true);
    expect(avail(ana, "it", "get_service_status")).toBe(true);
    expect(avail(ana, "hr", "get_service_status")).toBeUndefined(); // not an HR capability
    expect(ana).not.toEqual(marko);
  });

  it("401 without a known user", async () => {
    expect((await get(appWith(), "/api/capabilities")).status).toBe(401);
  });
});

describe("routing", () => {
  it("unknown /api route is a uniform 404", async () => {
    const res = await get(appWith(), "/api/nope", "ana");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Unknown API route." });
  });

  it("/api/_smoke is still gated", async () => {
    const res = await createApp().request("/api/_smoke", {}, { ...env, ENABLE_SMOKE: "" });
    expect(res.status).toBe(404);
  });
});
