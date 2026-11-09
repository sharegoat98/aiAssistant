import type { AgentId } from "../types";
import { parseSkillFile, type ParsedSkill } from "./frontmatter";
import { SKILL_SOURCES, type SkillSource } from "./index";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
}

export type LoadSkillResult =
  | { readonly ok: true; readonly name: string; readonly instructions: string }
  | {
      readonly ok: false;
      readonly error: "unknown_skill" | "not_available";
      readonly available: string[];
    };

export interface SkillRegistry {
  listSkills(agent: AgentId): SkillSummary[];
  loadSkill(name: string, agent: AgentId): LoadSkillResult;
  skillNamesFor(agent: AgentId): string[];
}

/** Parses every source (throws on any malformed file or duplicate name) and returns the scoped API. */
export function buildRegistry(sources: readonly SkillSource[]): SkillRegistry {
  const skills = new Map<string, ParsedSkill>();
  for (const { folder, raw } of sources) {
    const skill = parseSkillFile(folder, raw);
    if (skills.has(skill.name)) throw new Error(`Duplicate skill name "${skill.name}"`);
    skills.set(skill.name, skill);
  }

  const forAgent = (agent: AgentId): ParsedSkill[] => [...skills.values()].filter((s) => s.agents.includes(agent));
  const skillNamesFor = (agent: AgentId): string[] => forAgent(agent).map((s) => s.name);

  return {
    skillNamesFor,
    listSkills: (agent) => forAgent(agent).map(({ name, description }) => ({ name, description })),
    loadSkill: (name, agent) => {
      const skill = skills.get(name);
      if (skill === undefined) return { ok: false, error: "unknown_skill", available: skillNamesFor(agent) };
      if (!skill.agents.includes(agent)) return { ok: false, error: "not_available", available: skillNamesFor(agent) };
      return { ok: true, name: skill.name, instructions: skill.body };
    },
  };
}

const registry = buildRegistry(SKILL_SOURCES);

/** Name + description only; bodies are never returned. */
export const listSkills = (agent: AgentId): SkillSummary[] => registry.listSkills(agent);
/** Never throws for bad names; refuses skills the agent is not listed for. */
export const loadSkill = (name: string, agent: AgentId): LoadSkillResult => registry.loadSkill(name, agent);
export const skillNamesFor = (agent: AgentId): string[] => registry.skillNamesFor(agent);
