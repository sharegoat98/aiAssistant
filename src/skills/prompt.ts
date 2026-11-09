import type { AgentId } from "../types";
import { listSkills } from "./loader";

/**
 * System-prompt section for skills: ONLY "- name: description" lines plus when to call
 * load_skill. The skill body is never included; it is delivered by the load_skill tool.
 * Returns "" for an agent without skills.
 */
export function skillsPromptSection(agent: AgentId): string {
  const skills = listSkills(agent);
  if (skills.length === 0) return "";
  return [
    "Available skills (detailed step-by-step procedures):",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
    "When the request matches a skill, call load_skill with its name before answering, then follow the loaded instructions. Do not guess a skill's steps.",
  ].join("\n");
}
