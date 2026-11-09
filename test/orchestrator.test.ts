import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import type { Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  buildOrchestratorPrompt,
  collectOrchestratorTools,
  createInMemoryHistory,
  createOrchestratorSpec,
  runOrchestrator,
  type ConnectMcpFn,
  type OrchestratorDeps,
} from "../src/agents/orchestrator";
import type { RunAgentResult } from "../src/agents/runAgent";
import { runSpecialist } from "../src/agents/specialists";
import { MAX_DELEGATIONS_PER_REQUEST } from "../src/config";
import { SALARY_BANDS } from "../src/data/mock";
import { connectMcp, type McpTransportFactory } from "../src/mcp/client";
import { createKnowledgeServer } from "../src/mcp/server";
import { guardTool } from "../src/permissions/policy";
import { listSkills } from "../src/skills/loader";
import type { DelegationResult, RequestContext, Role, TraceEvent } from "../src/types";

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
const calls = (...cs: readonly (readonly [string, unknown])[]) => ({
  content: cs.map(([toolName, input], i) => ({
    type: "tool-call" as const,
    toolCallId: `c${i}`,
    toolName,
    input: JSON.stringify(input),
  })),
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Scripted model: `script(callIndex, prompt)` returns the result of that call. */
function scripted(script: (n: number, prompt: LanguageModelV4CallOptions["prompt"]) => unknown) {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: (async (options: LanguageModelV4CallOptions) => script(n++, options.prompt)) as never,
  });
}
const hangUntilAbort = () =>
  new MockLanguageModelV4({
    doGenerate: (({ abortSignal }: LanguageModelV4CallOptions) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
      })) as never,
  });

/** Output values of the tool-result parts in the last message of a prompt. */
function lastToolOutputs(prompt: LanguageModelV4CallOptions["prompt"]): unknown[] {
  const last = prompt[prompt.length - 1];
  if (last?.role !== "tool") return [];
  return last.content.flatMap((p) => (p.type === "tool-result" ? [p.output] : []));
}
function delegationResults(prompt: LanguageModelV4CallOptions["prompt"]): DelegationResult[] {
  return lastToolOutputs(prompt).map((o) => (o as { value: DelegationResult }).value);
}

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
const memConnect: ConnectMcpFn = (ctx, agent) => connectMcp(ctx, agent, inMemory());

function deps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    model: scripted(() => text("unused")),
    specialistHistory: createInMemoryHistory(),
    connectMcp: memConnect,
    ...over,
  };
}
const fakeRun =
  (result: Partial<RunAgentResult> = {}): typeof runSpecialist =>
  async () => ({ status: "ok", text: "fake answer", newMessages: [{ role: "user", content: "t" }], ...result });

const execOpts = { toolCallId: "t", messages: [], context: undefined };
async function exec(tools: ReturnType<typeof collectOrchestratorTools>, key: string, input: unknown): Promise<DelegationResult> {
  return (await tools[key]?.execute?.(input, execOpts)) as DelegationResult;
}
const ev = <T extends TraceEvent["type"]>(ctx: RequestContext, type: T, agent: string) =>
  ctx.trace.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type && e.agent === agent);

describe("(a) concurrency", () => {
  it("two delegations in one step overlap: total ≈ max, not sum", async () => {
    const slow = (t: string) =>
      new MockLanguageModelV4({ doGenerate: (async () => (await sleep(100), text(t))) as never });
    const orchestrator = scripted((n) =>
      n === 0 ? calls(["ask_it_specialist", { task: "vpn?" }], ["ask_hr_specialist", { task: "leave?" }]) : text("combined"),
    );
    const ctx = makeCtx();
    const t0 = Date.now();
    const r = await runOrchestrator({
      ...deps({ model: orchestrator, specialistModels: { it: slow("it done"), hr: slow("hr done") } }),
      userInput: "both",
      history: [],
      ctx,
    });
    const elapsed = Date.now() - t0;
    expect(r.status).toBe("ok");
    expect(r.reply).toBe("combined");
    expect(elapsed).toBeLessThan(160);
    const [it] = ev(ctx, "agent_start", "it");
    const [hr] = ev(ctx, "agent_start", "hr");
    const [itEnd] = ev(ctx, "agent_end", "it");
    const [hrEnd] = ev(ctx, "agent_end", "hr");
    expect(Math.max(it!.ts, hr!.ts)).toBeLessThan(Math.min(itEnd!.ts, hrEnd!.ts));
    expect(it?.task).toBe("vpn?");
  });
});

