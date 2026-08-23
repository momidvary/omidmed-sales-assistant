import assert from "node:assert/strict";
import test from "node:test";

import {
  AiConfigError,
  DEFAULT_IMAGE_MODEL,
  aiConfigErrorStatus,
  isValidModelId,
  providerErrorMessage,
  redactForLog,
  resolveAiConfig,
  resolveImageModel,
  resolveModel,
  resolveOpenAiKey,
} from "../src/lib/ai/config";
import {
  ContentGenerationError,
  generateStructuredContent,
} from "../src/lib/content-studio/openai";

/** assert.throws() returns undefined, so capture the error explicitly. */
function caught(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error as AiConfigError;
  }
  throw new Error("expected the call to throw, but it returned normally");
}

const FEATURES = [
  "assistant",
  "content",
  "sms_suggest",
  "expense_classify",
  "invoice_extract",
] as const;

test("valid configuration resolves key and model for every text feature", () => {
  const env = { OPENAI_API_KEY: "sk-live-key", OPENAI_MODEL: "some-model-1" };
  for (const feature of FEATURES) {
    const config = resolveAiConfig(feature, env);
    assert.equal(config.apiKey, "sk-live-key");
    assert.equal(config.model, "some-model-1");
  }
});

test("per-feature override wins over the shared model", () => {
  const env = {
    OPENAI_API_KEY: "k",
    OPENAI_MODEL: "base-model",
    OPENAI_INVOICE_MODEL: "vision-model",
    OPENAI_CONTENT_MODEL: "content-model",
  };
  assert.equal(resolveModel("invoice_extract", env), "vision-model");
  assert.equal(resolveModel("content", env), "content-model");
  assert.equal(resolveModel("assistant", env), "base-model");
});

test("missing API key raises a controlled config error, never a fallback", () => {
  const error = caught(() => resolveOpenAiKey({ OPENAI_MODEL: "m" }));
  assert.ok(error instanceof AiConfigError);
  assert.equal(error.code, "MISSING_API_KEY");
  assert.equal(aiConfigErrorStatus(), 503);
  assert.match(error.userMessage, /پیکربندی نشده/);
});

test("missing model raises MISSING_MODEL instead of guessing a model name", () => {
  for (const feature of FEATURES) {
    const error = caught(() => resolveModel(feature, { OPENAI_API_KEY: "k" }));
    assert.ok(error instanceof AiConfigError);
    assert.equal(error.code, "MISSING_MODEL");
    // The message must name the variable to set, and must not invent a model.
    assert.match(error.userMessage, /OPENAI_/);
    assert.doesNotMatch(error.userMessage, /gpt-/i);
  }
});

test("malformed model configuration is rejected", () => {
  for (const bad of ["", "  ", "two words", "a".repeat(101), "model\nid"]) {
    assert.throws(
      () => resolveModel("assistant", { OPENAI_API_KEY: "k", OPENAI_MODEL: bad }),
      AiConfigError,
    );
  }
});

test("an API key pasted into the model variable is rejected, not sent upstream", () => {
  const error = caught(() =>
    resolveModel("assistant", {
      OPENAI_API_KEY: "k",
      OPENAI_MODEL: "sk-secret-value-1234567890",
    }),
  );
  assert.ok(error instanceof AiConfigError);
  assert.equal(error.code, "INVALID_MODEL");
  assert.doesNotMatch(error.userMessage, /sk-secret/);
  assert.ok(!isValidModelId("sk-secret-value-1234567890"));
});

test("image model falls back only to a real published model id", () => {
  assert.equal(resolveImageModel({}), DEFAULT_IMAGE_MODEL);
  assert.equal(DEFAULT_IMAGE_MODEL, "gpt-image-1");
  assert.equal(resolveImageModel({ OPENAI_IMAGE_MODEL: "custom-img" }), "custom-img");
  assert.throws(
    () => resolveImageModel({ OPENAI_IMAGE_MODEL: "sk-abcdefghij" }),
    AiConfigError,
  );
});

test("no source file hard-codes an invented model name", async () => {
  const { execSync } = await import("node:child_process");
  const hits = execSync(
    "grep -rn 'gpt-5' src/ || true",
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `invented model ids found:\n${hits}`);
});

test("provider failures map to safe Persian messages with no provider text", () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
    const message = providerErrorMessage(status);
    assert.ok(message.length > 0);
    // Never echo provider vocabulary, model ids, or key material.
    assert.doesNotMatch(message, /sk-|Bearer|gpt-|openai/i);
  }
});

test("secret-shaped text is redacted before logging", () => {
  const redacted = redactForLog(
    "call failed for sk-proj-ABCDEFGHIJKLMNOP with Bearer sk-proj-ABCDEFGHIJ",
  );
  assert.doesNotMatch(redacted, /ABCDEFGHIJKLMNOP/);
  assert.match(redacted, /sk-\*\*\*/);
});

test("structured generation never surfaces raw provider error text", async () => {
  const leak = "quota exceeded for org-SECRET123 using key sk-live-LEAKED";
  const error = (await generateStructuredContent({
    apiKey: "k",
    model: "m",
    prompt: "p",
    schemaName: "s",
    schema: {},
    fetchImpl: (async () =>
      new Response(JSON.stringify({ error: { message: leak } }), {
        status: 429,
      })) as unknown as typeof fetch,
  }).then(
    () => null,
    (caught: unknown) => caught,
  )) as ContentGenerationError;

  assert.ok(error instanceof ContentGenerationError);
  assert.equal(error.code, "PROVIDER");
  assert.doesNotMatch(error.message, /SECRET123|SIGNED|sk-live|quota exceeded/);
});

test("provider transport failure is reported without internal detail", async () => {
  const error = (await generateStructuredContent({
    apiKey: "k",
    model: "m",
    prompt: "p",
    schemaName: "s",
    schema: {},
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED 10.1.2.3:443 internal-host");
    }) as unknown as typeof fetch,
  }).then(
    () => null,
    (caught: unknown) => caught,
  )) as ContentGenerationError;

  assert.equal(error.code, "PROVIDER");
  assert.doesNotMatch(error.message, /ECONNREFUSED|10\.1\.2\.3|internal-host/);
});

test("missing key is refused before any request is attempted", async () => {
  let called = false;
  await assert.rejects(
    generateStructuredContent({
      apiKey: "",
      model: "m",
      prompt: "p",
      schemaName: "s",
      schema: {},
      fetchImpl: (async () => {
        called = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    }),
    ContentGenerationError,
  );
  assert.equal(called, false);
});
