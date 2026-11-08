import { Hono } from "hono";
import { handleMcpRequest } from "./mcp/server";
import { smoke } from "./routes/smoke";

export { SessionDO } from "./session/SessionDO";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", smoke);
app.all("/mcp", (c) => handleMcpRequest(c.req.raw));

export default app;
