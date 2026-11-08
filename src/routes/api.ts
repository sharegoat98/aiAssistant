import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { createInMemoryHistory, runOrchestrator, type ConnectMcpFn } from "../agents/orchestrator";
import { MAX_INPUT_CHARS, REQUEST_TIMEOUT_MS } from "../config";
import { describeCapabilities } from "../permissions/describe";
import type { RequestContext } from "../types";
import { listUsers, resolveUser, UnauthorizedError } from "../users";
import type { LanguageModel } from "ai";

export interface AppDeps {
  readonly getModel: (env: Env) => LanguageModel;
  readonly connectMcp: ConnectMcpFn;
}

/** Uniform error body for every /api failure. */
export function apiError(c: Context, status: ContentfulStatusCode, error: string, message: string): Response {
  return c.json({ error, message }, status);
}

const ChatBody = z.object({ message: z.string().trim().min(1).max(MAX_INPUT_CHARS) });

/** Resolves the caller or returns a 401 response. */
function authenticate(c: Context) {
  try {
    return { user: resolveUser(c.req.raw) } as const;
  } catch (err) {
    if (err instanceof UnauthorizedError) return { response: apiError(c, 401, "unauthorized", err.message) } as const;
    throw err;
  }
}

export function apiRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const api = new Hono<{ Bindings: Env }>();

  api.get("/users", (c) =>
    c.json({ users: listUsers().map(({ userId, label, role }) => ({ userId, label, role })) }),
  );

  api.get("/capabilities", (c) => {
    const auth = authenticate(c);
    if ("response" in auth) return auth.response;
    const { userId, role } = auth.user;
    return c.json({ userId, role, agents: describeCapabilities(role) });
  });

  // Every request is independent: there is NO conversation memory (specialist history is created
  // fresh below and discarded), because per-session persistence (step 9a) is not implemented.
  api.post("/chat", async (c) => {
    const auth = authenticate(c);
    if ("response" in auth) return auth.response;
    const body = ChatBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return apiError(c, 400, "invalid_request", `Body must be { "message": string } with 1-${MAX_INPUT_CHARS} characters.`);
    }
    const ctx: RequestContext = {
      userId: auth.user.userId,
      role: auth.user.role, // only ever from users.ts, never from the body or other headers
      sessionId: crypto.randomUUID(), // request id, not a session
      trace: [],
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    const result = await runOrchestrator({
      model: deps.getModel(c.env),
      connectMcp: deps.connectMcp,
      userInput: body.data.message,
      history: [],
      ctx,
      specialistHistory: createInMemoryHistory(),
    });
    return c.json({ reply: result.reply, status: result.status, trace: ctx.trace });
  });

  return api;
}
