// Zod schemas for every API response the UI consumes. Zod and types only: no fetch, no DOM.
import { z } from "zod";
import type { TraceEvent as ServerTraceEvent } from "../../src/types";

const AgentId = z.enum(["orchestrator", "it", "hr"]);
const DelegationStatus = z.enum(["ok", "error", "unavailable", "timeout", "forbidden"]);
const Role = z.enum(["employee", "manager"]);

const base = { ts: z.number(), agent: AgentId };

export const TraceEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("agent_start"), task: z.string().optional() }),
  z.strictObject({ ...base, type: z.literal("tool_call"), tool: z.string(), input: z.unknown() }),
  z.strictObject({ ...base, type: z.literal("tool_result"), tool: z.string(), ok: z.boolean(), summary: z.string() }),
  z.strictObject({ ...base, type: z.literal("skill_loaded"), skill: z.string() }),
  z.strictObject({ ...base, type: z.literal("agent_end"), status: DelegationStatus, steps: z.number().optional() }),
  z.strictObject({ ...base, type: z.literal("mcp_unavailable"), reason: z.string() }),
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;

/**
 * Drift guard: the UI schema output and the server's TraceEvent must be assignable to each
 * other. Adding or changing a variant in src/types.ts without updating the schema (or vice
 * versa) fails `tsc -p ui`. Zod infers `x?: T | undefined` for optional keys while the server
 * type is `x?: T` (exactOptionalPropertyTypes), so the server side is widened with
 * `| undefined` on optional keys only; required keys and variants are compared exactly.
 */
type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];
type AllowUndefined<T> = T extends unknown
  ? { [K in Exclude<keyof T, OptionalKeys<T>>]: T[K] } & { [K in OptionalKeys<T>]?: T[K] | undefined }
  : never;
type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _TraceSchemaMatchesServer = Assert<Mutual<TraceEvent, AllowUndefined<ServerTraceEvent>>>;

export const UsersSchema = z.object({
  users: z.array(z.object({ userId: z.string(), label: z.string(), role: Role })),
});
export type UserInfo = z.infer<typeof UsersSchema>["users"][number];

export const CapabilitiesSchema = z.object({
  userId: z.string(),
  role: Role,
  agents: z.array(
    z.object({
      agent: AgentId,
      capabilities: z.array(
        z.object({ id: z.string(), kind: z.string(), description: z.string(), available: z.boolean() }),
      ),
    }),
  ),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  status: DelegationStatus,
  trace: z.array(TraceEventSchema),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ErrorBodySchema = z.object({ error: z.string(), message: z.string() });
