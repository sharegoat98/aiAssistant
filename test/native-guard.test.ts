import type { Tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SALARY_BANDS } from "../src/data/mock";

import { guardTool } from "../src/permissions/policy";
import { buildNativeTools } from "../src/tools/native";
import type { RequestContext } from "../src/types";

const ctx: RequestContext = {
  userId: "ana",
  role: "employee",
  sessionId: "s",
  trace: [],
  signal: new AbortController().signal,
};

async function run(t: Tool, input: unknown): Promise<unknown> {
  if (t.execute === undefined) throw new Error("no execute");
  return t.execute(input, { toolCallId: "t", messages: [], context: undefined });
}

describe("guardTool around the real get_salary_band", () => {
  const real = buildNativeTools(ctx).get_salary_band;
  // vi.mock is not usable in the workerd pool; spying on the data array is enough to observe reads.
  const findSpy = vi.spyOn(SALARY_BANDS, "find");
  afterEach(() => findSpy.mockClear());

  it("does not touch the salary data for an employee", async () => {
    const result = await run(guardTool("get_salary_band", real, "employee", "hr"), {
      position: "Senior Developer",
    });
    expect(result).toMatchObject({ error: "forbidden" });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("reads the data for a manager", async () => {
    await run(guardTool("get_salary_band", real, "manager", "hr"), { position: "Senior Developer" });
    expect(findSpy).toHaveBeenCalledOnce();
  });
});
