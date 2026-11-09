/**
 * Demo runner: sends realistic prompts to a RUNNING `npm run dev` server over HTTP, derives a
 * structural summary from each response trace and writes the evidence to examples/scenarios/.
 *
 * Expectations are reported (PASS / FAIL / INFO), never enforced: a real model may deviate, and
 * deviations are recorded as they happened. Prompts and expectations are never altered to pass.
 *
 * Run with: npm run demo [-- --retries N] [-- --only NN]
 * Self-contained on purpose (only `zod` and `node:` imports) so Node can run it by stripping types.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Response schemas (mirror the API contract; every response is validated)
// ---------------------------------------------------------------------------------------------

const AgentId = z.enum(["orchestrator", "it", "hr"]);
type AgentId = z.infer<typeof AgentId>;
const Status = z.enum(["ok", "error", "unavailable", "timeout", "forbidden"]);

const TraceBase = { ts: z.number(), agent: AgentId };
const TraceEvent = z.discriminatedUnion("type", [
  z.object({ ...TraceBase, type: z.literal("agent_start"), task: z.string().optional() }),
  z.object({ ...TraceBase, type: z.literal("tool_call"), tool: z.string(), input: z.unknown() }),
  z.object({ ...TraceBase, type: z.literal("tool_result"), tool: z.string(), ok: z.boolean(), summary: z.string() }),
  z.object({ ...TraceBase, type: z.literal("skill_loaded"), skill: z.string() }),
  z.object({ ...TraceBase, type: z.literal("agent_end"), status: Status, steps: z.number().optional() }),
  z.object({ ...TraceBase, type: z.literal("mcp_unavailable"), reason: z.string() }),
]);
type TraceEvent = z.infer<typeof TraceEvent>;

const ChatResponse = z.object({
  reply: z.string(),
  status: z.string(),
  trace: z.array(TraceEvent),
});
type ChatResponse = z.infer<typeof ChatResponse>;

const UsersResponse = z.object({ users: z.array(z.object({ userId: z.string() })) });
const ErrorBody = z.object({ error: z.string(), message: z.string() });
const WranglerConfig = z.object({
  vars: z.object({ MODEL_ID: z.string(), MODEL_PROVIDER: z.string() }),
});

// ---------------------------------------------------------------------------------------------
// Structural summary
// ---------------------------------------------------------------------------------------------

type Specialist = "it" | "hr";

interface Delegation {
  readonly agent: Specialist;
  /** Full task text from the orchestrator's tool call (falls back to the truncated trace text). */
  readonly task: string;
  readonly startMs: number;
  readonly endMs: number | undefined;
  readonly status: string;
}

interface ToolCount {
  readonly agent: AgentId;
  readonly tool: string;
  readonly calls: number;
  readonly ok: number;
  readonly failed: number;
}

interface Summary {
  readonly delegations: readonly Delegation[];
  readonly overlap: boolean;
  readonly tools: readonly ToolCount[];
  readonly skills: readonly { readonly agent: AgentId; readonly skill: string; readonly atMs: number }[];
  readonly mcpUnavailable: readonly { readonly agent: AgentId; readonly reason: string }[];
  readonly finalStatuses: Readonly<Record<string, string>>;
}

function isSpecialist(agent: AgentId): agent is Specialist {
  return agent === "it" || agent === "hr";
}

