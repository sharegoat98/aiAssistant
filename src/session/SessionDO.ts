import { DurableObject } from "cloudflare:workers";

/** Intentionally unused (step 9a not implemented): the API is stateless per request. */
export class SessionDO extends DurableObject<Env> {}
