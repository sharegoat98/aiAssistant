import type { Tool, ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  describeUnavailable,
  filterTools,
  guardTool,
  isAllowed,
  type ForbiddenResult,
} from "../src/permissions/policy";
import { CAPABILITIES } from "../src/permissions/registry";
import type { AgentId, Role } from "../src/types";

// Expectations are written out literally on purpose: they must not be derived from the registry.
const MATRIX: ReadonlyArray<readonly [Role, AgentId, string, boolean]> = [
  ["employee", "orchestrator", "get_service_status", false],
  ["employee", "orchestrator", "get_salary_band", false],
  ["employee", "orchestrator", "kb_search", false],
  ["employee", "orchestrator", "load_skill", false],
  ["employee", "orchestrator", "ask_it_specialist", true],
  ["employee", "orchestrator", "ask_hr_specialist", true],
  ["employee", "it", "get_service_status", true],
  ["employee", "it", "get_salary_band", false],
  ["employee", "it", "kb_search", true],
  ["employee", "it", "load_skill", true],
  ["employee", "it", "ask_it_specialist", false],
  ["employee", "it", "ask_hr_specialist", false],
  ["employee", "hr", "get_service_status", false],
  ["employee", "hr", "get_salary_band", false],
  ["employee", "hr", "kb_search", true],
  ["employee", "hr", "load_skill", true],
  ["employee", "hr", "ask_it_specialist", false],
  ["employee", "hr", "ask_hr_specialist", false],
  ["manager", "orchestrator", "get_service_status", false],
  ["manager", "orchestrator", "get_salary_band", false],
  ["manager", "orchestrator", "kb_search", false],
  ["manager", "orchestrator", "load_skill", false],
  ["manager", "orchestrator", "ask_it_specialist", true],
  ["manager", "orchestrator", "ask_hr_specialist", true],
  ["manager", "it", "get_service_status", true],
  ["manager", "it", "get_salary_band", false],
  ["manager", "it", "kb_search", true],
  ["manager", "it", "load_skill", true],
  ["manager", "it", "ask_it_specialist", false],
  ["manager", "it", "ask_hr_specialist", false],
  ["manager", "hr", "get_service_status", false],
  ["manager", "hr", "get_salary_band", true],
  ["manager", "hr", "kb_search", true],
  ["manager", "hr", "load_skill", true],
  ["manager", "hr", "ask_it_specialist", false],
  ["manager", "hr", "ask_hr_specialist", false],
];

const stub = (execute?: (input: unknown) => unknown): Tool =>
  ({ description: "stub", inputSchema: {}, ...(execute ? { execute } : {}) }) as unknown as Tool;

describe("isAllowed matrix (role x agent x capability)", () => {
  it("covers every combination exactly once", () => {
    expect(MATRIX).toHaveLength(2 * 3 * CAPABILITIES.length);
    expect(new Set(MATRIX.map(([r, a, c]) => `${r}|${a}|${c}`)).size).toBe(MATRIX.length);
  });

  it.each(MATRIX)("%s / %s / %s -> %s", (role, agent, capId, expected) => {
    expect(isAllowed(capId, role, agent)).toBe(expected);
  });

  it.each(["nope", "", "constructor", "__proto__", "toString", "GET_SERVICE_STATUS"])(
    "denies unknown capability %j",
    (id) => {
      for (const role of ["employee", "manager"] as const) {
        for (const agent of ["orchestrator", "it", "hr"] as const) {
          expect(isAllowed(id, role, agent)).toBe(false);
        }
      }
    },
  );
});

describe("filterTools", () => {
  const all = (): ToolSet => ({
    get_service_status: stub(),
    get_salary_band: stub(),
    kb_search: stub(),
    load_skill: stub(),
    ask_it_specialist: stub(),
    ask_hr_specialist: stub(),
    mystery_tool: stub(),
  });

  it.each([
    ["employee", "it", ["get_service_status", "kb_search", "load_skill"]],
    ["manager", "it", ["get_service_status", "kb_search", "load_skill"]],
    ["employee", "hr", ["kb_search", "load_skill"]],
    ["manager", "hr", ["get_salary_band", "kb_search", "load_skill"]],
    ["employee", "orchestrator", ["ask_hr_specialist", "ask_it_specialist"]],
    ["manager", "orchestrator", ["ask_hr_specialist", "ask_it_specialist"]],
  ] as const)("%s / %s keeps only permitted tools (unknown dropped)", (role, agent, keep) => {
    expect(Object.keys(filterTools(all(), role, agent)).sort()).toEqual([...keep].sort());
  });

  it("does not mutate its input", () => {
    const tools = all();
    filterTools(tools, "employee", "it");
    expect(Object.keys(tools)).toHaveLength(7);
  });
});

describe("guardTool", () => {
  it("refuses when called directly with the filter bypassed, without running the tool", async () => {
    const inner = vi.fn(() => "secret");
    const guarded = guardTool("get_salary_band", stub(inner), "employee", "hr");
    const result = (await guarded.execute?.({}, {} as never)) as ForbiddenResult;
    expect(result.error).toBe("forbidden");
    expect(result.message.length).toBeGreaterThan(0);
    expect(inner).not.toHaveBeenCalled();
  });

  it("refuses the wrong agent even for a permitted role", async () => {
    const inner = vi.fn(() => "x");
    const guarded = guardTool("get_salary_band", stub(inner), "manager", "it");
    expect(await guarded.execute?.({}, {} as never)).toMatchObject({ error: "forbidden" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("refuses unknown capability ids", async () => {
    const inner = vi.fn(() => "x");
    const guarded = guardTool("nope", stub(inner), "manager", "hr");
    expect(await guarded.execute?.({}, {} as never)).toMatchObject({ error: "forbidden" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes input and options through when allowed", async () => {
    const inner = vi.fn((_input: unknown) => "ok");
    const guarded = guardTool("get_salary_band", stub(inner), "manager", "hr");
    const options = { toolCallId: "1" } as never;
    expect(await guarded.execute?.({ level: 3 }, options)).toBe("ok");
    expect(inner).toHaveBeenCalledWith({ level: 3 }, options);
  });

  it("returns tools without execute unchanged", () => {
    const t = stub();
    expect(guardTool("kb_search", t, "employee", "it")).toBe(t);
  });
});

describe("describeUnavailable", () => {
  it("tells an employee that salary bands are unavailable", () => {
    for (const agent of ["orchestrator", "it", "hr"] as const) {
      expect(describeUnavailable("employee", agent)).toEqual([
        "Not available for your role: access to salary bands",
      ]);
    }
  });

  it("lists nothing for a manager", () => {
    for (const agent of ["orchestrator", "it", "hr"] as const) {
      expect(describeUnavailable("manager", agent)).toEqual([]);
    }
  });

  it("never mentions other agents, delegation or the orchestrator", () => {
    for (const role of ["employee", "manager"] as const) {
      for (const agent of ["orchestrator", "it", "hr"] as const) {
        for (const line of describeUnavailable(role, agent)) {
          expect(line).not.toMatch(/specialist|delegat|orchestrat|\bagent|\bHR\b|\bIT\b/i);
        }
      }
    }
  });
});
