import { APICallError, tool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent, type AgentSpec } from "../src/agents/runAgent";
import { MAX_INPUT_CHARS } from "../src/config";
import { buildNativeTools } from "../src/tools/native";
import type { RequestContext } from "../src/types";

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
const call = (toolName: string, input: unknown, id = "c1") => ({
  content: [
    { type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});

function makeCtx(signal: AbortSignal = new AbortController().signal): RequestContext {
  return { userId: "ana", role: "employee", sessionId: "s", trace: [], signal };
}

function makeSpec(tools: ToolSet = {}, maxSteps = 5): AgentSpec {
  return { id: "it", systemPrompt: () => "You are the IT agent.", tools: () => tools, maxSteps };
}

describe("runAgent", () => {
  it("answers without tools and returns a complete turn", async () => {
    const model = new MockLanguageModelV4({ doGenerate: text("Hello!") });
    const history: ModelMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "earlier answer" },
    ];
    const before = structuredClone(history);

    const r = await runAgent(makeSpec(), { model, history, userInput: "hi", ctx: makeCtx() });

    expect(r.status).toBe("ok");
    expect(r.text).toBe("Hello!");
    expect(r.newMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(r.newMessages[0]).toEqual({ role: "user", content: "hi" });
    expect(history).toEqual(before);

    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    expect(prompt[0]).toMatchObject({ role: "system", content: "You are the IT agent." });
    expect(prompt).toHaveLength(4); // system + 2 history + new user message
  });

  it("runs the real get_service_status tool and traces it", async () => {
    const ctx = makeCtx();
    const model = new MockLanguageModelV4({
      doGenerate: [call("get_service_status", { service: "vpn" }), text("VPN checked.")],
    });
    const tools = { get_service_status: buildNativeTools(ctx).get_service_status };

    const r = await runAgent(makeSpec(tools), { model, history: [], userInput: "vpn?", ctx });

    expect(r.status).toBe("ok");
    expect(r.newMessages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("updatedAt");
    expect(ctx.trace.map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
    expect(ctx.trace[0]).toMatchObject({
      agent: "it",
      tool: "get_service_status",
      input: { service: "vpn" },
    });
    expect(ctx.trace[1]).toMatchObject({ type: "tool_result", ok: true });
    expect(typeof ctx.trace[0]?.ts).toBe("number");
  });

  it("traces failed results, thrown errors and rejected calls with ok=false", async () => {
    const ctx = makeCtx();
    const tools = {
      soft_fail: tool({ inputSchema: z.object({}), execute: () => ({ ok: false, error: "nope" }) }),
      boom: tool({
        inputSchema: z.object({}),
        execute: (): { ok: boolean } => {
          throw new Error("kaboom");
        },
      }),
    };
    const model = new MockLanguageModelV4({
      doGenerate: [
        call("soft_fail", {}, "a"),
        call("boom", {}, "b"),
        call("no_such_tool", {}, "c"),
        text("Done, with problems."),
      ],
    });

    const r = await runAgent(makeSpec(tools), { model, history: [], userInput: "go", ctx });

    expect(r.status).toBe("ok");
    const results = ctx.trace.filter((e) => e.type === "tool_result");
    expect(results.map((e) => [e.tool, e.ok])).toEqual([
      ["soft_fail", false],
      ["boom", false],
      ["no_such_tool", false],
    ]);
  });

  it("fails honestly when the step limit is reached without a final answer", async () => {
    const model = new MockLanguageModelV4({ doGenerate: () => Promise.resolve(call("t", {})) });
    const tools = { t: tool({ inputSchema: z.object({}), execute: () => ({ ok: true }) }) };

    const r = await runAgent(makeSpec(tools, 2), {
      model,
      history: [],
      userInput: "loop",
      ctx: makeCtx(),
    });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(r.status).toBe("error");
    expect(r.text).toMatch(/step limit \(2\)/);
    expect(r.newMessages).toEqual([{ role: "user", content: "loop" }]);
  });

  it("returns status error when the final text is empty", async () => {
    const model = new MockLanguageModelV4({ doGenerate: text("   ") });
    const r = await runAgent(makeSpec(), { model, history: [], userInput: "hi", ctx: makeCtx() });
    expect(r.status).toBe("error");
    expect(r.text).toMatch(/empty/);
  });

  const hangUntilAbort = () =>
    new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });

  it("times out after the per-agent timeout", async () => {
    const r = await runAgent(makeSpec(), {
      model: hangUntilAbort(),
      history: [],
      userInput: "slow",
      ctx: makeCtx(),
      timeoutMs: 50,
    });
    expect(r.status).toBe("timeout");
    expect(r.newMessages).toHaveLength(1);
  });

  it("reports timeout when ctx.signal aborts", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const r = await runAgent(makeSpec(), {
      model: hangUntilAbort(),
      history: [],
      userInput: "slow",
      ctx: makeCtx(ac.signal),
      timeoutMs: 5_000,
    });
    expect(r.status).toBe("timeout");
  });

  describe("input limits (no model call)", () => {
    const cases: [string, string][] = [
      ["too long", "x".repeat(MAX_INPUT_CHARS + 1)],
      ["empty", ""],
      ["whitespace only", " \n\t "],
    ];
    it.each(cases)("rejects %s input", async (_name, userInput) => {
      const model = new MockLanguageModelV4({ doGenerate: text("never") });
      const r = await runAgent(makeSpec(), { model, history: [], userInput, ctx: makeCtx() });
      expect(r.status).toBe("error");
      expect(r.newMessages).toEqual([]);
      expect(model.doGenerateCalls).toHaveLength(0);
    });

    it("accepts input of exactly MAX_INPUT_CHARS", async () => {
      const model = new MockLanguageModelV4({ doGenerate: text("ok") });
      const r = await runAgent(makeSpec(), {
        model,
        history: [],
        userInput: "x".repeat(MAX_INPUT_CHARS),
        ctx: makeCtx(),
      });
      expect(r.status).toBe("ok");
    });
  });

  describe("error sanitization", () => {
    it("hides message and stack of unknown errors", async () => {
      const model = new MockLanguageModelV4({
        doGenerate: () => Promise.reject(new Error("boom sk-ant-SECRET123")),
      });
      const r = await runAgent(makeSpec(), { model, history: [], userInput: "hi", ctx: makeCtx() });
      expect(r.status).toBe("error");
      expect(JSON.stringify(r)).not.toMatch(/SECRET|sk-ant|\bat .*\(|stack/i);
    });

    it("exposes only the HTTP status of provider errors", async () => {
      const model = new MockLanguageModelV4({
        doGenerate: () =>
          Promise.reject(
            new APICallError({
              message: "rate limited for key sk-ant-SECRET123",
              url: "https://api.example.test",
              requestBodyValues: {},
              statusCode: 429,
              responseHeaders: { "x-api-key": "sk-ant-SECRET123" },
              responseBody: '{"error":"secret provider body"}',
              isRetryable: false,
            }),
          ),
      });
      const r = await runAgent(makeSpec(), { model, history: [], userInput: "hi", ctx: makeCtx() });
      expect(r.status).toBe("error");
      expect(r.text).toBe("The model provider returned an error (HTTP 429).");
      expect(JSON.stringify(r)).not.toMatch(/SECRET|secret provider body/);
    });
  });
});
