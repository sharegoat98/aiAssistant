import { DurableObject } from "cloudflare:workers";

/** Placeholder Durable Object; per-session state is added in a later step. */
export class SessionDO extends DurableObject<Env> {}
