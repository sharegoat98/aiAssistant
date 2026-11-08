import { Hono } from "hono";
import { defaultConnectMcp } from "./agents/orchestrator";
import { handleMcpRequest } from "./mcp/server";
import { getModel, ModelConfigError } from "./model";
import { apiError, apiRoutes, type AppDeps } from "./routes/api";
import { smoke } from "./routes/smoke";

export type { AppDeps } from "./routes/api";

/** Builds the app. All state is per call; tests inject a mock model and an in-memory MCP server. */
export function createApp(overrides: Partial<AppDeps> = {}): Hono<{ Bindings: Env }> {
  const deps: AppDeps = { getModel, connectMcp: defaultConnectMcp, ...overrides };
  const app = new Hono<{ Bindings: Env }>();

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api", smoke);
  app.route("/api", apiRoutes(deps));
  app.all("/api/*", (c) => apiError(c, 404, "not_found", "Unknown API route."));
  app.all("/mcp", (c) => handleMcpRequest(c.req.raw));

  app.onError((err, c) => {
    // Log only the error name (plus the config message, which holds no secret); never the stack.
    console.error("request failed:", err.name, err instanceof ModelConfigError ? err.message : "");
    return apiError(c, 500, "internal_error", "Internal error.");
  });
  return app;
}
