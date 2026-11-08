import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { MCP_CALL_TIMEOUT_MS, MCP_CONNECT_TIMEOUT_MS } from "../config";
import { filterTools, guardTool } from "../permissions/policy";
import type { CapabilityId } from "../permissions/registry";
import type { AgentId, RequestContext } from "../types";
import type { KbDomain } from "../data/kb";

/**
 * Explicit allow map: discovered MCP tool name -> capability id from the registry.
 * A discovered tool NOT listed here is dropped (default deny).
 */
export const MCP_TOOL_MAP = {
  search_knowledge_base: "kb_search",
} as const satisfies Record<string, CapabilityId>;

/** For the agent prompt builder (step 8a), used when `McpConnection.unavailable` is true. */
export const MCP_UNAVAILABLE_NOTE = "The company knowledge base is currently unavailable.";

/** Creates a fresh transport per connection. Injected so tests and production differ. */
export type McpTransportFactory = () => Transport;

/**
 * Production transport: real MCP Streamable HTTP protocol, but every request is answered
 * in-process by `handler` (handleMcpRequest). The URL is a placeholder and is never fetched.
 */
export function inProcessHttpTransport(
  handler: (request: Request) => Promise<Response>,
): McpTransportFactory {
  return () =>
    new StreamableHTTPClientTransport(new URL("http://mcp.internal/mcp"), {
      fetch: (input, init) => handler(new Request(input, init)),
    });
}

export interface KbResultItem {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
}

export type KbToolResult =
  | { readonly ok: true; readonly results: readonly KbResultItem[] }
  | {
      readonly ok: false;
      readonly error: "kb_unavailable" | "kb_error";
      readonly message: string;
    };

const KB_UNAVAILABLE: KbToolResult = {
  ok: false,
  error: "kb_unavailable",
  message: "The knowledge base is currently unavailable.",
};
const KB_ERROR: KbToolResult = {
  ok: false,
  error: "kb_error",
  message: "The knowledge base search failed.",
};

const KbPayload = z.object({
  results: z.array(z.object({ id: z.string(), title: z.string(), snippet: z.string() })),
});

/** What the model sees: NO `domain` field, it is pinned by the agent configuration. */
const ModelSearchInput = z.object({
  query: z.string().trim().min(1).max(200).describe("Keywords to search for."),
});

export interface McpConnection {
  /** Filtered and guarded tools, keyed by capability id. Empty when unavailable. */
  readonly tools: ToolSet;
  /** True when the server could not be reached; the prompt should say so (R6). */
  readonly unavailable: boolean;
  close(): Promise<void>;
}

export interface ConnectMcpOptions {
  readonly connectTimeoutMs?: number;
  readonly callTimeoutMs?: number;
}

function pinnedDomain(agent: AgentId): KbDomain | undefined {
  return agent === "it" ? "it" : agent === "hr" ? "hr" : undefined;
}

function parseResult(raw: Readonly<Record<string, unknown>>): KbToolResult {
  if (raw.isError === true) return KB_ERROR;
  const structured = KbPayload.safeParse(raw.structuredContent);
  if (structured.success) return { ok: true, results: structured.data.results };
  if (Array.isArray(raw.content)) {
    for (const part of raw.content as unknown[]) {
      if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
        try {
          const parsed = KbPayload.safeParse(JSON.parse(part.text));
          if (parsed.success) return { ok: true, results: parsed.data.results };
        } catch {
          // fall through to kb_error
        }
      }
    }
  }
  return KB_ERROR;
}

function buildKbTool(
  client: Client,
  mcpName: string,
  description: string | undefined,
  domain: KbDomain,
  callTimeoutMs: number,
  ctx: RequestContext,
): Tool {
  return tool({
    description: description ?? "Search the company knowledge base.",
    inputSchema: ModelSearchInput,
    execute: async ({ query }, options): Promise<KbToolResult> => {
      try {
        const raw = await client.callTool(
          // `domain` is set last: whatever the model sent can never override the pin.
          { name: mcpName, arguments: { query, domain } },
          undefined,
          {
            signal: AbortSignal.any([ctx.signal, options.abortSignal ?? ctx.signal]),
            timeout: callTimeoutMs,
          },
        );
        return parseResult(raw);
      } catch {
        return KB_UNAVAILABLE;
      }
    },
  });
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // closing must never mask the real outcome
  }
}

const EMPTY: McpConnection = { tools: {}, unavailable: false, close: async () => {} };

/**
 * Connects to the MCP server, discovers tools with listTools and returns the ones that are
 * mapped, permitted for (ctx.role, agent) and guarded at execution time. The caller owns the
 * lifetime: call `close()` in a finally block (or use `withMcpTools`). Never throws.
 */
export async function connectMcp(
  ctx: RequestContext,
  agent: AgentId,
  createTransport: McpTransportFactory,
  options: ConnectMcpOptions = {},
): Promise<McpConnection> {
  const domain = pinnedDomain(agent);
  if (domain === undefined) return EMPTY; // orchestrator: no MCP tools, no client at all

  const connectTimeoutMs = options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? MCP_CALL_TIMEOUT_MS;
  const client = new Client({ name: "acme-assistant", version: "1.0.0" });

  const deadline = AbortSignal.any([ctx.signal, AbortSignal.timeout(connectTimeoutMs)]);
  const requestOptions = { signal: deadline, timeout: connectTimeoutMs };
  try {
    // The race guards against a transport that never settles and ignores the signal.
    const discovered = await Promise.race([
      (async () => {
        await client.connect(createTransport(), requestOptions);
        return client.listTools(undefined, requestOptions);
      })(),
      new Promise<never>((_, reject) =>
        deadline.addEventListener("abort", () => reject(new Error("deadline")), { once: true }),
      ),
    ]);

    const mapped: Record<string, Tool> = {};
    for (const t of discovered.tools) {
      if (!Object.hasOwn(MCP_TOOL_MAP, t.name)) continue; // default deny
      const capId = MCP_TOOL_MAP["search_knowledge_base"];
      mapped[capId] = guardTool(
        capId,
        buildKbTool(client, t.name, t.description, domain, callTimeoutMs, ctx),
        ctx.role,
        agent,
      );
    }
    return {
      tools: filterTools(mapped, ctx.role, agent),
      unavailable: false,
      close: () => closeQuietly(client),
    };
  } catch {
    await closeQuietly(client);
    ctx.trace.push({
      ts: Date.now(),
      agent,
      type: "mcp_unavailable",
      reason: deadline.aborted ? "connect_timeout" : "connect_failed",
    });
    return { tools: {}, unavailable: true, close: async () => {} };
  }
}

/** Keeps the MCP client open for the whole of `fn` and always closes it afterwards. */
export async function withMcpTools<T>(
  ctx: RequestContext,
  agent: AgentId,
  createTransport: McpTransportFactory,
  fn: (connection: McpConnection) => Promise<T>,
  options?: ConnectMcpOptions,
): Promise<T> {
  const connection = await connectMcp(ctx, agent, createTransport, options);
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
}
