import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import * as runAgentModule from "../src/agents/runAgent";
import {
  DOMAIN,
  buildSpecialistPrompt,
  collectSpecialistTools,
  createSpecialistSpec,
  runSpecialist,
  type SpecialistId,
} from "../src/agents/specialists";
import { connectMcp, type McpConnection, type McpTransportFactory } from "../src/mcp/client";
import { createKnowledgeServer } from "../src/mcp/server";
import type { RequestContext, Role } from "../src/types";

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
const call = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});

function makeCtx(role: Role = "employee", signal: AbortSignal = new AbortController().signal): RequestContext {
  return { userId: "u", role, sessionId: "s", trace: [], signal };
}

function inMemory(server: McpServer = createKnowledgeServer()): McpTransportFactory {
  return () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    void server.connect(serverT);
    return clientT;
  };
}

const failingTransport: McpTransportFactory = () => {
  const t: Transport = {
    start: () => Promise.reject(new Error("ECONNREFUSED")),
    send: () => Promise.reject(new Error("nope")),
    close: () => Promise.resolve(),
  };
  return t;
};

/** connectMcp bound to a factory; records the connections it hands out and counts close() calls. */
function trackedConnect(factory: McpTransportFactory = inMemory()) {
  const closes = { count: 0 };
  const connect = async (ctx: RequestContext, agent: SpecialistId): Promise<McpConnection> => {
    const conn = await connectMcp(ctx, agent, factory);
    return {
      ...conn,
      close: async () => {
        closes.count += 1;
        await conn.close();
      },
    };
  };
  return { connect, closes };
}

const sortedKeys = (tools: object): string[] => Object.keys(tools).sort();
const FORBIDDEN = /orchestrator|delegat|specialist|ask_it|ask_hr/i;
const otherDomainName: Record<SpecialistId, RegExp> = { it: /\bHR\b/, hr: /\bIT\b/ };
const COMBOS: readonly (readonly [SpecialistId, Role])[] = [
  ["it", "employee"],
  ["it", "manager"],
  ["hr", "employee"],
  ["hr", "manager"],
];

/** Spec built from a live in-memory MCP connection, closed afterwards. */
async function withSpec<T>(
  agent: SpecialistId,
  role: Role,
  fn: (spec: ReturnType<typeof createSpecialistSpec>, ctx: RequestContext) => T | Promise<T>,
): Promise<T> {
  const ctx = makeCtx(role);
  const mcp = await connectMcp(ctx, agent, inMemory());
  try {
    return await fn(createSpecialistSpec(agent, ctx, mcp), ctx);
  } finally {
    await mcp.close();
  }
}

describe("tool sets as the model sees them (after filterTools)", () => {
  const expected: Record<string, string[]> = {
    "it/employee": ["get_service_status", "kb_search", "load_skill"],
    "it/manager": ["get_service_status", "kb_search", "load_skill"],
    "hr/employee": ["kb_search", "load_skill"],
    "hr/manager": ["get_salary_band", "kb_search", "load_skill"],
  };

  it.each(COMBOS)("%s as %s has exactly the expected keys", async (agent, role) => {
    await withSpec(agent, role, (spec, ctx) => {
      const keys = sortedKeys(spec.tools(ctx));
      expect(keys).toEqual(expected[`${agent}/${role}`]);
      expect(keys.some((k) => k.startsWith("ask_"))).toBe(false);
    });
  });

  it("IT never has get_salary_band, HR never has get_service_status", async () => {
    for (const role of ["employee", "manager"] as const) {
      await withSpec("it", role, (spec, ctx) => expect(spec.tools(ctx)).not.toHaveProperty("get_salary_band"));
      await withSpec("hr", role, (spec, ctx) => expect(spec.tools(ctx)).not.toHaveProperty("get_service_status"));
    }
  });

  it("ctx.role actually determines the tool set of the same spec", async () => {
    const mcp = await connectMcp(makeCtx("manager"), "hr", inMemory());
    try {
      const spec = createSpecialistSpec("hr", makeCtx("manager"), mcp);
      expect(sortedKeys(spec.tools(makeCtx("manager")))).toContain("get_salary_band");
      expect(sortedKeys(spec.tools(makeCtx("employee")))).not.toContain("get_salary_band");
    } finally {
      await mcp.close();
    }
  });
});

