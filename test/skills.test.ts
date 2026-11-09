import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CAPABILITIES } from "../src/permissions/registry";
import { parseSkillFile } from "../src/skills/frontmatter";
import { SKILL_SOURCES } from "../src/skills/index";
import { buildRegistry, listSkills, loadSkill } from "../src/skills/loader";
import { skillsPromptSection } from "../src/skills/prompt";
import { buildLoadSkillTool, buildSkillTools } from "../src/tools/skills";
import type { AgentId, RequestContext } from "../src/types";

const MARKERS = { "vpn-troubleshooting": "SKILL-BODY-MARKER-VPN", "onboarding-checklist": "SKILL-BODY-MARKER-ONBOARDING" } as const;

function makeCtx(): RequestContext {
  return { userId: "ana", role: "employee", sessionId: "s", trace: [], signal: new AbortController().signal };
}

const valid = (over: Partial<Record<string, string>> = {}): string => {
  const f = { name: "demo", description: "A demo skill.", agents: "[it]", ...over };
  const header = Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${header}\n---\n1. Do the thing.\n`;
};

describe("parseSkillFile", () => {
  it("parses a valid file", () => {
    expect(parseSkillFile("demo", valid())).toEqual({
      name: "demo",
      description: "A demo skill.",
      agents: ["it"],
      body: "1. Do the thing.",
    });
  });

  it.each([
    ["no frontmatter", "1. Do the thing.", /must start with/],
    ["unclosed frontmatter", "---\nname: demo\n1. step", /not closed/],
    ["missing name", valid({ name: undefined }), /missing or empty.*"name"/],
    ["missing description", valid({ description: undefined }), /"description"/],
    ["missing agents", valid({ agents: undefined }), /"agents"/],
    ["empty description", valid({ description: "" }), /"description"/],
    ["name differs from folder", valid({ name: "other" }), /must equal its folder name/],
    ["agents not a list", valid({ agents: "it" }), /inline list/],
    ["unknown agent", valid({ agents: "[it, ceo]" }), /unknown agent "ceo"/],
    ["empty agents list", valid({ agents: "[]" }), /unknown agent/],
    ["unknown key", valid({ extra: "x" }), /unknown frontmatter key "extra"/],
    ["line without colon", "---\nname demo\n---\nbody", /malformed frontmatter line/],
    ["empty body", "---\nname: demo\ndescription: d\nagents: [it]\n---\n\n", /body is empty/],
  ])("throws a clear error: %s", (_label, raw, pattern) => {
    expect(() => parseSkillFile("demo", raw)).toThrow(pattern);
  });

  it("buildRegistry throws on duplicate names and on malformed sources", () => {
    const one = { folder: "demo", raw: valid() };
    expect(() => buildRegistry([one, one])).toThrow(/Duplicate skill name "demo"/);
    expect(() => buildRegistry([{ folder: "demo", raw: "garbage" }])).toThrow(/Skill "demo"/);
  });
});

describe("registered skills", () => {
  const parsed = SKILL_SOURCES.map((s) => ({ source: s, skill: parseSkillFile(s.folder, s.raw) }));

  it("each name equals its folder and names are unique", () => {
    for (const { source, skill } of parsed) expect(skill.name).toBe(source.folder);
    const names = parsed.map((p) => p.skill.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // Tools every user of the agent can call (a skill must work for any role).
  const toolsOf = (agent: AgentId): string[] =>
    CAPABILITIES.filter(
      (c) => c.kind !== "delegation" && c.kind !== "skill" && (c.agents as readonly AgentId[]).includes(agent) && c.roles.length === 2,
    ).map((c) => c.id);

  it.each(parsed.map((p) => [p.skill.name, p.skill] as const))("%s: only references tools its agents have", (_name, skill) => {
    const mentioned = [...skill.body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1] ?? "");
    expect(mentioned.length).toBeGreaterThan(0);
    for (const agent of skill.agents) {
      for (const tool of mentioned) expect(toolsOf(agent), `${tool} for ${agent}`).toContain(tool);
    }
  });

  it.each(parsed.map((p) => [p.skill.name, p.skill] as const))("%s: content rules", (name, skill) => {
    const text = `${skill.description}\n${skill.body}`;
    expect(text).not.toMatch(/orchestrator|delegat|specialist|permission|\broles?\b|\bagents?\b/i);
    expect(text).not.toMatch(/[€$]\s?\d|\d\s?(EUR|USD)|salary|password|secret|api[_ ]key/i);
    expect(skill.body).toMatch(/^1\. /m);
    expect(skill.body).toMatch(/^2\. /m);
    expect(skill.body).toMatch(/unavailable/i);
    expect(skill.body).toContain(MARKERS[name as keyof typeof MARKERS]);
  });

  it("VPN skill order: status, then knowledge base, then escalation", () => {
    const body = parsed.find((p) => p.skill.name === "vpn-troubleshooting")?.skill.body ?? "";
    const a = body.indexOf("get_service_status");
    const b = body.indexOf("kb_search");
    const c = body.indexOf("escalation");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(body).toMatch(/reinstall/);
  });

  it("onboarding skill names contract, user account, equipment and mentor", () => {
    const body = (parsed.find((p) => p.skill.name === "onboarding-checklist")?.skill.body ?? "").toLowerCase();
    for (const item of ["contract", "user account", "equipment", "mentor"]) expect(body).toContain(item);
  });
});

describe("listSkills / loadSkill", () => {
  it("lists only the agent's skills, without bodies", () => {
    expect(listSkills("it").map((s) => s.name)).toEqual(["vpn-troubleshooting"]);
    expect(listSkills("hr").map((s) => s.name)).toEqual(["onboarding-checklist"]);
    expect(listSkills("orchestrator")).toEqual([]);
    for (const s of [...listSkills("it"), ...listSkills("hr")]) expect(Object.keys(s).sort()).toEqual(["description", "name"]);
  });

  it("loads own skill with the body", () => {
    const r = loadSkill("vpn-troubleshooting", "it");
    expect(r).toMatchObject({ ok: true, name: "vpn-troubleshooting" });
    expect(r.ok && r.instructions).toContain(MARKERS["vpn-troubleshooting"]);
  });

  it("refuses another agent's skill and never throws for bad names", () => {
    expect(loadSkill("vpn-troubleshooting", "hr")).toEqual({ ok: false, error: "not_available", available: ["onboarding-checklist"] });
    expect(loadSkill("onboarding-checklist", "it")).toEqual({ ok: false, error: "not_available", available: ["vpn-troubleshooting"] });
    expect(loadSkill("vpn-troubleshooting", "orchestrator")).toEqual({ ok: false, error: "not_available", available: [] });
    for (const bad of ["nope", "", "__proto__", "constructor", "toString"]) {
      expect(loadSkill(bad, "it")).toMatchObject({ ok: false, error: "unknown_skill" });
    }
  });
});

describe("skillsPromptSection", () => {
  it("contains only name: description lines and an instruction, never a body", () => {
    const it = skillsPromptSection("it");
    expect(it).toContain("- vpn-troubleshooting: ");
    expect(it).toContain("load_skill");
    expect(it).not.toContain("onboarding-checklist");
    expect(it).not.toContain(MARKERS["vpn-troubleshooting"]);
    expect(it).not.toContain("get_service_status");
    expect(skillsPromptSection("hr")).toContain("- onboarding-checklist: ");
    expect(skillsPromptSection("hr")).not.toContain(MARKERS["onboarding-checklist"]);
    expect(skillsPromptSection("orchestrator")).toBe("");
  });
});

describe("load_skill tool", () => {
  const exec = (t: ReturnType<typeof buildLoadSkillTool>, input: unknown) =>
    t?.execute?.(input, { toolCallId: "t", messages: [], context: undefined });

  it("is not exposed to an agent without skills (orchestrator)", () => {
    expect(buildLoadSkillTool(makeCtx(), "orchestrator")).toBeUndefined();
    expect(buildSkillTools(makeCtx(), "orchestrator")).toEqual({});
  });

  it("is exposed to it and hr under the capability id", () => {
    expect(Object.keys(buildSkillTools(makeCtx(), "it"))).toEqual(["load_skill"]);
    expect(Object.keys(buildSkillTools(makeCtx(), "hr"))).toEqual(["load_skill"]);
  });

  it("input enum accepts only the agent's own skills", () => {
    const schema = buildLoadSkillTool(makeCtx(), "hr")?.inputSchema as z.ZodType;
    expect(schema.safeParse({ name: "onboarding-checklist" }).success).toBe(true);
    expect(schema.safeParse({ name: "vpn-troubleshooting" }).success).toBe(false);
  });

  it("execute loads the body and emits one skill_loaded", async () => {
    const ctx = makeCtx();
    const r = await exec(buildLoadSkillTool(ctx, "hr"), { name: "onboarding-checklist" });
    expect(r).toMatchObject({ ok: true, name: "onboarding-checklist" });
    expect(JSON.stringify(r)).toContain(MARKERS["onboarding-checklist"]);
    expect(ctx.trace).toHaveLength(1);
    expect(ctx.trace[0]).toMatchObject({ type: "skill_loaded", agent: "hr", skill: "onboarding-checklist" });
    expect(typeof ctx.trace[0]?.ts).toBe("number");
  });

  it("execute refuses another agent's skill even when called directly (no skill_loaded)", async () => {
    const hrCtx = makeCtx();
    expect(await exec(buildLoadSkillTool(hrCtx, "hr"), { name: "vpn-troubleshooting" })).toEqual({
      ok: false,
      error: "not_available",
      available: ["onboarding-checklist"],
    });
    const itCtx = makeCtx();
    expect(await exec(buildLoadSkillTool(itCtx, "it"), { name: "onboarding-checklist" })).toMatchObject({
      ok: false,
      error: "not_available",
    });
    expect(hrCtx.trace).toEqual([]);
    expect(itCtx.trace).toEqual([]);
  });
});
