import type { z } from "zod";
import {
  CapabilitiesSchema,
  ChatResponseSchema,
  ErrorBodySchema,
  UsersSchema,
  type Capabilities,
  type ChatResponse,
  type UserInfo,
} from "./schemas";

/** An error whose message is safe and meant to be shown to the user as is. */
export class ApiError extends Error {}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  opts: { userId?: string; body?: unknown; signal?: AbortSignal },
): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  if (opts.userId !== undefined) headers["X-User"] = opts.userId;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method: opts.body === undefined ? "GET" : "POST", headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.signal !== undefined) init.signal = opts.signal;

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError("Could not reach the server. Is it running?");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorBodySchema.safeParse(json);
    throw new ApiError(e.success ? e.data.message : `The server answered with an error (HTTP ${res.status}).`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError("The server sent a response in an unexpected format.");
  return parsed.data;
}

export async function getUsers(signal?: AbortSignal): Promise<UserInfo[]> {
  return (await request(UsersSchema, "/api/users", signal === undefined ? {} : { signal })).users;
}

export function getCapabilities(userId: string, signal?: AbortSignal): Promise<Capabilities> {
  return request(CapabilitiesSchema, "/api/capabilities", signal === undefined ? { userId } : { userId, signal });
}

/** The role is never sent: the server derives it from the X-User header. */
export function postChat(userId: string, message: string, signal: AbortSignal): Promise<ChatResponse> {
  return request(ChatResponseSchema, "/api/chat", { userId, body: { message }, signal });
}
