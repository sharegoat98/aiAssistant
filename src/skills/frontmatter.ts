import type { AgentId } from "../types";

export interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly agents: readonly AgentId[];
  readonly body: string;
}

const AGENT_IDS: readonly string[] = ["orchestrator", "it", "hr"] satisfies readonly AgentId[];
const REQUIRED_KEYS = ["name", "description", "agents"] as const;

function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value);
}

/**
 * Strict, dependency-free parser for a SKILL.md file: a `---` delimited block of `key: value`
 * lines (keys: name, description, agents as `[a, b]`) followed by the instruction body.
 * Any malformed or incomplete file throws; nothing is skipped silently.
 */
export function parseSkillFile(folder: string, raw: string): ParsedSkill {
  const fail = (msg: string): never => {
    throw new Error(`Skill "${folder}": ${msg}`);
  };

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return fail("file must start with a '---' frontmatter delimiter");
  const end = lines.indexOf("---", 1);
  if (end === -1) return fail("frontmatter is not closed with '---'");

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const sep = line.indexOf(":");
    if (sep === -1) return fail(`malformed frontmatter line: "${line}"`);
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!(REQUIRED_KEYS as readonly string[]).includes(key)) return fail(`unknown frontmatter key "${key}"`);
    if (fields.has(key)) return fail(`duplicate frontmatter key "${key}"`);
    fields.set(key, value);
  }
  for (const key of REQUIRED_KEYS) {
    if ((fields.get(key) ?? "") === "") return fail(`missing or empty frontmatter key "${key}"`);
  }

  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  const agentsRaw = fields.get("agents") ?? "";
  if (name !== folder) return fail(`name "${name}" must equal its folder name "${folder}"`);

  const listMatch = /^\[(.*)\]$/.exec(agentsRaw);
  if (listMatch === null) return fail(`"agents" must be an inline list like [it, hr], got "${agentsRaw}"`);
  const agents: AgentId[] = [];
  for (const item of (listMatch[1] ?? "").split(",").map((s) => s.trim())) {
    if (!isAgentId(item)) return fail(`unknown agent "${item}" in "agents"`);
    if (!agents.includes(item)) agents.push(item);
  }

  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (body === "") return fail("instruction body is empty");

  return { name, description, agents, body };
}
