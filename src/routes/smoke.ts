import { generateText } from "ai";
import { Hono } from "hono";
import { getModel, ModelConfigError } from "../model";

const SMOKE_PROMPT = "Reply with one short sentence saying hello from Acme d.o.o.";
const SMOKE_TIMEOUT_MS = 20_000;
const SMOKE_MAX_OUTPUT_TOKENS = 64;

/** Dev-only route: one real model call to verify the provider configuration. */
export const smoke = new Hono<{ Bindings: Env }>();

smoke.get("/_smoke", async (c) => {
  if (c.env.ENABLE_SMOKE !== "true") {
    return c.json({ error: "Not found" }, 404);
  }
  try {
    const model = getModel(c.env);
    const { text } = await generateText({
      model,
      prompt: SMOKE_PROMPT,
      maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
      timeout: SMOKE_TIMEOUT_MS,
      maxRetries: 0,
    });
    return c.json({ model: c.env.MODEL_ID, text });
  } catch (err) {
    if (err instanceof ModelConfigError) {
      return c.json({ error: err.message }, 500);
    }
    // Log only the error name; never log the message verbatim, it could echo request data.
    console.error("smoke: model call failed:", err instanceof Error ? err.name : "unknown");
    return c.json({ error: "Model call failed. Check the API key and MODEL_ID." }, 502);
  }
});
