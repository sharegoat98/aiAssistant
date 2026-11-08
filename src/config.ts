/**
 * Limits that bound every request (R8). Nothing in the app may loop, wait or accept input
 * without one of these.
 */

/**
 * Max model steps (LLM call + tool executions) for the orchestrator. Higher than a specialist's:
 * it must delegate (possibly to both specialists, possibly in sequence) and then write the final
 * answer. 8 covers "delegate, delegate, delegate again with forwarded results, synthesise"
 * with headroom, while capping runaway loops.
 */
export const MAX_STEPS_ORCHESTRATOR = 8;

/**
 * Max model steps for a specialist (IT or HR). Their work is a few tool calls (one possibly
 * preceded by load_skill) and a summary; 5 is enough and keeps one specialist from burning
 * the whole request budget.
 */
export const MAX_STEPS_SPECIALIST = 5;

/**
 * Wall-clock timeout for a single agent run, in ms. A specialist that exceeds it is reported
 * to the orchestrator as "timeout" rather than hanging the request. 25 s fits a few sequential
 * model calls at typical latency (~2-5 s each).
 */
export const AGENT_TIMEOUT_MS = 25_000;

/**
 * Wall-clock timeout for the whole HTTP request, in ms. Must exceed AGENT_TIMEOUT_MS so the
 * orchestrator still has time to synthesise an honest answer after a specialist times out
 * (25 s specialist + a second specialist's sequential run is bounded by this overall cap).
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Max length of a user message, in characters. Roughly 500 tokens: ample for an IT/HR
 * question, small enough to limit cost and prompt-injection payload size. Longer input is
 * rejected before it reaches a model.
 */
export const MAX_INPUT_CHARS = 2_000;

/**
 * Max messages kept in an agent's history (user + assistant + tool messages). 20 is about ten
 * conversational turns: enough for follow-up questions, while bounding prompt size and cost.
 * Older messages are dropped.
 */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * Max time for connecting to the MCP server AND discovering its tools (listTools), in ms. The
 * server runs in-process, so a healthy connect takes milliseconds; 3 s is generous and keeps a
 * dead or hanging server from eating into the agent's AGENT_TIMEOUT_MS budget.
 */
export const MCP_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Max time for one MCP tool call, in ms. A knowledge-base lookup is an in-memory search; 5 s
 * leaves room for cold starts and still lets the agent report "unavailable" well before its
 * own timeout.
 */
export const MCP_CALL_TIMEOUT_MS = 5_000;

/**
 * Max specialist delegations (tool calls to ask_it_specialist / ask_hr_specialist) in one user
 * request. 4 covers both domains plus one follow-up delegation with forwarded results per domain,
 * stays below MAX_STEPS_ORCHESTRATOR (8) and caps the cost of a looping model. Calls beyond it
 * return "unavailable" without running anything.
 */
export const MAX_DELEGATIONS_PER_REQUEST = 4;
