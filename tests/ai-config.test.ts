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
import { generatePosterText, PosterTextError } from "../src/lib/poster/text";

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

test("poster text generation never surfaces raw provider error text", async () => {
  const leak = "quota exceeded for org-SECRET123 using key sk-live-LEAKED";
  const error = await generatePosterText({
    apiKey: "k",
    model: "m",
    description: "پد فیزیوتراپی",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ error: { message: leak } }), { status: 429 })) as unknown as typeof fetch,
  }).then(
    () => null,
    (caught: unknown) => caught,
  );

  assert.ok(error instanceof PosterTextError);
  assert.equal(error.code, "PROVIDER");
  assert.doesNotMatch(error.message, /SECRET123|sk-live|quota exceeded/);
});

test("poster provider transport failure is reported without internal detail", async () => {
  const error = await generatePosterText({
    apiKey: "k",
    model: "m",
    description: "پد فیزیوتراپی",
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED 10.1.2.3:443 internal-host");
    }) as unknown as typeof fetch,
  }).then(
    () => null,
    (caught: unknown) => caught,
  );

  assert.ok(error instanceof PosterTextError);
  assert.equal(error.code, "PROVIDER");
  assert.doesNotMatch(error.message, /ECONNREFUSED|10\.1\.2\.3|internal-host/);
});

test("poster text with a missing key is refused before any request is attempted", async () => {
  let called = false;
  await assert.rejects(
    generatePosterText({
      apiKey: "",
      model: "m",
      description: "پد",
      fetchImpl: (async () => {
        called = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    }),
    PosterTextError,
  );
  assert.equal(called, false);
});

test("poster text output is trimmed to fit the layout", async () => {
  const text = await generatePosterText({
    apiKey: "k",
    model: "m",
    description: "پد",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            headline: "تیتر ".repeat(30),
            subheadline: "زیرتیتر",
            bullets: ["الف", "", "ب", "ج", "د"],
            cta: "سفارش",
            caption: "کپشن",
          }),
        }),
      )) as unknown as typeof fetch,
  });
  assert.ok(text.headline.length <= 40);
  assert.deepEqual(text.bullets, ["الف", "ب", "ج"]);
});

test("poster text asks for web search and falls back when the model rejects it", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const text = await generatePosterText({
    apiKey: "k",
    model: "m",
    description: "پد فیزیوتراپی",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) return new Response("{}", { status: 400 });
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ headline: "پد", subheadline: "س", bullets: [], cta: "c", caption: "k" }),
                },
              ],
            },
          ],
        }),
      );
    }) as unknown as typeof fetch,
  });
  assert.equal(text.headline, "پد");
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].tools, [{ type: "web_search" }]);
  assert.equal(bodies[1].tools, undefined);
});
