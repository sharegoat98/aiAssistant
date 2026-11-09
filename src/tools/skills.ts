import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { filterTools, guardTool } from "../permissions/policy";
import { loadSkill, skillNamesFor, type LoadSkillResult } from "../skills/loader";
import type { AgentId, RequestContext } from "../types";

/**
 * The `load_skill` tool for one agent, or undefined when the agent has no skills
 * (z.enum cannot be empty, and an unusable tool must not be exposed). The input enum lists
 * only that agent's skills; execute re-checks scope through loadSkill (defense in depth).
 * `skill_loaded` is traced only for a successful load.
 */
export function buildLoadSkillTool(ctx: RequestContext, agent: AgentId): Tool | undefined {
  const [first, ...rest] = skillNamesFor(agent);
  if (first === undefined) return undefined;
  return tool({
    description:
      "Load the full step-by-step instructions of a skill by name. " +
      "Use it when the request matches one of the skills listed in your instructions, then follow the returned steps. " +
      "Returns { ok: true, name, instructions } or { ok: false, error, available }.",
    inputSchema: z.object({
      name: z.enum([first, ...rest]).describe("Name of the skill to load."),
    }),
    execute: ({ name }): LoadSkillResult => {
      const result = loadSkill(name, agent);
      if (result.ok) ctx.trace.push({ ts: Date.now(), agent, type: "skill_loaded", skill: result.name });
      return result;
    },
  });
}

/** Skill tools for an agent, keyed by capability id, guarded and filtered like every other tool. */
export function buildSkillTools(ctx: RequestContext, agent: AgentId): ToolSet {
  const loadTool = buildLoadSkillTool(ctx, agent);
  if (loadTool === undefined) return {};
  return filterTools({ load_skill: guardTool("load_skill", loadTool, ctx.role, agent) }, ctx.role, agent);
}
