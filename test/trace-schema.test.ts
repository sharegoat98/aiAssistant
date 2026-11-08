import { describe, expect, it } from "vitest";
import type { TraceEvent } from "../src/types";
import { ChatResponseSchema, TraceEventSchema } from "../ui/src/schemas";

/**
 * One sample for EVERY server TraceEvent variant. The mapped type makes a new variant in
 * src/types.ts a compile error here until a sample is added; the test then proves the UI
 * schema accepts it.
 */
const samples: { [T in TraceEvent["type"]]: Extract<TraceEvent, { type: T }> } = {
  agent_start: { ts: 1, agent: "it", type: "agent_start", task: "check vpn" },
  tool_call: { ts: 2, agent: "it", type: "tool_call", tool: "get_service_status", input: { service: "vpn" } },
  tool_result: { ts: 3, agent: "it", type: "tool_result", tool: "get_service_status", ok: true, summary: "{}" },
  skill_loaded: { ts: 4, agent: "it", type: "skill_loaded", skill: "vpn-troubleshooting" },
  agent_end: { ts: 5, agent: "it", type: "agent_end", status: "ok", steps: 2 },
  mcp_unavailable: { ts: 6, agent: "hr", type: "mcp_unavailable", reason: "timeout" },
};

describe("UI trace schema vs server TraceEvent", () => {
  for (const [type, sample] of Object.entries(samples)) {
    it(`accepts a ${type} event`, () => {
      expect(TraceEventSchema.safeParse(sample).success).toBe(true);
    });
  }

  it("accepts optional fields being absent", () => {
    expect(TraceEventSchema.safeParse({ ts: 1, agent: "orchestrator", type: "agent_start" }).success).toBe(true);
    expect(TraceEventSchema.safeParse({ ts: 1, agent: "it", type: "agent_end", status: "timeout" }).success).toBe(true);
  });

  it("rejects an unknown event type and a wrong field type", () => {
    expect(TraceEventSchema.safeParse({ ts: 1, agent: "it", type: "brand_new" }).success).toBe(false);
    expect(TraceEventSchema.safeParse({ ...samples.tool_result, ok: "yes" }).success).toBe(false);
  });

  it("parses a chat response containing every variant", () => {
    const body = { reply: "hi", status: "ok", trace: Object.values(samples) };
    expect(ChatResponseSchema.safeParse(body).success).toBe(true);
  });
});
