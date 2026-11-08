import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { createKnowledgeServer, KNOWLEDGE_TOOL_NAME } from "../src/mcp/server";

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createKnowledgeServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface Payload {
  results: { id: string; title: string; snippet: string }[];
}

describe("knowledge MCP server (in-memory transport)", () => {
  it("lists search_knowledge_base with the expected input schema", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([KNOWLEDGE_TOOL_NAME]);
      const schema = tools[0]?.inputSchema as {
        required?: string[];
        properties?: { domain?: { enum?: string[] } };
      };
      expect([...(schema.required ?? [])].sort()).toEqual(["domain", "query"]);
      expect(schema.properties?.domain?.enum).toEqual(["it", "hr"]);
      expect(tools[0]?.description).not.toMatch(/role|permission|agent/i);
    } finally {
      await close();
    }
  });

  it("returns results as structuredContent and JSON text", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({
        name: KNOWLEDGE_TOOL_NAME,
        arguments: { query: "vpn reinstall", domain: "it" },
      });
      const structured = res.structuredContent as Payload;
      expect(structured.results[0]?.id).toBe("it-vpn");
      const content = res.content as { type: string; text: string }[];
      expect(JSON.parse(content[0]?.text ?? "null")).toEqual(structured);
    } finally {
      await close();
    }
  });

  it("rejects an invalid domain, an empty query and a missing domain", async () => {
    const { client, close } = await connect();
    try {
      // SDK 1.32.2 reports schema violations as an isError tool result, not a protocol error.
      for (const args of [
        { query: "vpn", domain: "finance" },
        { query: "   ", domain: "it" },
        { query: "vpn" },
      ]) {
        const res = await client.callTool({ name: KNOWLEDGE_TOOL_NAME, arguments: args });
        expect(res.isError).toBe(true);
        expect(res.structuredContent).toBeUndefined();
        const content = res.content as { type: string; text: string }[];
        expect(content[0]?.text).toContain("Input validation error");
      }
    } finally {
      await close();
    }
  });

  it("returns an empty list (not an error) when nothing matches", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({
        name: KNOWLEDGE_TOOL_NAME,
        arguments: { query: "xyzzy-nonexistent", domain: "hr" },
      });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toEqual({ results: [] });
    } finally {
      await close();
    }
  });
});

describe("POST /mcp (Worker route)", () => {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  it("lists tools over Streamable HTTP", async () => {
    const res = await app.request("/mcp", { method: "POST", headers, body });
    expect(res.status).toBe(200);
    const json = await res.json<{ result: { tools: { name: string }[] } }>();
    expect(json.result.tools.map((t) => t.name)).toEqual([KNOWLEDGE_TOOL_NAME]);
  });

  it("calls the tool over Streamable HTTP", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: KNOWLEDGE_TOOL_NAME, arguments: { query: "annual leave", domain: "hr" } },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json<{ result: { structuredContent: Payload } }>();
    expect(json.result.structuredContent.results[0]?.id).toBe("hr-annual-leave");
  });

  it("rejects a request without the required Accept header", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(406);
  });
});
