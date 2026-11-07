import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Hono } from "hono";

const SMOKE_PROMPT = "Reply with one short sentence saying hello from Acme d.o.o.";
const SMOKE_TIMEOUT_MS = 20_000;
const SMOKE_MAX_OUTPUT_TOKENS = 64;

/** Dev-only route; refactored to use getModel() in step 2. */
export const smoke = new Hono<{ Bindings: Env }>();

smoke.get("/_smoke", async (c) => {
  if (c.env.ENABLE_SMOKE !== "true") {
    return c.json({ error: "Not found" }, 404);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return c.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .dev.vars (see .dev.vars.example)." },
      500,
    );
  }
  try {
    const anthropic = createAnthropic({ apiKey });
    const { text } = await generateText({
      model: anthropic(c.env.MODEL_ID),
      prompt: SMOKE_PROMPT,
      maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
      timeout: SMOKE_TIMEOUT_MS,
      maxRetries: 0,
    });
    return c.json({ model: c.env.MODEL_ID, text });
  } catch (err) {
    // Log only the error name; never log the message verbatim, it could echo request data.
    console.error("smoke: model call failed:", err instanceof Error ? err.name : "unknown");
    return c.json({ error: "Model call failed. Check the API key and MODEL_ID." }, 502);
  }
});
