import { APICallError, generateText, isStepCount } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { AGENT_TIMEOUT_MS, MAX_INPUT_CHARS } from "../config";
import type { AgentId, RequestContext, TraceEvent } from "../types";

/**
 * One agent = one configuration. Orchestrator, IT and HR all run through runAgent() with
 * different specs (R1, R7). Tools are already filtered/guarded when `tools(ctx)` builds them:
 * runAgent runs whatever it is given and knows nothing about permissions.
 */
export interface AgentSpec {
  readonly id: AgentId;
  systemPrompt(ctx: RequestContext): string;
  tools(ctx: RequestContext): ToolSet;
  readonly maxSteps: number;
}

export type RunStatus = "ok" | "error" | "timeout";

export interface RunAgentOptions {
  /** Injected (never created here) so tests can pass a mock model. */
  readonly model: LanguageModel;
  /** This agent's own history. Never mutated. */
  readonly history: readonly ModelMessage[];
  readonly userInput: string;
  readonly ctx: RequestContext;
  /** Per-run wall-clock limit; defaults to AGENT_TIMEOUT_MS. Injectable for tests. */
  readonly timeoutMs?: number;
}

export interface RunAgentResult {
  /** Final answer, or a short human-readable failure message the caller can relay honestly. */
  readonly text: string;
  /**
   * What the caller should append to this agent's history: the user message plus the
   * assistant/tool messages of this turn. `[]` for rejected input, `[user]` for failed runs.
   */
  readonly newMessages: ModelMessage[];
  readonly status: RunStatus;
}

const SUMMARY_MAX_CHARS = 200;

function summarize(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = "[unserializable]";
  }
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}…` : text;
}

/** A tool result counts as failed when it is `{ ok: false }` or carries an `error` key. */
function isFailedOutput(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  return ("ok" in output && output.ok === false) || "error" in output;
}

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Fixed messages only: err.message, stacks, headers and provider bodies never leave this file. */
function failureText(err: unknown): string {
  if (APICallError.isInstance(err) && err.statusCode !== undefined) {
    return `The model provider returned an error (HTTP ${err.statusCode}).`;
  }
  return "The agent failed due to an internal error.";
}

export async function runAgent(spec: AgentSpec, options: RunAgentOptions): Promise<RunAgentResult> {
  const { model, history, userInput, ctx } = options;

  if (userInput.trim() === "") {
    return { status: "error", text: "The message is empty.", newMessages: [] };
  }
  if (userInput.length > MAX_INPUT_CHARS) {
    return {
      status: "error",
      text: `The message is too long (${userInput.length} characters; the limit is ${MAX_INPUT_CHARS}).`,
      newMessages: [],
    };
  }

  const userMessage: ModelMessage = { role: "user", content: userInput };
  const failed = (status: "error" | "timeout", text: string): RunAgentResult => ({
    status,
    text,
    newMessages: [userMessage],
  });

  const emit = (event: Omit<Extract<TraceEvent, { type: "tool_call" }>, "ts" | "agent">) =>
    void ctx.trace.push({ ts: Date.now(), agent: spec.id, ...event });
  const emitResult = (tool: string, ok: boolean, summary: string) =>
    void ctx.trace.push({ ts: Date.now(), agent: spec.id, type: "tool_result", tool, ok, summary });

  const traced = new Set<string>();
  const signal = AbortSignal.any([
    ctx.signal,
    AbortSignal.timeout(options.timeoutMs ?? AGENT_TIMEOUT_MS),
  ]);

  try {
    const result = await generateText({
      model,
      instructions: spec.systemPrompt(ctx),
      messages: [...history, userMessage],
      tools: spec.tools(ctx),
      stopWhen: isStepCount(spec.maxSteps),
      abortSignal: signal,
      // Default is 2; retries share the timeout budget, so keep them minimal.
      maxRetries: 1,
      onToolExecutionStart: ({ toolCall }) => {
        traced.add(toolCall.toolCallId);
        emit({ type: "tool_call", tool: toolCall.toolName, input: toolCall.input });
      },
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        if (toolOutput.type === "tool-error") {
          emitResult(toolCall.toolName, false, summarize(toolOutput.error instanceof Error ? toolOutput.error.message : toolOutput.error));
        } else {
          emitResult(toolCall.toolName, !isFailedOutput(toolOutput.output), summarize(toolOutput.output));
        }
      },
    });

    // The SDK does not fire the execution hooks for calls it rejects itself (unknown tool,
    // invalid input), so trace those from the step contents.
    for (const step of result.steps) {
      for (const part of step.content) {
        if (part.type === "tool-error" && !traced.has(part.toolCallId)) {
          emit({ type: "tool_call", tool: part.toolName, input: part.input });
          emitResult(part.toolName, false, "tool call rejected (unknown tool or invalid input)");
        }
      }
    }

    if (result.finishReason === "tool-calls") {
      return failed(
        "error",
        `The agent stopped after reaching its step limit (${spec.maxSteps}) without producing an answer.`,
      );
    }
    if (result.text.trim() === "") {
      return failed("error", "The agent returned an empty answer.");
    }
    // response.messages only holds the LAST step; responseMessages accumulates all steps.
    return {
      status: "ok",
      text: result.text,
      newMessages: [userMessage, ...result.responseMessages],
    };
  } catch (err) {
    if (signal.aborted || isAbortLike(err)) {
      return failed("timeout", "The agent did not finish in time.");
    }
    return failed("error", failureText(err));
  }
}