function taskOf(input: unknown): string | undefined {
  const parsed = z.object({ task: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.task : undefined;
}

function summarize(trace: readonly TraceEvent[]): Summary {
  const t0 = trace[0]?.ts ?? 0;
  const off = (ts: number): number => ts - t0;

  // Full task texts come from the orchestrator's delegation tool calls, in call order.
  const fullTasks: Record<Specialist, string[]> = { it: [], hr: [] };
  for (const e of trace) {
    if (e.type !== "tool_call" || e.agent !== "orchestrator") continue;
    const task = taskOf(e.input);
    if (task === undefined) continue;
    if (e.tool === "ask_it_specialist") fullTasks.it.push(task);
    if (e.tool === "ask_hr_specialist") fullTasks.hr.push(task);
  }

  const open: Record<Specialist, number[]> = { it: [], hr: [] };
  const started: Record<Specialist, number> = { it: 0, hr: 0 };
  const delegations: { agent: Specialist; task: string; startMs: number; endMs: number | undefined; status: string }[] = [];
  for (const e of trace) {
    if (!isSpecialist(e.agent)) continue;
    if (e.type === "agent_start") {
      const n = started[e.agent]++;
      delegations.push({
        agent: e.agent,
        task: fullTasks[e.agent][n] ?? e.task ?? "",
        startMs: off(e.ts),
        endMs: undefined,
        status: "unfinished",
      });
      open[e.agent].push(delegations.length - 1);
    } else if (e.type === "agent_end") {
      const idx = open[e.agent].shift();
      const d = idx === undefined ? undefined : delegations[idx];
      if (d !== undefined) {
        d.endMs = off(e.ts);
        d.status = e.status;
      }
    }
  }

  let overlap = false;
  for (let i = 0; i < delegations.length; i++) {
    for (let j = i + 1; j < delegations.length; j++) {
      const a = delegations[i];
      const b = delegations[j];
      if (a === undefined || b === undefined || a.endMs === undefined || b.endMs === undefined) continue;
      if (a.startMs < b.endMs && b.startMs < a.endMs) overlap = true;
    }
  }

  const counts = new Map<string, { agent: AgentId; tool: string; calls: number; ok: number; failed: number }>();
  const entry = (agent: AgentId, tool: string) => {
    const key = `${agent}\u0000${tool}`;
    let c = counts.get(key);
    if (c === undefined) {
      c = { agent, tool, calls: 0, ok: 0, failed: 0 };
      counts.set(key, c);
    }
    return c;
  };
  for (const e of trace) {
    if (e.type === "tool_call") entry(e.agent, e.tool).calls++;
    if (e.type === "tool_result") {
      const c = entry(e.agent, e.tool);
      if (e.ok) c.ok++;
      else c.failed++;
    }
  }

  const finalStatuses: Record<string, string> = {};
  for (const e of trace) if (e.type === "agent_end") finalStatuses[e.agent] = e.status;

  return {
    delegations,
    overlap,
    tools: [...counts.values()],
    skills: trace.flatMap((e) => (e.type === "skill_loaded" ? [{ agent: e.agent, skill: e.skill, atMs: off(e.ts) }] : [])),
    mcpUnavailable: trace.flatMap((e) => (e.type === "mcp_unavailable" ? [{ agent: e.agent, reason: e.reason }] : [])),
    finalStatuses,
  };
}

// ---------------------------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------------------------

type Verdict = "PASS" | "FAIL" | "INFO";
interface Expectation {
  readonly verdict: Verdict;
  readonly text: string;
}

const pf = (ok: boolean, text: string): Expectation => ({ verdict: ok ? "PASS" : "FAIL", text });
const info = (text: string): Expectation => ({ verdict: "INFO", text });

/** The outcome of one HTTP request. `response` is absent when the request or validation failed. */
interface RunRecord {
  readonly user: string;
  readonly prompt: string;
  readonly httpStatus: number | undefined;
  readonly response: ChatResponse | undefined;
  readonly error: string | undefined;
  readonly summary: Summary | undefined;
}

const delegatedTo = (s: Summary, agent: Specialist) => s.delegations.filter((d) => d.agent === agent);
const toolOf = (s: Summary, agent: AgentId, tool: string) => s.tools.find((t) => t.agent === agent && t.tool === tool);
const orchestratorOk = (r: ChatResponse, s: Summary) => r.status === "ok" && s.finalStatuses["orchestrator"] === "ok" && r.reply.trim() !== "";

/** The equipment profile that the knowledge base assigns to engineers. */
const ENGINEER_PROFILE = "Developer Workstation";

type Evaluate = (runs: readonly RunRecord[]) => Expectation[];

function single(runs: readonly RunRecord[], body: (r: ChatResponse, s: Summary) => Expectation[]): Expectation[] {
  const run = runs[0];
  if (run?.response === undefined || run.summary === undefined) {
    return [pf(false, `The request did not produce a valid response: ${run?.error ?? "no run"}`)];
  }
  return body(run.response, run.summary);
}

const evaluate01: Evaluate = (runs) =>
  single(runs, (r, s) => [
    pf(delegatedTo(s, "it").length > 0, "The IT specialist was delegated to"),
    pf(delegatedTo(s, "hr").length === 0, "The HR specialist was not delegated to"),
    pf(s.skills.some((k) => k.agent === "it"), `The IT specialist loaded a skill (${s.skills.map((k) => k.skill).join(", ") || "none"})`),
    pf((toolOf(s, "it", "get_service_status")?.calls ?? 0) > 0, "The IT specialist called the native tool get_service_status"),
    pf(orchestratorOk(r, s), "The orchestrator finished with status ok and a non-empty reply"),
  ]);

const evaluate02: Evaluate = (runs) =>
  single(runs, (r, s) => [
    pf(delegatedTo(s, "hr").length > 0, "The HR specialist was delegated to"),
    pf((toolOf(s, "hr", "kb_search")?.ok ?? 0) > 0, "The HR specialist retrieved knowledge through the MCP tool kb_search (at least one successful result)"),
    pf(s.mcpUnavailable.length === 0, "No mcp_unavailable event"),
    info(`IT specialist delegations: ${delegatedTo(s, "it").length}`),
    pf(orchestratorOk(r, s), "The orchestrator finished with status ok and a non-empty reply"),
  ]);

const evaluate03: Evaluate = (runs) =>
  single(runs, (r, s) => {
    const it = delegatedTo(s, "it")[0];
    const hr = delegatedTo(s, "hr")[0];
    const both = it !== undefined && hr !== undefined;
    const concurrent =
      both &&
      it.endMs !== undefined &&
      hr.endMs !== undefined &&
      it.startMs < hr.endMs &&
      hr.startMs < it.endMs;
    return [
      pf(both, "Both specialists were delegated to"),
      pf(concurrent, "Both specialists started before either finished (spans overlap)"),
      pf(orchestratorOk(r, s), "One combined reply: the orchestrator finished with status ok and a non-empty reply"),
    ];
  });

const evaluate04: Evaluate = (runs) =>
  single(runs, (r, s) => {
    const it = delegatedTo(s, "it")[0];
    const hr = delegatedTo(s, "hr")[0];
    const hrFound = s.tools.some((t) => t.agent === "hr" && t.tool === "kb_search" && t.ok > 0);
    return [
      pf(hr !== undefined && it !== undefined, "Both specialists were delegated to"),
      pf(
        hr?.endMs !== undefined && it !== undefined && it.startMs >= hr.endMs,
        "The IT delegation started after the HR delegation ended (sequential)",
      ),
      pf(
        it !== undefined && it.task.toLowerCase().includes(ENGINEER_PROFILE.toLowerCase()),
        `The IT task text contains the equipment profile found by HR ("${ENGINEER_PROFILE}")`,
      ),
      info(`HR retrieved knowledge successfully: ${hrFound ? "yes" : "no"}`),
      pf(orchestratorOk(r, s), "The orchestrator finished with status ok and a non-empty reply"),
    ];
  });

const evaluate05: Evaluate = (runs) => {
  const ana = runs.find((r) => r.user === "ana");
  const marko = runs.find((r) => r.user === "marko");
  const out: Expectation[] = [];
  if (ana?.summary === undefined) out.push(pf(false, `ana: no valid response (${ana?.error ?? "no run"})`));
  else {
    out.push(pf(!ana.summary.tools.some((t) => t.tool === "get_salary_band"), "ana: no get_salary_band call by any agent"));
    out.push(info(`ana: HR delegations: ${delegatedTo(ana.summary, "hr").length}; the reply must state that this is not possible (check the reply text)`));
  }
  if (marko?.summary === undefined) out.push(pf(false, `marko: no valid response (${marko?.error ?? "no run"})`));
  else out.push(pf((toolOf(marko.summary, "hr", "get_salary_band")?.ok ?? 0) > 0, "marko: a successful get_salary_band call by the HR specialist"));
  return out;
};

// ---------------------------------------------------------------------------------------------
// Scenario catalogue
// ---------------------------------------------------------------------------------------------

interface RunSpec {
  readonly user: string;
  readonly prompt: string;
}

interface Scenario {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly expected: string;
  readonly runs: readonly RunSpec[];
  readonly evaluate: Evaluate;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "01",
    slug: "it-support",
    title: "IT support question",
    expected: "IT delegation, skill loading, native tool use.",
    runs: [{ user: "ana", prompt: "My VPN keeps disconnecting every few minutes when I work from home. Can you help me fix it?" }],
    evaluate: evaluate01,
  },
  {
    id: "02",
    slug: "hr-policy",
    title: "HR policy question",
    expected: "HR delegation, MCP-backed retrieval.",
    runs: [{ user: "ana", prompt: "What is the company policy on working remotely, and how do I request it?" }],
    evaluate: evaluate02,
  },
  {
    id: "03",
    slug: "parallel-it-hr",
    title: "Independent IT and HR questions in one request",
    expected: "Concurrent execution of both specialists and one combined response.",
    runs: [{ user: "ana", prompt: "Two things: my laptop will not turn on at all, and how many days of annual leave am I entitled to?" }],
    evaluate: evaluate03,
  },
  {
    id: "04",
    slug: "sequential-hr-then-it",
    title: "IT recommendation that depends on an HR policy result",
    expected:
      "Sequential execution: HR identifies an equipment profile, its result is passed explicitly into the IT task, and IT uses it for setup guidance.",
    runs: [
      {
        user: "ana",
        prompt:
          "A new backend developer joins my team next Monday. Check the HR policy to find out which equipment profile applies to engineers, and then tell me how IT will set that equipment up.",
      },
    ],
    evaluate: evaluate04,
  },
  {
    id: "05",
    slug: "role-permissions",
    title: "A capability the user's role lacks (salary band), compared across roles",
    expected:
      "For the employee the capability is not exposed to any agent and the orchestrator explains it cannot be done; for the manager the same question is answered through the HR specialist.",
    runs: [
      { user: "ana", prompt: "What is the salary band for a senior developer?" },
      { user: "marko", prompt: "What is the salary band for a senior developer?" },
    ],
    evaluate: evaluate05,
  },
];

interface NotImplemented {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

const NOT_IMPLEMENTED: readonly NotImplemented[] = [
  {
    id: "06",
    slug: "specialist-missing-capability",
    title: "A specialist is delegated a task that needs a capability it lacks"
  },
  {
    id: "07",
    slug: "mcp-failure",
    title: "Integration failure (MCP server in failure mode)"
  },
];

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

const BASE_URL = (process.env["BASE_URL"] ?? "http://localhost:8787").replace(/\/+$/, "");
const CHAT_TIMEOUT_MS = 120_000;

async function assertServerReachable(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/users`, { signal: AbortSignal.timeout(5_000) });
    const parsed = UsersResponse.safeParse(await res.json().catch(() => null));
    if (!res.ok || !parsed.success) {
      throw new Error(`unexpected response from /api/users (HTTP ${res.status})`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`Cannot reach the assistant at ${BASE_URL} (${reason}).`);
    console.error("Start it first with `npm run dev` (Node >= 22.12, ANTHROPIC_API_KEY in .dev.vars), or set BASE_URL.");
    process.exit(1);
  }
}

async function runOnce(spec: RunSpec): Promise<RunRecord> {
  const base = { user: spec.user, prompt: spec.prompt };
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-User": spec.user },
      body: JSON.stringify({ message: spec.prompt }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const body = ErrorBody.safeParse(json);
      const detail = body.success ? `${body.data.error}: ${body.data.message}` : "unparseable error body";
      return { ...base, httpStatus: res.status, response: undefined, error: `HTTP ${res.status} (${detail})`, summary: undefined };
    }
    const parsed = ChatResponse.safeParse(json);
    if (!parsed.success) {
      return { ...base, httpStatus: res.status, response: undefined, error: `response failed validation: ${parsed.error.message}`, summary: undefined };
    }
    return { ...base, httpStatus: res.status, response: parsed.data, error: undefined, summary: summarize(parsed.data.trace) };
  } catch (err) {
    return { ...base, httpStatus: undefined, response: undefined, error: err instanceof Error ? err.message : String(err), summary: undefined };
  }
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

interface Attempt {
  readonly runs: readonly RunRecord[];
  readonly expectations: readonly Expectation[];
}

interface ScenarioOutcome {
  readonly scenario: Scenario;
  readonly attempts: readonly Attempt[];
  /** Index of the attempt shown in the markdown file: always the last one. */
  readonly shown: number;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = `${ROOT}examples/scenarios`;

function readModel(): { provider: string; id: string } {
  const text = readFileSync(`${ROOT}wrangler.jsonc`, "utf8");
  // String-aware comment stripper (a plain regex would break on "//" inside strings).
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    const n = text[i + 1] ?? "";
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  const cfg = WranglerConfig.parse(JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")));
  return { provider: cfg.vars.MODEL_PROVIDER, id: cfg.vars.MODEL_ID };
}

const fmtMs = (ms: number | undefined) => (ms === undefined ? "?" : `${ms} ms`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const codeBlock = (s: string) => {
  const fence = s.includes("```") ? "~~~~" : "```";
  return `${fence}text\n${s}\n${fence}`;
};

function runMarkdown(run: RunRecord): string[] {
  const lines = [`- User: \`${run.user}\` (header \`X-User: ${run.user}\`)`, "", "Prompt:", "", codeBlock(run.prompt), ""];
  if (run.response === undefined || run.summary === undefined) {
    return [...lines, `Request failed: ${run.error ?? "unknown error"}`, ""];
  }
  const s = run.summary;
  lines.push("Delegations (offsets in ms from the first trace event):", "");
  if (s.delegations.length === 0) lines.push("None.", "");
  else {
    lines.push("| # | Agent | Start | End | Status | Task (as written by the orchestrator) |", "|---|---|---|---|---|---|");
    s.delegations.forEach((d, i) =>
      lines.push(`| ${i + 1} | ${d.agent} | ${d.startMs} | ${fmtMs(d.endMs).replace(" ms", "")} | ${d.status} | ${cell(d.task)} |`),
    );
    lines.push("", `Specialist spans overlap: ${s.overlap ? "yes" : "no"}`, "");
  }
  lines.push("Tools per agent:", "");
  if (s.tools.length === 0) lines.push("None.", "");
  else {
    lines.push("| Agent | Tool | Calls | ok | failed |", "|---|---|---|---|---|");
    for (const t of s.tools) lines.push(`| ${t.agent} | ${t.tool} | ${t.calls} | ${t.ok} | ${t.failed} |`);
    lines.push("");
  }
  lines.push(
    `Skills loaded: ${s.skills.length === 0 ? "none" : s.skills.map((k) => `${k.skill} (by ${k.agent}, at ${k.atMs} ms)`).join(", ")}`,
    `mcp_unavailable events: ${s.mcpUnavailable.length}`,
    `Final statuses: ${Object.entries(s.finalStatuses).map(([a, st]) => `${a}=${st}`).join(", ") || "none"}; response status: ${run.response.status}`,
    "",
    "Final reply:",
    "",
    codeBlock(run.response.reply),
    "",
  );
  return lines;
}

function scenarioMarkdown(o: ScenarioOutcome, model: { provider: string; id: string }, date: string): string {
  const { scenario } = o;
  const shown = o.attempts[o.shown];
  const lines = [
    `# Scenario ${scenario.id}: ${scenario.title}`,
    "",
    `Expected behaviour: ${scenario.expected}`,
    "",
    `Model: ${model.provider} / ${model.id}. Date: ${date}. Attempts made: ${o.attempts.length}; shown: attempt ${o.shown + 1}.`,
    "",
    "## Run",
    "",
  ];
  for (const run of shown?.runs ?? []) {
    lines.push(...runMarkdown(run));
  }
  lines.push("## Expectations", "");
  for (const e of shown?.expectations ?? []) lines.push(`- ${e.verdict}: ${e.text}`);
  if (o.attempts.length > 1) {
    lines.push("", "## All attempts", "");
    o.attempts.forEach((a, i) => {
      const tally = (v: Verdict) => a.expectations.filter((e) => e.verdict === v).length;
      lines.push(`- Attempt ${i + 1}${i === o.shown ? " (shown above)" : ""}: ${tally("PASS")} PASS, ${tally("FAIL")} FAIL, ${tally("INFO")} INFO`);
    });
    lines.push("", "The full trace of every attempt is in the JSON file.");
  }
  return `${lines.join("\n")}\n`;
}

function notImplementedMarkdown(n: NotImplemented): string {
  return [
    `# Scenario ${n.id}: ${n.title}`,
    "",
    "Status: NOT IMPLEMENTED",
    "",
    "Reason: time-boxed. Nothing was run for this scenario, so there is no result to report.",
    "",
  ].join("\n");
}

function indexMarkdown(outcomes: readonly ScenarioOutcome[], model: { provider: string; id: string }, date: string): string {
  const lines = [
    "# Scenario examples",
    "",
    `Each scenario was run once per prompt (unless noted) against the real application with ${model.provider} / ${model.id} on ${date}.`,
    "The reviewer-relevant evidence is the trace (delegation, skills, tools, permissions), not the wording of the replies.",
    "Expectations are reported as they happened; none were adjusted to pass.",
    "",
    "| # | Scenario | Outcome | Details |",
    "|---|---|---|---|",
  ];
  for (const o of outcomes) {
    const shown = o.attempts[o.shown];
    const exps = shown?.expectations ?? [];
    const fails = exps.filter((e) => e.verdict === "FAIL").length;
    const outcome = `${fails === 0 ? "PASS" : "FAIL"} (${exps.filter((e) => e.verdict === "PASS").length} PASS, ${fails} FAIL, ${exps.filter((e) => e.verdict === "INFO").length} INFO)`;
    lines.push(`| ${o.scenario.id} | ${o.scenario.title} | ${outcome} | [md](${o.scenario.id}-${o.scenario.slug}.md), [json](${o.scenario.id}-${o.scenario.slug}.json) |`);
  }
  for (const n of NOT_IMPLEMENTED) {
    lines.push(`| ${n.id} | ${n.title} | Not implemented | [md](${n.id}-${n.slug}.md) |`);
  }
  lines.push("");
  for (const o of outcomes) {
    lines.push(`## ${o.scenario.id} ${o.scenario.title}`, "");
    for (const e of o.attempts[o.shown]?.expectations ?? []) lines.push(`- ${e.verdict}: ${e.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): { retries: number; only: string | undefined } {
  let retries = 0;
  let only: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--retries") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error("--retries expects an integer from 0 to 5");
      retries = n;
    } else if (a === "--only") {
      only = argv[++i];
    } else if (a !== "--") {
      throw new Error(`Unknown argument: ${a ?? ""}`);
    }
  }
  return { retries, only };
}

async function runScenario(scenario: Scenario, retries: number): Promise<ScenarioOutcome> {
  const attempts: Attempt[] = [];
  for (let n = 0; n <= retries; n++) {
    const runs: RunRecord[] = [];
    for (const spec of scenario.runs) runs.push(await runOnce(spec));
    const expectations = scenario.evaluate(runs);
    attempts.push({ runs, expectations });
    if (!expectations.some((e) => e.verdict === "FAIL")) break; // retries only follow a deviation
  }
  return { scenario, attempts, shown: attempts.length - 1 };
}

async function main(): Promise<void> {
  const { retries, only } = parseArgs(process.argv.slice(2));
  await assertServerReachable();
  const model = readModel();
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });

  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of SCENARIOS) {
    if (only !== undefined && only !== scenario.id) continue;
    console.log(`\nScenario ${scenario.id}: ${scenario.title}`);
    const outcome = await runScenario(scenario, retries);
    outcomes.push(outcome);
    outcome.attempts.forEach((a, i) => {
      if (outcome.attempts.length > 1) console.log(`  attempt ${i + 1}${i === outcome.shown ? " (shown)" : ""}`);
      for (const e of a.expectations) console.log(`  ${e.verdict}  ${e.text}`);
    });
    const base = `${OUT_DIR}/${scenario.id}-${scenario.slug}`;
    const json = {
      scenario: { id: scenario.id, title: scenario.title, expected: scenario.expected },
      model,
      date,
      shownAttempt: outcome.shown + 1,
      attempts: outcome.attempts,
    };
    writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
    writeFileSync(`${base}.md`, scenarioMarkdown(outcome, model, date));
  }

  for (const n of NOT_IMPLEMENTED) {
    writeFileSync(`${OUT_DIR}/${n.id}-${n.slug}.md`, notImplementedMarkdown(n));
    console.log(`\nScenario ${n.id}: ${n.title}\n  NOT IMPLEMENTED due to lack of time`);
  }
  if (only === undefined) {
    writeFileSync(`${OUT_DIR}/README.md`, indexMarkdown(outcomes, model, date));
  } else {
    console.log("\n--only was used: the index README.md was not rewritten.");
  }
  console.log(`\nWritten to ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
