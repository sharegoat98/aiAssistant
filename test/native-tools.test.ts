import type { Tool } from "ai";
import { describe, expect, it } from "vitest";
import { SERVICE_STATUSES } from "../src/data/mock";
import { CAPABILITIES, getCapability } from "../src/permissions/registry";
import { guardTool, type ForbiddenResult } from "../src/permissions/policy";
import {
  buildNativeTools,
  lookupSalaryBand,
  lookupServiceStatus,
  SalaryBandInput,
  ServiceStatusInput,
  type SalaryBandResult,
  type ServiceStatusResult,
} from "../src/tools/native";
import type { RequestContext } from "../src/types";

const ctx: RequestContext = {
  userId: "marko",
  role: "manager",
  sessionId: "s1",
  trace: [],
  signal: new AbortController().signal,
};

async function run(t: Tool | undefined, input: unknown): Promise<unknown> {
  if (t?.execute === undefined) throw new Error("tool has no execute");
  return t.execute(input, { toolCallId: "t1", messages: [], context: undefined });
}

describe("get_service_status", () => {
  const tool = buildNativeTools(ctx).get_service_status;

  it("returns status for a valid service", async () => {
    const result = (await run(tool, ServiceStatusInput.parse({ service: "vpn" }))) as ServiceStatusResult;
    expect(result).toEqual({
      ok: true,
      service: "vpn",
      status: "degraded",
      updatedAt: "2026-03-02T08:15:00.000Z",
      note: SERVICE_STATUSES.vpn.note,
    });
  });

  it("rejects invalid input with a clear error", () => {
    const bad = ServiceStatusInput.safeParse({ service: "printer" });
    expect(bad.success).toBe(false);
    expect(ServiceStatusInput.safeParse({}).success).toBe(false);
  });

  it("reports an unknown service with the known ones", () => {
    expect(lookupServiceStatus("printer")).toEqual({
      ok: false,
      error: "unknown_service",
      knownServices: ["vpn", "email", "wiki", "hr_portal"],
    });
    expect(lookupServiceStatus("constructor").ok).toBe(false);
  });

  it("mock data covers degraded, operational and outage", () => {
    const states = new Set(Object.values(SERVICE_STATUSES).map((s) => s.status));
    expect(states).toEqual(new Set(["degraded", "operational", "outage"]));
    expect(SERVICE_STATUSES.hr_portal.status).toBe("outage");
  });
});

describe("get_salary_band", () => {
  const tool = buildNativeTools(ctx).get_salary_band;

  it("returns the band for a valid position, ignoring case and whitespace", async () => {
    const result = (await run(tool, SalaryBandInput.parse({ position: "  senior DEVELOPER " }))) as SalaryBandResult;
    expect(result).toEqual({
      ok: true,
      band: { position: "Senior Developer", currency: "EUR", min: 48_000, max: 68_000 },
    });
  });

  it("rejects invalid input", () => {
    for (const position of ["", " a ", "x".repeat(81), 42, undefined]) {
      expect(SalaryBandInput.safeParse({ position }).success).toBe(false);
    }
    const tooShort = SalaryBandInput.safeParse({ position: "a" });
    expect(tooShort.success ? "" : tooShort.error.issues[0]?.message).toContain("at least 2");
  });

  it("returns not_found for an unknown position", () => {
    expect(lookupSalaryBand("Chief Wizard")).toEqual({ ok: false, error: "not_found" });
  });
});

describe("buildNativeTools", () => {
  it("returns exactly the expected keys, all registered native capabilities (default deny)", () => {
    const keys = Object.keys(buildNativeTools(ctx));
    expect(keys.sort()).toEqual(["get_salary_band", "get_service_status"]);
    for (const key of keys) {
      expect(getCapability(key)?.kind, `${key} must be registered`).toBe("native");
    }
    expect(CAPABILITIES.filter((c) => c.kind === "native").map((c) => c.id).sort()).toEqual(keys.sort());
  });

  it("descriptions do not mention roles, permissions or other agents", () => {
    for (const t of Object.values(buildNativeTools(ctx))) {
      expect(String(t.description)).not.toMatch(/role|permission|agent|specialist|manager|employee/i);
    }
  });
});

describe("get_salary_band behind guardTool", () => {
  const real = buildNativeTools(ctx).get_salary_band;

  it("employee gets forbidden, without data", async () => {
    const guarded = guardTool("get_salary_band", real, "employee", "hr");
    const result = (await run(guarded, { position: "Senior Developer" })) as ForbiddenResult;
    expect(result.error).toBe("forbidden");
    expect(result).not.toHaveProperty("band");
    expect(result).not.toHaveProperty("ok");
  });

  it("manager gets the band", async () => {
    const guarded = guardTool("get_salary_band", real, "manager", "hr");
    const result = (await run(guarded, { position: "Senior Developer" })) as SalaryBandResult;
    expect(result.ok).toBe(true);
  });
});