describe("guard when the filter is bypassed", () => {
  it("HR for employee: the unfiltered tool exists but refuses to execute", async () => {
    const ctx = makeCtx("employee");
    const tools = collectSpecialistTools("hr", ctx, { tools: {}, unavailable: false });
    expect(tools).toHaveProperty("get_salary_band");
    const result = await tools.get_salary_band?.execute?.(
      { position: "Senior Developer" },
      { toolCallId: "t", messages: [], context: undefined },
    );
    expect(result).toMatchObject({ error: "forbidden" });
  });
});

describe("prompts", () => {
  it("domain texts differ and contain no forbidden words", () => {
    expect(DOMAIN.it).not.toBe(DOMAIN.hr);
    for (const agent of ["it", "hr"] as const) {
      expect(DOMAIN[agent]).not.toMatch(FORBIDDEN);
      expect(DOMAIN[agent]).not.toMatch(otherDomainName[agent]);
    }
  });

  it("describeUnavailable text appears for employee+hr and not for manager+hr", () => {
    const mcp = { tools: {}, unavailable: false };
    const employee = buildSpecialistPrompt("hr", makeCtx("employee"), mcp);
    const manager = buildSpecialistPrompt("hr", makeCtx("manager"), mcp);
    expect(employee).toContain("Not available to you");
    expect(employee).toContain("access to salary bands");
    expect(manager).not.toContain("Not available to you");
    expect(manager).not.toContain("access to salary bands");
  });

  it("states the knowledge base is unavailable only when MCP could not connect", async () => {
    const ctx = makeCtx();
    const down = await connectMcp(ctx, "it", failingTransport);
    expect(buildSpecialistPrompt("it", ctx, down)).toContain("knowledge base is currently unavailable");
    expect(buildSpecialistPrompt("it", ctx, { tools: {}, unavailable: false })).not.toContain(
      "knowledge base is currently unavailable",
    );
  });

  it.each(COMBOS)("%s as %s: no forbidden words, no skill body, no secrets", (agent, role) => {
    for (const unavailable of [false, true]) {
      const prompt = buildSpecialistPrompt(agent, makeCtx(role), { tools: {}, unavailable });
      expect(prompt).not.toMatch(FORBIDDEN);
      expect(prompt).not.toMatch(otherDomainName[agent]);
      expect(prompt).not.toContain("SKILL-BODY-MARKER");
      expect(prompt).toContain("Findings");
      expect(prompt).toContain("Missing information");
    }
  });
});

