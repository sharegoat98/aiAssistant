export type Role = "employee" | "manager";

export type AgentId = "orchestrator" | "it" | "hr";

interface TraceBase {
  /** Epoch milliseconds. */
  readonly ts: number;
  readonly agent: AgentId;
}

export type TraceEvent =
  | (TraceBase & { readonly type: "agent_start" })
  | (TraceBase & { readonly type: "tool_call"; readonly tool: string; readonly input: unknown })
  | (TraceBase & {
      readonly type: "tool_result";
      readonly tool: string;
      readonly ok: boolean;
      readonly summary: string;
    })
  | (TraceBase & { readonly type: "skill_loaded"; readonly skill: string })
  | (TraceBase & {
      readonly type: "agent_end";
      readonly status: DelegationStatus;
      readonly steps: number;
    })
  | (TraceBase & { readonly type: "mcp_unavailable"; readonly reason: string });

/** Created once per HTTP request and passed unchanged through orchestrator and specialists. */
export interface RequestContext {
  readonly userId: string;
  readonly role: Role;
  readonly sessionId: string;
  /** Append-only log of what happened during this request. */
  readonly trace: TraceEvent[];
  /** Aborted on request timeout or client disconnect; every agent and tool must honour it. */
  readonly signal: AbortSignal;
}

export type DelegationStatus = "ok" | "error" | "unavailable" | "timeout" | "forbidden";

/** What a specialist returns to the orchestrator (and only to the orchestrator). */
export interface DelegationResult {
  readonly status: DelegationStatus;
  readonly agent: AgentId;
  readonly content: string;
}
