import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { asSchema, type Tool, type ToolSet } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  connectMcp,
  inProcessHttpTransport,
  withMcpTools,
  type KbToolResult,
  type McpTransportFactory,
} from "../src/mcp/client";
import { createKnowledgeServer, handleMcpRequest } from "../src/mcp/server";
import type { RequestContext, Role } from "../src/types";

function makeCtx(role: Role = "employee"): RequestContext {
  return {
    userId: "u1",
    role,
    sessionId: "s1",
    trace: [],
    signal: new AbortController().signal,
  };
}

/** In-memory transport factory backed by the given server; records opened servers. */
function inMemory(server: McpServer = createKnowledgeServer()): McpTransportFactory {
  return () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    void server.connect(serverT);
    return clientT;
  };
}

async function call(t: ToolSet[string] | undefined, input: unknown): Promise<KbToolResult> {
  if (t?.execute === undefined) throw new Error("tool missing");
  return (await t.execute(input as never, {
    toolCallId: "c1",
    messages: [],
  } as never)) as KbToolResult;
}

afterEach(() => vi.restoreAllMocks());

describe("connectMcp discovery and invocation", () => {
  it("discovers via listTools and invokes over the in-memory transport", async () => {
    const spy = vi.spyOn(Client.prototype, "listTools");
    const conn = await connectMcp(makeCtx(), "it", inMemory());
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(Object.keys(conn.tools)).toEqual(["kb_search"]);
      const res = await call(conn.tools.kb_search, { query: "password reset" });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.results.map((r) => r.id)).toContain("it-password-reset");
    } finally {
      await conn.close();
    }
  });

  it("works through handleMcpRequest in-process (real protocol, no network)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const conn = await connectMcp(makeCtx(), "hr", inProcessHttpTransport(handleMcpRequest));
    try {
      expect(conn.unavailable).toBe(false);
      const res = await call(conn.tools.kb_search, { query: "annual leave" });
      expect(res.ok && res.results.map((r) => r.id)).toContain("hr-annual-leave");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await conn.close();
    }
  });

  it("drops unknown tools (default deny) and yields an empty set when none are mapped", async () => {
    const extra = createKnowledgeServer();
    extra.registerTool("admin_dump", { inputSchema: z.object({}) }, () => ({
      content: [{ type: "text" as const, text: "secrets" }],
    }));
    const conn = await connectMcp(makeCtx(), "it", inMemory(extra));
    expect(Object.keys(conn.tools)).toEqual(["kb_search"]);
    await conn.close();

    const onlyUnknown = new McpServer({ name: "x", version: "1.0.0" });
    onlyUnknown.registerTool("admin_dump", { inputSchema: z.object({}) }, () => ({
      content: [{ type: "text" as const, text: "secrets" }],
    }));
    const empty = await connectMcp(makeCtx(), "it", inMemory(onlyUnknown));
    expect(empty.tools).toEqual({});
    expect(empty.unavailable).toBe(false);
    await empty.close();
  });
});

describe("domain pinning", () => {
  it("shows the model a schema without `domain`", async () => {
    const conn = await connectMcp(makeCtx(), "it", inMemory());
    try {
      const schema = asSchema(conn.tools.kb_search?.inputSchema).jsonSchema as {
        properties?: Record<string, unknown>;
      };
      expect(Object.keys(schema.properties ?? {})).toEqual(["query"]);
    } finally {
      await conn.close();
    }
  });

  it.each([
    ["it", "hr", "leave"],
    ["hr", "it", "password"],
  ] as const)("%s agent ignores a model-sent domain=%s", async (agent, other, query) => {
    const conn = await connectMcp(makeCtx(), agent, inMemory());
    try {
      const res = await call(conn.tools.kb_search, { query, domain: other });
      expect(res.ok).toBe(true);
      if (res.ok) {
        for (const r of res.results) expect(r.id.startsWith(`${agent}-`)).toBe(true);
      }
    } finally {
      await conn.close();
    }
  });
});