describe("runSpecialist through the real runAgent", () => {
  it("IT: loads the skill (body only via tool result), checks status, closes the client", async () => {
    const ctx = makeCtx("employee");
    const { connect, closes } = trackedConnect();
    const model = new MockLanguageModelV4({
      doGenerate: [
        call("load_skill", { name: "vpn-troubleshooting" }, "c1"),
        call("get_service_status", { service: "vpn" }, "c2"),
        call("kb_search", { query: "vpn" }, "c3"),
        text("Findings: VPN is degraded."),
      ],
    });
    const r = await runSpecialist("it", { model, task: "My VPN fails", history: [], ctx, connectMcp: connect });

    expect(Object.keys(r).sort()).toEqual(["newMessages", "status", "text"]);
    expect(r.status).toBe("ok");
    expect(r.text).toBe("Findings: VPN is degraded.");
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain("SKILL-BODY-MARKER-VPN");
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("SKILL-BODY-MARKER-VPN");
    expect(ctx.trace.some((e) => e.type === "skill_loaded")).toBe(true);
    const results = ctx.trace.filter((e) => e.type === "tool_result");
    expect(results.map((e) => (e.type === "tool_result" ? [e.tool, e.ok] : []))).toEqual([
      ["load_skill", true],
      ["get_service_status", true],
      ["kb_search", true],
    ]);
    // Only the specialist's own agent id, no lifecycle events (step 8b).
    expect(ctx.trace.some((e) => e.type === "agent_start" || e.type === "agent_end")).toBe(false);
    expect(closes.count).toBe(1);
  });

  it("HR manager: get_salary_band works", async () => {
    const ctx = makeCtx("manager");
    const { connect, closes } = trackedConnect();
    const model = new MockLanguageModelV4({
      doGenerate: [call("get_salary_band", { position: "Senior Developer" }, "c1"), text("Band found.")],
    });
    const r = await runSpecialist("hr", { model, task: "Band for Senior Developer?", history: [], ctx, connectMcp: connect });
    expect(r.status).toBe("ok");
    expect(ctx.trace.find((e) => e.type === "tool_result" && e.tool === "get_salary_band")).toMatchObject({ ok: true });
    expect(closes.count).toBe(1);
  });

  it("HR employee: get_salary_band is not a known tool for the model", async () => {
    const ctx = makeCtx("employee");
    const { connect } = trackedConnect();
    const model = new MockLanguageModelV4({
      doGenerate: [call("get_salary_band", { position: "Senior Developer" }, "c1"), text("I cannot look that up.")],
    });
    const r = await runSpecialist("hr", { model, task: "Band for Senior Developer?", history: [], ctx, connectMcp: connect });
    expect(r.status).toBe("ok");
    expect(ctx.trace.find((e) => e.type === "tool_result" && e.tool === "get_salary_band")).toMatchObject({ ok: false });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("access to salary bands");
  });

  it("closes the client on model failure", async () => {
    const { connect, closes } = trackedConnect();
    const model = new MockLanguageModelV4({ doGenerate: () => Promise.reject(new Error("boom")) });
    const r = await runSpecialist("it", { model, task: "hi", history: [], ctx: makeCtx(), connectMcp: connect });
    expect(r.status).toBe("error");
    expect(closes.count).toBe(1);
  });

  it("closes the client on timeout", async () => {
    const { connect, closes } = trackedConnect();
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });
    const r = await runSpecialist("it", {
      model,
      task: "hi",
      history: [],
      ctx: makeCtx(),
      connectMcp: connect,
      timeoutMs: 50,
    });
    expect(r.status).toBe("timeout");
    expect(closes.count).toBe(1);
  });

  it("closes the client when runAgent itself rejects", async () => {
    const { connect, closes } = trackedConnect();
    vi.spyOn(runAgentModule, "runAgent").mockRejectedValueOnce(new Error("agent blew up"));
    const model = new MockLanguageModelV4({ doGenerate: text("never") });
    await expect(
      runSpecialist("it", { model, task: "hi", history: [], ctx: makeCtx(), connectMcp: connect }),
    ).rejects.toThrow("agent blew up");
    expect(closes.count).toBe(1);
    vi.restoreAllMocks();
  });

  it("unreachable MCP: no kb_search, mcp_unavailable traced, the run still works", async () => {
    const ctx = makeCtx();
    const { connect } = trackedConnect(failingTransport);
    const model = new MockLanguageModelV4({
      doGenerate: [call("get_service_status", { service: "email" }, "c1"), text("Email is fine; knowledge base unavailable.")],
    });
    const r = await runSpecialist("it", { model, task: "Is email up?", history: [], ctx, connectMcp: connect });

    expect(r.status).toBe("ok");
    expect(ctx.trace.some((e) => e.type === "mcp_unavailable")).toBe(true);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("knowledge base is currently unavailable");
    expect(prompt).not.toContain('"name":"kb_search"');
    const mcp = await connect(ctx, "it");
    expect(createSpecialistSpec("it", ctx, mcp).tools(ctx)).not.toHaveProperty("kb_search");
  });
});
