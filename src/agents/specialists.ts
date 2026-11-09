import type { LanguageModel, ModelMessage, Tool, ToolSet } from "ai";
import { MAX_STEPS_SPECIALIST } from "../config";
import { MCP_UNAVAILABLE_NOTE, type McpConnection } from "../mcp/client";
import { describeUnavailable, filterTools, guardTool } from "../permissions/policy";
import type { CapabilityId } from "../permissions/registry";
import { skillsPromptSection } from "../skills/prompt";
import { buildNativeTools } from "../tools/native";
import { buildLoadSkillTool } from "../tools/skills";
import type { AgentId, RequestContext } from "../types";
import { runAgent, type AgentSpec, type RunAgentResult } from "./runAgent";

/**
 * IT and HR are two configurations of runAgent() (R1, R7). They differ only by data:
 * domain text, native tool keys and skills. Everything else is shared here.
 */
export type SpecialistId = Extract<AgentId, "it" | "hr">;

/** Native capability ids each specialist owns. The permission filter decides who may use them. */
const NATIVE_KEYS = {
  it: ["get_service_status"],
  hr: ["get_salary_band"],
} as const satisfies Record<SpecialistId, readonly Extract<CapabilityId, "get_service_status" | "get_salary_band">[]>;

/** Own instructions per agent (R7). Must not name the other domain or mention coordination roles. */
export const DOMAIN: Readonly<Record<SpecialistId, string>> = {
  it: [
    "You are the technical support assistant of Acme d.o.o.",
    "You answer technical questions and do basic troubleshooting.",
    "When a problem concerns a company service, check its status with the tool before giving advice.",
    "Give concrete steps the person can follow.",
    "Never promise that something will be fixed or repaired; you can only diagnose and advise.",
    "Say clearly when a problem needs escalation.",
  ].join(" "),
  hr: [
    "You are the people-operations assistant of Acme d.o.o.",
    "You answer questions about employee processes and company policies.",
    "Ground your answers in the knowledge base.",
    "Treat personal and salary-related data as sensitive and give only what your tools return.",
    "Never guess what an employee is entitled to.",
  ].join(" "),
};

const RULES: readonly string[] = [
  "Your reply is read by a coordinating assistant that writes the final answer for the user. Write for it, not for the user.",
  "Use your tools to ground facts. Never guess.",
  "Never offer or promise anything listed as not available to you.",
  "If a tool returns ok:false, forbidden or an error, or the knowledge base is unavailable, report exactly what could not be done and why, in plain words.",
  "If required information is missing, list it under Missing information instead of assuming.",
  "When a skill's description matches the task, load it with load_skill, then follow its steps.",
  "Reply in the language of the task.",
  "Keep the reply short and structured with these sections: Findings, Actions taken, Could not do, Missing information. Omit empty sections.",
  "Mention the titles of the knowledge base articles you used.",
  "If the task is outside your scope, say that it is outside your scope and stop. Do not suggest who could handle it.",
];

/** Structural subset of McpConnection: what the spec needs, nothing about the client's lifetime. */
export interface McpHandle {
  readonly tools: ToolSet;
  readonly unavailable: boolean;
}

/**
 * Union of this agent's native tools, MCP tools and load_skill, each guarded exactly once and
 * NOT yet filtered. MCP tools arrive already guarded from connectMcp and are not re-wrapped.
 * Exported so tests can prove the guard refuses even when the filter is bypassed.
 */
export function collectSpecialistTools(agent: SpecialistId, ctx: RequestContext, mcp: McpHandle): ToolSet {
  const native = buildNativeTools(ctx);
  const tools: Record<string, Tool> = {};
  for (const key of NATIVE_KEYS[agent]) {
    tools[key] = guardTool(key, native[key], ctx.role, agent);
  }
  Object.assign(tools, mcp.tools);
  const loadSkill = buildLoadSkillTool(ctx, agent);
  if (loadSkill !== undefined) {
    tools.load_skill = guardTool("load_skill", loadSkill, ctx.role, agent);
  }
  return tools;
}

/** Differences between roles come only from the tool set and describeUnavailable, never from branches. */
export function buildSpecialistPrompt(agent: SpecialistId, ctx: RequestContext, mcp: McpHandle): string {
  const unavailable = describeUnavailable(ctx.role, agent);
  const sections = [
    DOMAIN[agent],
    unavailable.length > 0 ? ["Not available to you:", ...unavailable.map((u) => `- ${u}`)].join("\n") : "",
    skillsPromptSection(agent),
    mcp.unavailable ? MCP_UNAVAILABLE_NOTE : "",
    ["Rules:", ...RULES.map((r) => `- ${r}`)].join("\n"),
  ];
  return sections.filter((s) => s !== "").join("\n\n");
}

/** Pure and synchronous. The MCP client is opened and closed by the caller (see runSpecialist). */
export function createSpecialistSpec(agent: SpecialistId, _ctx: RequestContext, mcp: McpHandle): AgentSpec {
  return {
    id: agent,
    // ctx comes from runAgent, so role is read per request.
    systemPrompt: (ctx) => buildSpecialistPrompt(agent, ctx, mcp),
    // The only filterTools call on the union (permissions = role ∩ agent).
    tools: (ctx) => filterTools(collectSpecialistTools(agent, ctx, mcp), ctx.role, agent),
    maxSteps: MAX_STEPS_SPECIALIST,
  };
}

export interface RunSpecialistOptions {
  readonly model: LanguageModel;
  readonly task: string;
  readonly history: readonly ModelMessage[];
  readonly ctx: RequestContext;
  /** Injected so tests can use the in-memory server. */
  readonly connectMcp: (ctx: RequestContext, agent: SpecialistId) => Promise<McpConnection>;
  readonly timeoutMs?: number;
}

/**
 * Connects MCP, runs the agent and always closes the client (success, failure, timeout).
 * Returns the runAgent result unchanged: no history handling, no agent_start/agent_end, no
 * DelegationResult (step 8b).
 *
 * NOTE: `connectMcp` may reject (unlike the normal degraded case, which the MCP client already
 * turns into `unavailable: true`). The caller, the delegation tool in step 8b, must wrap the
 * whole call in try/catch and map any failure to a DelegationResult status.
 */
export async function runSpecialist(agent: SpecialistId, options: RunSpecialistOptions): Promise<RunAgentResult> {
  const { model, task, history, ctx, connectMcp, timeoutMs } = options;
  const mcp = await connectMcp(ctx, agent);
  try {
    return await runAgent(createSpecialistSpec(agent, ctx, mcp), {
      model,
      history,
      userInput: task,
      ctx,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } finally {
    await mcp.close();
  }
}
