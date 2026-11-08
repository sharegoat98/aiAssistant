import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** Providers getModel() can build. To add one: extend this list and add a case in getModel(). */
export const SUPPORTED_PROVIDERS = ["anthropic"] as const;

/**
 * Deliberately looser than the generated `Env` (which types MODEL_PROVIDER as the literal
 * "anthropic"): configuration comes from the outside and must be validated at runtime.
 */
export interface ModelEnv {
  readonly MODEL_PROVIDER?: string | undefined;
  readonly MODEL_ID?: string | undefined;
  readonly ANTHROPIC_API_KEY?: string | undefined;
}

/** Invalid or incomplete model configuration; the message states exactly what is wrong. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

function isBlank(value: string | undefined): value is undefined | "" {
  return value === undefined || value.trim() === "";
}

export function getModel(env: ModelEnv): LanguageModel {
  const supported = SUPPORTED_PROVIDERS.join(", ");
  const provider = env.MODEL_PROVIDER?.trim();
  if (isBlank(provider)) {
    throw new ModelConfigError(`MODEL_PROVIDER is not set. Supported providers: ${supported}.`);
  }
  const modelId = env.MODEL_ID?.trim();
  if (isBlank(modelId)) {
    throw new ModelConfigError("MODEL_ID is not set (e.g. claude-haiku-5-5).");
  }

  switch (provider) {
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (isBlank(apiKey)) {
        throw new ModelConfigError(
          "ANTHROPIC_API_KEY is not set. Add it to .dev.vars (see .dev.vars.example).",
        );
      }
      return createAnthropic({ apiKey })(modelId);
    }
    default:
      throw new ModelConfigError(
        `Unsupported MODEL_PROVIDER "${provider}". Supported providers: ${supported}.`,
      );
  }
}
