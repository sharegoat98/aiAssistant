import { Hono } from "hono";
import { smoke } from "./routes/smoke";

export { SessionDO } from "./session/SessionDO";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", smoke);

export default app;
