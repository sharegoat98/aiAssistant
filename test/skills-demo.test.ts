import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { runAgent, type AgentSpec } from "../src/agents/runAgent";
import { filterTools, guardTool } from "../src/permissions/policy";
import { skillsPromptSection } from "../src/skills/prompt";
import { buildNativeTools } from "../src/tools/native";
import { buildSkillTools } from "../src/tools/skills";
import type { RequestContext, TraceEvent } from "../src/types";

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

function makeCtx(): RequestContext {
  return { userId: "ana", role: "employee", sessionId: "s", trace: [], signal: new AbortController().signal };
}

/** IT agent as a test-local spec: real tools, prompt = base text + skill list (no bodies). */
function itSpec(ctx: RequestContext): AgentSpec {
  const status = filterTools(
    { get_service_status: guardTool("get_service_status", buildNativeTools(ctx).get_service_status, ctx.role, "it") },
    ctx.role,
    "it",
  );
  const tools: ToolSet = { ...status, ...buildSkillTools(ctx, "it") };
  return {
    id: "it",
    systemPrompt: () => `You are the Acme d.o.o. IT agent.\n\n${skillsPromptSection("it")}`,
    tools: () => tools,
    maxSteps: 5,
  };
}

const formatTrace = (events: readonly TraceEvent[]): string =>
  events
    .map((e, i) => {
      const detail =
        e.type === "tool_call"
          ? ` ${e.tool} ${JSON.stringify(e.input)}`
          : e.type === "tool_result"
            ? ` ${e.tool} ok=${e.ok} ${e.summary}`
            : e.type === "skill_loaded"
              ? ` ${e.skill}`
              : "";
      return `${String(i + 1).padStart(2, "0")} [${e.agent}] ${e.type}${detail}`;
    })
    .join("\n") + "\n";

describe("skill demo: VPN troubleshooting (R11)", () => {
  it("loads the skill on demand, applies its steps and answers from the real status", async () => {
    const ctx = makeCtx();
    const model = new MockLanguageModelV4({
      doGenerate: [
        call("load_skill", { name: "vpn-troubleshooting" }, "c1"),
        call("get_service_status", { service: "vpn" }, "c2"),
        text("The VPN is currently degraded (elevated latency, occasional disconnects). Please restart the client, reinstall it if needed and reconnect; I recommend escalating to IT support."),
      ],
    });

    const r = await runAgent(itSpec(ctx), { model, history: [], userInput: "My VPN is not working", ctx });
    expect(r.status).toBe("ok");

    // (a) the initial prompt lists the skill but does NOT contain its body.
    const first = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(first).toContain("vpn-troubleshooting");
    expect(first).not.toContain("SKILL-BODY-MARKER-VPN");
    expect(first).not.toContain("uninstall");

    // (b) the tool result delivers the body to the model on the next step.
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("SKILL-BODY-MARKER-VPN");

    // Call order and trace ordering.
    const calls = ctx.trace.filter((e) => e.type === "tool_call").map((e) => (e.type === "tool_call" ? e.tool : ""));
    expect(calls).toEqual(["load_skill", "get_service_status"]);
    const loadedAt = ctx.trace.findIndex((e) => e.type === "skill_loaded");
    const statusAt = ctx.trace.findIndex((e) => e.type === "tool_call" && e.tool === "get_service_status");
    expect(loadedAt).toBeGreaterThan(-1);
    expect(loadedAt).toBeLessThan(statusAt);
    expect(ctx.trace.filter((e) => e.type === "skill_loaded")).toHaveLength(1);

    // The final answer reflects the degraded status from the real tool.
    expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain("degraded");
    expect(r.text).toMatch(/degraded/);
    expect(r.text).toMatch(/reinstall/);

    // Readable trace for a reviewer.
    const readable = formatTrace(ctx.trace);
    console.log(`\nVPN skill demo trace:\n${readable}`);
    await expect(readable).toMatchFileSnapshot("./__fixtures__/vpn-demo-trace.txt");
  });

  it("HR cannot load an IT skill: refused, no skill_loaded in the trace", async () => {
    const ctx: RequestContext = { ...makeCtx() };
    const hrTools = buildSkillTools(ctx, "hr");
    const load = hrTools.load_skill;
    const refused = await load?.execute?.({ name: "vpn-troubleshooting" }, { toolCallId: "t", messages: [], context: undefined });
    expect(refused).toMatchObject({ ok: false, error: "not_available" });
    expect(ctx.trace.some((e) => e.type === "skill_loaded")).toBe(false);
  });
});