describe("(b) sequential with forwarded result", () => {
  it("second task contains a value from the first result and starts after it ended", async () => {
    let itTask = "";
    const orchestrator = scripted((n, prompt) => {
      if (n === 0) return calls(["ask_hr_specialist", { task: "What is my badge code?" }]);
      if (n === 1) {
        const code = /ZX-\d+/.exec(delegationResults(prompt)[0]?.content ?? "")?.[0] ?? "none";
        return calls(["ask_it_specialist", { task: `Register badge ${code} in the door system` }]);
      }
      return text("all done");
    });
    const hr = new MockLanguageModelV4({ doGenerate: (async () => (await sleep(30), text("Badge code ZX-4417"))) as never });
    const it_ = scripted((_, prompt) => {
      const user = prompt.find((m) => m.role === "user");
      itTask = JSON.stringify(user?.content);
      return text("registered");
    });
    const ctx = makeCtx();
    const r = await runOrchestrator({
      ...deps({ model: orchestrator, specialistModels: { hr, it: it_ } }),
      userInput: "x",
      history: [],
      ctx,
    });
    expect(r.reply).toBe("all done");
    expect(itTask).toContain("ZX-4417");
    expect(ev(ctx, "agent_start", "it")[0]!.ts).toBeGreaterThanOrEqual(ev(ctx, "agent_end", "hr")[0]!.ts);
    expect(r.delegations).toBe(2);
  });
});

describe("(c) timeouts", () => {
  it("a hanging specialist yields timeout and the orchestrator answers honestly", async () => {
    let seen: DelegationResult | undefined;
    const orchestrator = scripted((n, prompt) => {
      if (n === 0) return calls(["ask_hr_specialist", { task: "leave?" }]);
      seen = delegationResults(prompt)[0];
      return text(seen?.status === "timeout" ? "I could not get the HR answer: it timed out." : "?");
    });
    const ctx = makeCtx();
    const r = await runOrchestrator({
      ...deps({ model: orchestrator, specialistModels: { hr: hangUntilAbort() }, specialistTimeoutMs: 50 }),
      userInput: "x",
      history: [],
      ctx,
    });
    expect(seen).toMatchObject({ status: "timeout", agent: "hr" });
    expect(r.reply).toMatch(/could not.*timed out/);
    expect(ev(ctx, "agent_end", "hr")[0]?.status).toBe("timeout");
  });

  it("aborting ctx.signal ends both specialists with timeout", async () => {
    const ac = new AbortController();
    const ctx = makeCtx("employee", ac.signal);
    const tools = collectOrchestratorTools(
      ctx,
      deps({ specialistModels: { it: hangUntilAbort(), hr: hangUntilAbort() } }),
      { used: 0 },
    );
    const both = Promise.all([exec(tools, "ask_it_specialist", { task: "a" }), exec(tools, "ask_hr_specialist", { task: "b" })]);
    setTimeout(() => ac.abort(), 30);
    const [a, b] = await both;
    expect(a.status).toBe("timeout");
    expect(b.status).toBe("timeout");
  });
});

describe("(d) role reaches the specialist", () => {
  it("the specialist receives the identical ctx object", async () => {
    const seen: RequestContext[] = [];
    const run: typeof runSpecialist = async (_a, o) => (seen.push(o.ctx), { status: "ok", text: "x", newMessages: [] });
    const ctx = makeCtx("manager");
    const tools = collectOrchestratorTools(ctx, deps({ runSpecialist: run }), { used: 0 });
    await exec(tools, "ask_hr_specialist", { task: "t" });
    expect(seen[0]).toBe(ctx);
    expect(seen[0]?.role).toBe("manager");
  });

  it.each([
    ["employee", false],
    ["manager", true],
  ] as const)("full path: %s get_salary_band works=%s", async (role, works) => {
    const hr = scripted((n) =>
      n === 0 ? calls(["get_salary_band", { position: "Senior Developer" }]) : text("hr finished"),
    );
    const orchestrator = scripted((n) => (n === 0 ? calls(["ask_hr_specialist", { task: "salary?" }]) : text("ok")));
    const ctx = makeCtx(role);
    await runOrchestrator({ ...deps({ model: orchestrator, specialistModels: { hr } }), userInput: "x", history: [], ctx });
    const result = ev(ctx, "tool_result", "hr").find((e) => e.tool === "get_salary_band");
    expect(result?.ok).toBe(works);
  });
});

