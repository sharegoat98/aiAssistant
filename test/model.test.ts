import { describe, expect, it } from "vitest";
import { getModel, ModelConfigError } from "../src/model";

const valid = {
  MODEL_PROVIDER: "anthropic",
  MODEL_ID: "claude-haiku-5-5",
  ANTHROPIC_API_KEY: "test-key",
};

describe("getModel", () => {
  it("throws a clear error listing supported providers for an unknown provider", () => {
    expect(() => getModel({ ...valid, MODEL_PROVIDER: "openai" })).toThrow(
      /Unsupported MODEL_PROVIDER "openai"\. Supported providers: anthropic/,
    );
    expect(() => getModel({ ...valid, MODEL_PROVIDER: "openai" })).toThrow(ModelConfigError);
  });

  it("names the missing variable", () => {
    expect(() => getModel({ ...valid, MODEL_PROVIDER: undefined })).toThrow(/MODEL_PROVIDER is not set/);
    expect(() => getModel({ ...valid, MODEL_ID: "" })).toThrow(/MODEL_ID is not set/);
    expect(() => getModel({ ...valid, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("builds an anthropic model without any network call", () => {
    const model = getModel(valid);
    expect(typeof model).toBe("object");
    expect(model).toMatchObject({ modelId: "claude-haiku-5-5" });
  });
});