describe("permissions", () => {
  it.each(["employee", "manager"] as const)("%s gets kb_search for it and hr", async (role) => {
    for (const agent of ["it", "hr"] as const) {
      const conn = await connectMcp(makeCtx(role), agent, inMemory());
      expect(Object.keys(conn.tools)).toEqual(["kb_search"]);
      await conn.close();
    }
  });

  it("gives the orchestrator nothing and never creates a transport", async () => {
    const factory = vi.fn<McpTransportFactory>(inMemory());
    const conn = await connectMcp(makeCtx(), "orchestrator", factory);
    expect(conn.tools).toEqual({});
    expect(conn.unavailable).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it("guardTool refuses at execution time for a denied agent", async () => {
    // Build tools for "it", then re-guard as if an orchestrator held them.
    const { guardTool } = await import("../src/permissions/policy");
    const conn = await connectMcp(makeCtx(), "it", inMemory());
    try {
      const t = conn.tools.kb_search;
      if (t === undefined) throw new Error("missing");
      const denied = guardTool("kb_search", t as Tool, "employee", "orchestrator");
      expect(await call(denied, { query: "vpn" })).toMatchObject({ error: "forbidden" });
    } finally {
      await conn.close();
    }
  });
});

describe("unavailable server", () => {
  it("degrades to an empty set with one mcp_unavailable event and no retry", async () => {
    const ctx = makeCtx();
    const failing = vi.fn<McpTransportFactory>(() => {
      const t: Transport = {
        start: () => Promise.reject(new Error("ECONNREFUSED secret-host:1234")),
        send: () => Promise.reject(new Error("nope")),
        close: () => Promise.resolve(),
      };
      return t;
    });
    const conn = await connectMcp(ctx, "it", failing);
    expect(conn.tools).toEqual({});
    expect(conn.unavailable).toBe(true);
    expect(failing).toHaveBeenCalledTimes(1);
    const events = ctx.trace.filter((e) => e.type === "mcp_unavailable");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/secret-host|ECONNREFUSED/);
  });

  it("times out on a server that never answers", async () => {
    const ctx = makeCtx();
    const hanging: McpTransportFactory = () => ({
      start: () => new Promise<void>(() => {}),
      send: () => new Promise<void>(() => {}),
      close: () => Promise.resolve(),
    });
    const conn = await connectMcp(ctx, "hr", hanging, { connectTimeoutMs: 50 });
    expect(conn.unavailable).toBe(true);
    expect(ctx.trace[0]).toMatchObject({ type: "mcp_unavailable", reason: "connect_timeout" });
  });
});

describe("lifecycle", () => {
  it("closes the client on success and on failure of fn", async () => {
    const closeSpy = vi.spyOn(Client.prototype, "close");
    const ok = await withMcpTools(makeCtx(), "it", inMemory(), async (c) => Object.keys(c.tools));
    expect(ok).toEqual(["kb_search"]);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    await expect(
      withMcpTools(makeCtx(), "it", inMemory(), async () => {
        throw new Error("agent blew up");
      }),
    ).rejects.toThrow("agent blew up");
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });
});

describe("result mapping", () => {
  function serverReturning(handler: () => unknown): McpServer {
    const s = new McpServer({ name: "x", version: "1.0.0" });
    s.registerTool(
      "search_knowledge_base",
      { description: "kb", inputSchema: z.object({ query: z.string(), domain: z.string() }) },
      handler as never,
    );
    return s;
  }

  it("maps isError to kb_error without leaking the server message", async () => {
    const server = serverReturning(() => ({
      isError: true,
      content: [{ type: "text", text: "Traceback: /srv/secret.ts:42" }],
    }));
    const conn = await connectMcp(makeCtx(), "it", inMemory(server));
    const res = await call(conn.tools.kb_search, { query: "x" });
    expect(res).toMatchObject({ ok: false, error: "kb_error" });
    expect(JSON.stringify(res)).not.toMatch(/secret|Traceback/);
    await conn.close();
  });

  it("maps a failure mid-call to kb_unavailable without leaking the raw error", async () => {
    const conn = await connectMcp(makeCtx(), "it", inMemory());
    await conn.close(); // connection gone: the call must fail
    const res = await call(conn.tools.kb_search, { query: "vpn" });
    expect(res).toMatchObject({ ok: false, error: "kb_unavailable" });
    expect(JSON.stringify(res)).not.toMatch(/Not connected|Error:/);
  });
});
