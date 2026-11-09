import { AGENT_IDS, type AgentId, type Role } from "../types";
import { CAPABILITIES, type CapabilityKind } from "./registry";
import { isAllowed } from "./policy";

export interface CapabilityView {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly description: string;
  /** Effective permission for this role on this agent (role ∩ agent), from policy.isAllowed. */
  readonly available: boolean;
}

export interface AgentCapabilities {
  readonly agent: AgentId;
  readonly capabilities: CapabilityView[];
}

/** Capabilities grouped by agent for one role. Derived from the registry, never hand-written. */
export function describeCapabilities(role: Role): AgentCapabilities[] {
  return AGENT_IDS.map((agent) => ({
    agent,
    capabilities: CAPABILITIES.filter((c) => (c.agents as readonly AgentId[]).includes(agent)).map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description,
      available: isAllowed(c.id, role, agent),
    })),
  }));
}
