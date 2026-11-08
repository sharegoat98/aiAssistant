import { describe, expect, it } from "vitest";
import type { TraceEvent } from "../src/types";
import { buildTraceView, truncate } from "../ui/src/trace";

const T0 = 1_000_000;
const start = (agent: TraceEvent["agent"], at: number, task?: string): TraceEvent =>
  task === undefined
    ? { ts: T0 + at, agent, type: "agent_start" }
    : { ts: T0 + at, agent, type: "agent_start", task };
const end = (agent: TraceEvent["agent"], at: number, status: "ok" | "error" = "ok"): TraceEvent => ({
  ts: T0 + at,
  agent,
  type: "agent_end",
  status,
});

describe("buildTraceView", () => {
  it("returns an empty view for an empty trace", () => {
    expect(buildTraceView([])).toEqual({ totalMs: 0, spans: [], groups: [], timeline: [] });
  });

  it("groups overlapping specialist spans as parallel, inside the orchestrator span", () => {
    const view = buildTraceView([
      start("orchestrator", 0),
      start("it", 10, "laptop"),
      start("hr", 12, "leave"),
      end("it", 110),
      end("hr", 130, "error"),
      end("orchestrator", 150),
    ]);
    expect(view.groups).toHaveLength(1);
    const group = view.groups[0];
    expect(group?.kind).toBe("parallel");
    expect(group?.spans.map((s) => s.agent)).toEqual(["it", "hr"]);
    expect(group?.spans.map((s) => s.durationMs)).toEqual([100, 118]);
    expect(group?.spans[1]?.status).toBe("error");
    // The orchestrator span is the outer container and is never grouped.
    const orch = view.spans.find((s) => s.agent === "orchestrator");
    expect(orch).toMatchObject({ startMs: 0, endMs: 150, durationMs: 150, status: "ok" });
    expect(view.groups.flatMap((g) => g.spans).some((s) => s.agent === "orchestrator")).toBe(false);
    expect(view.totalMs).toBe(150);
  });

  it("does not group sequential specialist spans", () => {
    const view = buildTraceView([
      start("it", 0),
      end("it", 50),
      start("hr", 60),
      end("hr", 90),
    ]);
    expect(view.groups.map((g) => g.kind)).toEqual(["sequential", "sequential"]);
    expect(view.groups.every((g) => g.spans.length === 1)).toBe(true);
  });

  it("computes offsets from the first event, whatever its ts", () => {
    const view = buildTraceView([
      start("orchestrator", 0),
      { ts: T0 + 25, agent: "it", type: "tool_call", tool: "get_service_status", input: { service: "vpn" } },
      end("orchestrator", 40),
    ]);
    const timeline = view.timeline.flatMap((i) => (i.kind === "row" ? [i.row] : []));
    expect(timeline.map((r) => r.offsetMs)).toEqual([0, 25, 40]);
    expect(timeline[1]).toMatchObject({ tool: "get_service_status", detail: '{"service":"vpn"}' });
  });

  it("shows a span without agent_end as unfinished and still treats it as overlapping", () => {
    const view = buildTraceView([
      start("it", 0),
      start("hr", 20),
      end("hr", 30),
      { ts: T0 + 200, agent: "orchestrator", type: "mcp_unavailable", reason: "down" },
    ]);
    const it = view.spans.find((s) => s.agent === "it");
    expect(it).toMatchObject({ unfinished: true, endMs: null, durationMs: null, status: null });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.kind).toBe("parallel");
  });

  it("highlights skill_loaded and mcp_unavailable rows", () => {
    const view = buildTraceView([
      { ts: T0, agent: "it", type: "skill_loaded", skill: "vpn-troubleshooting" },
      { ts: T0 + 1, agent: "hr", type: "mcp_unavailable", reason: "timeout" },
    ]);
    const rows = view.timeline.flatMap((i) => (i.kind === "row" ? [i.row] : []));
    expect(rows.map((r) => r.highlight)).toEqual(["skill", "mcp"]);
  });

  it("pairs two runs of the same agent in order and keeps emitted order for equal ts", () => {
    const view = buildTraceView([end("it", 30), start("it", 0), start("it", 10), end("it", 20), end("it", 40)]);
    expect(view.spans.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 20],
      [10, 30],
    ]);
    expect(view.groups[0]?.kind).toBe("parallel");
  });

  it("places a group in the timeline where its first event happened", () => {
    const view = buildTraceView([
      start("orchestrator", 0),
      start("it", 5),
      start("hr", 6),
      end("it", 20),
      end("hr", 25),
      end("orchestrator", 30),
    ]);
    expect(view.timeline.map((i) => i.kind)).toEqual(["row", "group", "row"]);
  });
});

describe("truncate", () => {
  it("only truncates text longer than the limit", () => {
    expect(truncate("abc", 3)).toEqual({ text: "abc", truncated: false });
    expect(truncate("abcd", 3)).toEqual({ text: "abc", truncated: true });
  });
});
