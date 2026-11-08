// Pure trace -> display model. No React, no DOM.
import type { TraceEvent } from "./schemas";

type AgentId = TraceEvent["agent"];
type Status = Extract<TraceEvent, { type: "agent_end" }>["status"];

export interface TraceRow {
  readonly offsetMs: number;
  readonly agent: AgentId;
  readonly type: TraceEvent["type"];
  readonly tool: string | null;
  /** Only for tool_result. */
  readonly ok: boolean | null;
  /** Only for agent_end. */
  readonly status: Status | null;
  /** Task, tool input, result summary, skill name, reason or end info, as plain text. */
  readonly detail: string;
  readonly highlight: "skill" | "mcp" | null;
}

export interface TraceSpan {
  readonly agent: AgentId;
  readonly task: string | null;
  readonly startMs: number;
  /** null when agent_end is missing. */
  readonly endMs: number | null;
  readonly durationMs: number | null;
  readonly status: Status | null;
  readonly unfinished: boolean;
  /** Events that happened inside this span, including its own start and end. */
  readonly rows: readonly TraceRow[];
}

/** Specialist spans that overlap in time form a "parallel" group; any other span stands alone. */
export interface TraceGroup {
  readonly kind: "parallel" | "sequential";
  readonly spans: readonly TraceSpan[];
}

export type TimelineItem =
  | { readonly kind: "row"; readonly row: TraceRow }
  | { readonly kind: "group"; readonly group: TraceGroup };

export interface TraceView {
  readonly totalMs: number;
  /** Every span, orchestrator included, ordered by start. */
  readonly spans: readonly TraceSpan[];
  /** Specialist (it/hr) groups only; the orchestrator span is the outer container. */
  readonly groups: readonly TraceGroup[];
  /** Chronological display order: orchestrator rows inline, specialist spans as groups. */
  readonly timeline: readonly TimelineItem[];
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserialisable]";
  }
}

function toRow(e: TraceEvent, offsetMs: number): TraceRow {
  const common = { offsetMs, agent: e.agent, type: e.type };
  switch (e.type) {
    case "agent_start":
      return { ...common, tool: null, ok: null, status: null, detail: e.task ?? "", highlight: null };
    case "tool_call":
      return { ...common, tool: e.tool, ok: null, status: null, detail: toJson(e.input), highlight: null };
    case "tool_result":
      return { ...common, tool: e.tool, ok: e.ok, status: null, detail: e.summary, highlight: null };
    case "skill_loaded":
      return { ...common, tool: null, ok: null, status: null, detail: e.skill, highlight: "skill" };
    case "agent_end":
      return {
        ...common,
        tool: null,
        ok: null,
        status: e.status,
        detail: e.steps === undefined ? "" : `${e.steps} steps`,
        highlight: null,
      };
    case "mcp_unavailable":
      return { ...common, tool: null, ok: null, status: null, detail: e.reason, highlight: "mcp" };
  }
}

interface MutableSpan {
  agent: AgentId;
  task: string | null;
  startMs: number;
  endMs: number | null;
  status: Status | null;
  rows: TraceRow[];
}

export function buildTraceView(events: readonly TraceEvent[]): TraceView {
  if (events.length === 0) return { totalMs: 0, spans: [], groups: [], timeline: [] };

  // Array.prototype.sort is stable, so events with equal ts keep their emitted order.
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const t0 = sorted[0]?.ts ?? 0;
  const totalMs = (sorted[sorted.length - 1]?.ts ?? t0) - t0;

  const all: MutableSpan[] = [];
  /** Open spans per agent, oldest first: events carry no span id, so same-agent runs pair FIFO. */
  const open = new Map<AgentId, MutableSpan[]>();
  /** Span a row belongs to, parallel to the row order. */
  const items: { row: TraceRow; span: MutableSpan | null }[] = [];

  for (const e of sorted) {
    const offset = e.ts - t0;
    const row = toRow(e, offset);
    const queue = open.get(e.agent) ?? [];
    open.set(e.agent, queue);
    let span: MutableSpan | null = queue[0] ?? null;
    if (e.type === "agent_start") {
      span = { agent: e.agent, task: e.task ?? null, startMs: offset, endMs: null, status: null, rows: [] };
      all.push(span);
      queue.push(span);
    } else if (e.type === "agent_end" && span !== null) {
      span.endMs = offset;
      span.status = e.status;
      queue.shift();
    }
    span?.rows.push(row);
    items.push({ row, span });
  }

  const toSpan = (s: MutableSpan): TraceSpan => ({
    agent: s.agent,
    task: s.task,
    startMs: s.startMs,
    endMs: s.endMs,
    durationMs: s.endMs === null ? null : s.endMs - s.startMs,
    status: s.status,
    unfinished: s.endMs === null,
    rows: s.rows,
  });
  const frozen = new Map(all.map((s) => [s, toSpan(s)] as const));
  const spans = all.map((s) => frozen.get(s) as TraceSpan);

  // Cluster specialist spans by interval overlap (an unfinished span lasts until the last event).
  const specialists = all.filter((s) => s.agent !== "orchestrator");
  const clusters: MutableSpan[][] = [];
  let clusterEnd = -Infinity;
  for (const s of [...specialists].sort((a, b) => a.startMs - b.startMs)) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && s.startMs < clusterEnd) {
      last.push(s);
      clusterEnd = Math.max(clusterEnd, s.endMs ?? totalMs);
    } else {
      clusters.push([s]);
      clusterEnd = s.endMs ?? totalMs;
    }
  }
  const groupOf = new Map<MutableSpan, TraceGroup>();
  const groups: TraceGroup[] = clusters.map((c) => {
    const group: TraceGroup = {
      kind: c.length > 1 ? "parallel" : "sequential",
      spans: c.map((s) => frozen.get(s) as TraceSpan),
    };
    for (const s of c) groupOf.set(s, group);
    return group;
  });

  const timeline: TimelineItem[] = [];
  const emitted = new Set<TraceGroup>();
  for (const { row, span } of items) {
    const group = span === null ? undefined : groupOf.get(span);
    if (group === undefined) {
      timeline.push({ kind: "row", row });
    } else if (!emitted.has(group)) {
      emitted.add(group);
      timeline.push({ kind: "group", group });
    }
  }
  return { totalMs, spans, groups, timeline };
}

/** Shortens long text for display; the UI offers an expand control for the rest. */
export function truncate(text: string, max: number): { readonly text: string; readonly truncated: boolean } {
  return text.length <= max ? { text, truncated: false } : { text: text.slice(0, max), truncated: true };
}
