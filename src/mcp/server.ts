import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { searchKnowledge } from "./search";

export const KNOWLEDGE_TOOL_NAME = "search_knowledge_base";

export const SearchKnowledgeInput = z.object({
  query: z.string().trim().min(1).max(200),
  domain: z.enum(["it", "hr"]),
});

/**
 * Factory used by both the HTTP route and the tests.
 *
 * NOTE: this server performs NO role or agent permission checks. Permissions are applied on
 * the client side, per agent, in step 6b (tools are filtered before the model sees them and
 * checked again at execution time).
 *
 * No `outputSchema` is declared on purpose: the SDK client would compile it with Ajv (runtime
 * code generation), which workerd may disallow. `structuredContent` is still returned.
 */
export function createKnowledgeServer(): McpServer {
  const server = new McpServer({ name: "acme-knowledge-base", version: "1.0.0" });

  server.registerTool(
    KNOWLEDGE_TOOL_NAME,
    {
      title: "Search company knowledge base",
      description:
        "Search the Acme d.o.o. internal knowledge base (how-to and policy articles) by keywords. " +
        "Use it to answer questions about company procedures, e.g. password reset, VPN, leave or " +
        "onboarding. The 'domain' argument is required: 'it' for IT articles, 'hr' for HR articles; " +
        "only articles of that domain are searched. Returns { results: [{ id, title, snippet }] } " +
        "with at most 3 best matches; an empty results list means nothing matched.",
      inputSchema: SearchKnowledgeInput,
      annotations: { readOnlyHint: true },
    },
    ({ query, domain }) => {
      const payload = { results: searchKnowledge(query, domain) };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  return server;
}

/** Stateless Streamable HTTP: a fresh server + transport per request, no MCP sessions. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createKnowledgeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    // No sessionIdGenerator => stateless mode (no session ids, no session validation).
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