describe("(e) tool set and guard", () => {
  it.each(["employee", "manager"] as const)("orchestrator has exactly the two ask_* tools (%s)", (role) => {
    const ctx = makeCtx(role);
    const spec = createOrchestratorSpec(deps(), { used: 0 });
    expect(Object.keys(spec.tools(ctx)).sort()).toEqual(["ask_hr_specialist", "ask_it_specialist"]);
  });

  it("guardTool refuses ask_* for a specialist agent id", async () => {
    const tools = collectOrchestratorTools(makeCtx(), deps({ runSpecialist: fakeRun() }), { used: 0 });
    for (const key of ["ask_it_specialist", "ask_hr_specialist"]) {
      for (const agent of ["it", "hr"] as const) {
        const g = guardTool(key, tools[key] as Tool, "employee", agent);
        expect(await g.execute?.({ task: "t" }, execOpts)).toMatchObject({ error: "forbidden" });
      }
    }
  });

  it("a guard refusal reaches the model as a DelegationResult", async () => {
    const bad = makeCtx("guest" as unknown as Role);
    const run = vi.fn(fakeRun());
    const tools = collectOrchestratorTools(bad, deps({ runSpecialist: run }), { used: 0 });
    const r = await exec(tools, "ask_it_specialist", { task: "t" });
    expect(r).toMatchObject({ status: "forbidden", agent: "it" });
    expect(typeof r.content).toBe("string");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("(f) delegation budget", () => {
  it("calls beyond the budget are unavailable and run nothing", async () => {
    const run = vi.fn(fakeRun());
    const tools = collectOrchestratorTools(makeCtx(), deps({ runSpecialist: run }), { used: 0 });
    const results = await Promise.all(
      Array.from({ length: MAX_DELEGATIONS_PER_REQUEST + 2 }, () => exec(tools, "ask_it_specialist", { task: "t" })),
    );
    expect(results.filter((r) => r.status === "ok")).toHaveLength(MAX_DELEGATIONS_PER_REQUEST);
    expect(results.filter((r) => r.status === "unavailable")).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(MAX_DELEGATIONS_PER_REQUEST);
  });

  it("the budget is per request, not per module", async () => {
    const run = fakeRun();
    for (let i = 0; i < 2; i++) {
      const tools = collectOrchestratorTools(makeCtx(), deps({ runSpecialist: run }), { used: 0 });
      for (let j = 0; j < MAX_DELEGATIONS_PER_REQUEST; j++) {
        expect((await exec(tools, "ask_hr_specialist", { task: "t" })).status).toBe("ok");
      }
    }
  });
});

describe("(g) the tool never throws", () => {
  it("connectMcp rejecting -> unavailable, no message leak", async () => {
    const connect: ConnectMcpFn = () => Promise.reject(new Error("secret-boom"));
    const ctx = makeCtx();
    const tools = collectOrchestratorTools(ctx, deps({ connectMcp: connect }), { used: 0 });
    const r = await exec(tools, "ask_it_specialist", { task: "t" });
    expect(r.status).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("secret-boom");
    expect(ev(ctx, "agent_end", "it")[0]?.status).toBe("unavailable");
  });

  it("runSpecialist rejecting -> error", async () => {
    const run: typeof runSpecialist = () => Promise.reject(new Error("secret-boom"));
    const tools = collectOrchestratorTools(makeCtx(), deps({ runSpecialist: run }), { used: 0 });
    const r = await exec(tools, "ask_hr_specialist", { task: "t" });
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("secret-boom");
  });

  it("runAgent error -> error", async () => {
    const tools = collectOrchestratorTools(
      makeCtx(),
      deps({ runSpecialist: fakeRun({ status: "error", text: "The agent failed due to an internal error." }) }),
      { used: 0 },
    );
    expect((await exec(tools, "ask_it_specialist", { task: "t" })).status).toBe("error");
  });

  it("invalid task -> error, directly and through the model path", async () => {
    const run = vi.fn(fakeRun());
    const tools = collectOrchestratorTools(makeCtx(), deps({ runSpecialist: run }), { used: 0 });
    expect((await exec(tools, "ask_it_specialist", { task: "   " })).status).toBe("error");
    expect((await exec(tools, "ask_it_specialist", { task: "x".repeat(5000) })).status).toBe("error");
    expect((await exec(tools, "ask_it_specialist", undefined)).status).toBe("error");
    expect(run).not.toHaveBeenCalled();

    const orchestrator = scripted((n) => (n === 0 ? calls(["ask_it_specialist", { task: "" }]) : text("sorry")));
    const r = await runOrchestrator({ ...deps({ model: orchestrator }), userInput: "x", history: [], ctx: makeCtx() });
    expect(r.status).toBe("ok");
  });
});

describe("(h) history", () => {
  it("only ok rounds are appended", async () => {
    const history = createInMemoryHistory();
    const msgs = [{ role: "user" as const, content: "t" }];
    const tools = (run: typeof runSpecialist) =>
      collectOrchestratorTools(makeCtx(), deps({ specialistHistory: history, runSpecialist: run }), { used: 0 });
    await exec(tools(fakeRun({ status: "error", newMessages: msgs })), "ask_it_specialist", { task: "t" });
    await exec(tools(fakeRun({ status: "timeout", newMessages: msgs })), "ask_it_specialist", { task: "t" });
    expect(await history.get("it")).toEqual([]);
    await exec(tools(fakeRun({ newMessages: msgs })), "ask_it_specialist", { task: "t" });
    expect(await history.get("it")).toEqual(msgs);
    expect(await history.get("hr")).toEqual([]);
  });

  it("a specialist reads only its own history", async () => {
    const history = createInMemoryHistory();
    await history.append("hr", [{ role: "user", content: "hr secret" }]);
    const seen: unknown[] = [];
    const run: typeof runSpecialist = async (_a, o) => (seen.push(o.history), { status: "ok", text: "x", newMessages: [] });
    const tools = collectOrchestratorTools(makeCtx(), deps({ specialistHistory: history, runSpecialist: run }), { used: 0 });
    await exec(tools, "ask_it_specialist", { task: "t" });
    expect(seen[0]).toEqual([]);
  });
});

describe("(i) prompt", () => {
  const employee = buildOrchestratorPrompt(makeCtx("employee"));
  const manager = buildOrchestratorPrompt(makeCtx("manager"));

  it("employee gets the registry-generated restriction, manager does not", () => {
    expect(employee).toContain("Restrictions for this user:");
    expect(employee).toContain("The user's role does not allow: access to salary bands");
    expect(employee).not.toContain("checking the status of company services");
    expect(manager).not.toContain("Restrictions for this user");
    expect(manager).not.toContain("does not allow");
  });

  it("has the required rules and no leaks", () => {
    for (const p of [employee, manager]) {
      expect(p).toContain("SAME step");
      expect(p).toContain("ONE short follow-up question");
      expect(p).toContain("self-contained");
      expect(p).toContain("Never invent");
      for (const s of [...listSkills("it"), ...listSkills("hr")]) expect(p).not.toContain(s.name);
      for (const b of SALARY_BANDS) expect(p).not.toContain(String(b.max));
      expect(p).not.toMatch(/sk-ant|API_KEY/i);
    }
  });
});

describe("(i2) identity and missing-tool rules", () => {
  it.each(["employee", "manager"] as const)("prompt contains both rules (%s)", (role) => {
    const p = buildOrchestratorPrompt(makeCtx(role));
    expect(p).toContain("already identified by the system");
    expect(p).toContain("Never ask the user for their name, employee ID or credentials");
    expect(p).toContain("never imply that giving such details would unlock a lookup");
    expect(p).toContain("no tool exists for it, say that it cannot be done here");
    expect(p).toContain("Do not suggest a way the user could make it work through this assistant");
    expect(p).toContain("for example the HR portal");
  });
});

describe("(i3) task text rule", () => {
  it.each(["employee", "manager"] as const)("prompt forbids adding restrictions to tasks (%s)", (role) => {
    const p = buildOrchestratorPrompt(makeCtx(role));
    expect(p).toContain("A task text describes only what is needed from the helper");
    expect(p).toContain("Never add restrictions, permission statements or prohibitions to a task");
    expect(p).toContain("access rules are enforced by the system, not by you");
  });
});

describe("(j) direct answer", () => {
  it("a follow-up question without tool calls is ok with zero delegations", async () => {
    const model = scripted(() => text("Which service do you mean?"));
    const ctx = makeCtx();
    const r = await runOrchestrator({ ...deps({ model }), userInput: "it is broken", history: [], ctx });
    expect(r).toMatchObject({ status: "ok", reply: "Which service do you mean?", delegations: 0 });
    expect(r.newMessages[0]).toEqual({ role: "user", content: "it is broken" });
    expect(ev(ctx, "agent_start", "orchestrator")).toHaveLength(1);
    expect(ev(ctx, "agent_end", "orchestrator")[0]?.status).toBe("ok");
    expect(ctx.trace.some((e) => e.agent !== "orchestrator")).toBe(false);
  });
});

describe("production MCP wiring", () => {
  it("default connectMcp reaches the KB in-process without any fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const hr = scripted((n) => (n === 0 ? calls(["kb_search", { query: "leave" }]) : text("found")));
      const ctx = makeCtx();
      const { connectMcp: _omit, ...rest } = deps({ specialistModels: { hr } });
      const tools = collectOrchestratorTools(ctx, rest, { used: 0 });
      const r = await exec(tools, "ask_hr_specialist", { task: "leave policy" });
      expect(r.status).toBe("ok");
      expect(ev(ctx, "tool_result", "hr").find((e) => e.tool === "kb_search")?.ok).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
