import type { Tool, ToolSet } from "ai";
import type { AgentId, Role } from "../types";
import { CAPABILITIES, getCapability } from "./registry";

export interface ForbiddenResult {
  readonly error: "forbidden";
  readonly message: string;
}

/** Default deny: unknown capability ids are never allowed. */
export function isAllowed(capId: string, role: Role, agent: AgentId): boolean {
  const cap = getCapability(capId);
  return cap !== undefined && cap.roles.includes(role) && cap.agents.includes(agent);
}

/** Removes tools the model must not see. Tool-set keys are capability ids. Does not mutate. */
export function filterTools<T extends ToolSet>(tools: T, role: Role, agent: AgentId): ToolSet {
  return Object.fromEntries(Object.entries(tools).filter(([id]) => isAllowed(id, role, agent)));
}

/**
 * Second line of defence: re-checks permission inside `execute`, so a tool that reaches the
 * model (or is called) despite a bypassed filter still refuses. Returns an error result rather
 * than throwing, so the model can report it honestly.
 */
export function guardTool<T extends Tool>(capId: string, tool: T, role: Role, agent: AgentId): T {
  const original: unknown = tool.execute;
  if (typeof original !== "function") return tool;
  const run = original as (input: unknown, options: unknown) => unknown;
  const guarded = (input: unknown, options: unknown): unknown => {
    if (!isAllowed(capId, role, agent)) {
      const result: ForbiddenResult = {
        error: "forbidden",
        message: "This capability is not available for the current user and agent.",
      };
      return result;
    }
    return run.call(tool, input, options);
  };
  return { ...tool, execute: guarded } as T;
}

/**
 * Prompt sentences for what the current role cannot use, generated from the registry.
 * Delegation capabilities are never listed and agent-only restrictions are not described:
 * an agent must not learn that other agents exist. `_agent` is reserved for future use.
 */
export function describeUnavailable(role: Role, _agent: AgentId): string[] {
  return CAPABILITIES.filter(
    (c) => c.kind !== "delegation" && !(c.roles as readonly Role[]).includes(role),
  ).map((c) => `Not available for your role: ${c.description}`);
}
