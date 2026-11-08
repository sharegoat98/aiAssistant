import type { AgentId, Role } from "../types";

export type CapabilityKind = "native" | "mcp" | "skill" | "delegation";

export interface Capability {
  /** Equals the key under which the tool is registered in an agent's tool set. */
  readonly id: string;
  readonly kind: CapabilityKind;
  /** Roles allowed to use it. */
  readonly roles: readonly Role[];
  /** Agents allowed to execute it. Effective permission = roles ∩ agents. */
  readonly agents: readonly AgentId[];
  /**
   * Plain-language noun phrase ("access to salary bands"). Reused to tell a user what is
   * unavailable, so it must not mention other agents or delegation.
   */
  readonly description: string;
}

/** Single source of truth for who may use what. Anything not listed here is denied. */
export const CAPABILITIES = [
  {
    id: "get_service_status",
    kind: "native",
    roles: ["employee", "manager"],
    agents: ["it"],
    description: "checking the status of company services",
  },
  {
    id: "get_salary_band",
    kind: "native",
    roles: ["manager"],
    agents: ["hr"],
    description: "access to salary bands",
  },
  {
    id: "kb_search",
    kind: "mcp",
    roles: ["employee", "manager"],
    agents: ["it", "hr"],
    description: "searching the company knowledge base",
  },
  {
    id: "load_skill",
    kind: "skill",
    roles: ["employee", "manager"],
    agents: ["it", "hr"],
    description: "loading detailed step-by-step guides",
  },
  {
    id: "ask_it_specialist",
    kind: "delegation",
    roles: ["employee", "manager"],
    agents: ["orchestrator"],
    description: "asking the IT specialist",
  },
  {
    id: "ask_hr_specialist",
    kind: "delegation",
    roles: ["employee", "manager"],
    agents: ["orchestrator"],
    description: "asking the HR specialist",
  },
] as const satisfies readonly Capability[];

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];

const BY_ID: ReadonlyMap<string, Capability> = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Map lookup, so ids like "constructor" or "__proto__" resolve to nothing. */
export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id);
}
