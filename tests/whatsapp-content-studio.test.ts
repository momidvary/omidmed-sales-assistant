import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildInstagramPrompt,
  buildWhatsAppPrompt,
  parseInstagramContent,
  parseWhatsAppContent,
  WHATSAPP_CONTENT_TYPES,
} from "../src/lib/content-studio/generation";
import {
  decodeLegacyWhatsAppPayload,
  encodeLegacyWhatsAppPayload,
  type StoredWhatsAppPayload,
} from "../src/lib/content-studio/whatsapp-legacy";
import {
  extractResponseText,
  generateStructuredContent,
} from "../src/lib/content-studio/openai";
import {
  buildImagePayload,
  buildTemplatePayload,
  buildTextPayload,
  isAmbiguousWhatsAppProviderError,
  loadWhatsAppCloudConfig,
  normalizeIranianMobile,
  parseWhatsAppProviderResponse,
  sendWhatsAppMessage,
  WhatsAppCloudError,
} from "../src/lib/whatsapp/cloud-api";
import {
  buildWhatsAppReadiness,
  getWhatsAppEnvironmentReadiness,
} from "../src/lib/whatsapp/readiness";
import { validateSendPolicy } from "../src/lib/whatsapp/send-policy";
import {
  parseWebhookStatusEvents,
  reconcileWebhookBatch,
  shouldApplyStatus,
  webhookBatchHttpStatus,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from "../src/lib/whatsapp/webhook";

test("normalizes a local Iranian mobile", () => {
  assert.equal(normalizeIranianMobile("09123456789"), "989123456789");
});

test("normalizes Persian digits and +98", () => {
  assert.equal(normalizeIranianMobile("+۹۸ ۹۱۲ ۳۴۵ ۶۷۸۹"), "989123456789");
});

test("rejects invalid mobiles", () => {
  assert.equal(normalizeIranianMobile("02112345678"), null);
  assert.equal(normalizeIranianMobile("0912345"), null);
});

test("builds a Meta text payload", () => {
  const payload = buildTextPayload("09123456789", "سلام");
  assert.equal(payload.to, "989123456789");
  assert.deepEqual(payload.text, { preview_url: false, body: "سلام" });
});

test("builds a secure Meta image payload", () => {
  const payload = buildImagePayload("09123456789", "https://example.test/image.png", "توضیح");
  assert.equal(payload.type, "image");
  assert.equal(payload.image.link, "https://example.test/image.png");
});

test("rejects an insecure image URL", () => {
  assert.throws(() => buildImagePayload("09123456789", "http://example.test/a.png"));
});

test("builds a Meta template payload", () => {
  const payload = buildTemplatePayload("09123456789", "follow_up_fa", ["کلینیک امید"]);
  assert.equal(payload.template.name, "follow_up_fa");
  assert.equal(payload.template.components?.[0].parameters[0].text, "کلینیک امید");
});

test("preserves exact wamid as a string", () => {
  const wamid = "wamid.HBgNNDQxMjM0NTY3ODkwFQIAERgSQTFCQ0RFRjEyMzQ1Njc4AA==";
  assert.equal(parseWhatsAppProviderResponse({ messages: [{ id: wamid }] }).messageId, wamid);
});

test("mocked Cloud API request never calls a real provider", async () => {
  let called = false;
  const result = await sendWhatsAppMessage({
    config: {
      token: "test-token",
      phoneNumberId: "123",
      businessAccountId: "456",
      graphApiVersion: "v23.0",
    },
    payload: buildTextPayload("09123456789", "تست"),
    fetchImpl: async () => {
      called = true;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.mock-id" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(called, true);
  assert.equal(result.messageId, "wamid.mock-id");
});

test("missing Cloud API env disables sending config", () => {
  assert.equal(loadWhatsAppCloudConfig({}), null);
});

test("send policy rejects missing final confirmation", () => {
  const result = validateSendPolicy({
    confirmed: false,
    consentStatus: "opted_in",
    mobile: "09123456789",
    messageType: "text",
    conversationWindowConfirmed: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONFIRMATION_REQUIRED");
});

test("send policy rejects missing consent", () => {
  const result = validateSendPolicy({
    confirmed: true,
    consentStatus: "unknown",
    mobile: "09123456789",
    messageType: "text",
    conversationWindowConfirmed: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONSENT_REQUIRED");
});

test("free text requires a confirmed 24-hour window", () => {
  const result = validateSendPolicy({
    confirmed: true,
    consentStatus: "opted_in",
    mobile: "09123456789",
    messageType: "text",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "WINDOW_REQUIRED");
});

test("template requires explicit Meta approval confirmation", () => {
  const result = validateSendPolicy({
    confirmed: true,
    consentStatus: "opted_in",
    mobile: "09123456789",
    messageType: "template",
    templateName: "approved_template",
    templateVariables: [],
    templateApprovedConfirmed: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TEMPLATE_APPROVAL_REQUIRED");
});

test("webhook challenge accepts only the configured verify token", () => {
  assert.equal(
    verifyWebhookChallenge({
      mode: "subscribe",
      token: "verify-test",
      challenge: "12345",
      expectedToken: "verify-test",
    }),
    "12345",
  );
  assert.equal(
    verifyWebhookChallenge({
      mode: "subscribe",
      token: "wrong",
      challenge: "12345",
      expectedToken: "verify-test",
    }),
    null,
  );
});

test("webhook rejects a bad signature", () => {
  assert.equal(verifyWebhookSignature("{}", "sha256=bad", "secret"), false);
});

test("webhook accepts a valid HMAC signature", () => {
  const body = '{"object":"whatsapp_business_account"}';
  const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, `sha256=${signature}`, "test-secret"), true);
});

const webhookPayload = {
  entry: [
    {
      changes: [
        {
          value: {
            statuses: [
              { id: "wamid.mock", status: "sent", timestamp: "1770000000" },
              { id: "wamid.mock", status: "delivered", timestamp: "1770000001" },
              { id: "wamid.mock", status: "read", timestamp: "1770000002" },
              { id: "wamid.other", status: "failed", timestamp: "1770000003", errors: [{ code: 131000, title: "Provider failure" }] },
            ],
          },
        },
      ],
    },
  ],
};

test("webhook parses sent, delivered, read and failed statuses", () => {
  assert.deepEqual(
    parseWebhookStatusEvents(webhookPayload).map((event) => event.status),
    ["sent", "delivered", "read", "failed"],
  );
});

test("webhook event keys provide deterministic deduplication", () => {
  const first = parseWebhookStatusEvents(webhookPayload);
  const second = parseWebhookStatusEvents(webhookPayload);
  assert.equal(first[0].eventKey, second[0].eventKey);
  assert.equal(new Set(first.map((event) => event.eventKey)).size, first.length);
});

test("status progression does not regress read to delivered", () => {
  assert.equal(shouldApplyStatus("read", "delivered"), false);
  assert.equal(shouldApplyStatus("accepted", "sent"), true);
});

test("explicit webhook transition matrix allows only safe progress", () => {
  const cases: Array<[string, "sent" | "delivered" | "read" | "failed", boolean]> = [
    ["accepted", "sent", true],
    ["sent", "delivered", true],
    ["delivered", "read", true],
    ["read", "delivered", false],
    ["delivered", "failed", false],
    ["read", "failed", false],
    ["accepted", "failed", true],
    ["sent", "failed", true],
    ["failed", "sent", false],
    ["delivered", "delivered", false],
    ["read", "sent", false],
    ["provider_result_unknown", "sent", true],
  ];
  for (const [current, next, expected] of cases) {
    assert.equal(shouldApplyStatus(current, next), expected, `${current} -> ${next}`);
  }
});

test("webhook batch returns 2xx for valid duplicates", async () => {
  const event = parseWebhookStatusEvents(webhookPayload)[0];
  const result = await reconcileWebhookBatch([event], async () => "duplicate");
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes, ["duplicate"]);
  assert.equal(webhookBatchHttpStatus(result), 200);
});

test("webhook batch returns 5xx when the database transaction fails", async () => {
  const event = parseWebhookStatusEvents(webhookPayload)[0];
  const result = await reconcileWebhookBatch([event], async () => {
    throw new Error("temporary database error");
  });
  assert.equal(result.ok, false);
  assert.equal(webhookBatchHttpStatus(result), 503);
});

test("ambiguous provider results are distinct from definite rejections", () => {
  assert.equal(isAmbiguousWhatsAppProviderError(new Error("timeout")), true);
  assert.equal(isAmbiguousWhatsAppProviderError(new WhatsAppCloudError("network")), true);
  assert.equal(isAmbiguousWhatsAppProviderError(new WhatsAppCloudError("server", "1", 500)), true);
  assert.equal(isAmbiguousWhatsAppProviderError(new WhatsAppCloudError("bad request", "2", 400)), false);
});

test("parses valid WhatsApp structured output", () => {
  const parsed = parseWhatsAppContent(JSON.stringify({
    title: "معرفی محصول",
    whatsapp_short_text: "متن کوتاه",
    whatsapp_long_text: "این یک متن کامل و حرفه‌ای است.",
    whatsapp_status_text: "استاتوس",
    call_to_action: "برای اطلاعات بیشتر پیام دهید.",
    image_prompt: "A clinical product photo without text",
    suggested_template_name: "product_intro_fa",
    template_variables: ["نام کلینیک"],
    compliance_note: "قیمت و موجودی باید پیش از ارسال بررسی شود.",
  }));
  assert.equal(parsed.suggested_template_name, "product_intro_fa");
});

test("invalid model JSON produces an understandable error", () => {
  assert.throws(() => parseWhatsAppContent("not-json"), /JSON معتبر نیست/);
});

test("extracts Responses API output text", () => {
  assert.equal(
    extractResponseText({ output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] }),
    "{}",
  );
});

test("mocked OpenAI call sends a strict JSON schema", async () => {
  let formatStrict: unknown = null;
  const text = await generateStructuredContent({
    apiKey: "test-key",
    model: "test-model",
    prompt: "test prompt",
    schemaName: "test_schema",
    schema: { type: "object", additionalProperties: false, properties: {} },
    fetchImpl: async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        text?: { format?: { strict?: unknown } };
      };
      formatStrict = requestBody.text?.format?.strict;
      return new Response(JSON.stringify({ output_text: "{}" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(text, "{}");
  assert.equal(formatStrict, true);
});

test("Instagram parser and prompt preserve the existing flow", () => {
  const parsed = parseInstagramContent(JSON.stringify({
    title: "عنوان",
    caption: "کپشن",
    on_image_text: "متن تصویر",
    call_to_action: "تماس",
    hashtags: ["#امیدمد"],
    image_prompt: "A clean product photo",
  }));
  assert.equal(parsed.caption, "کپشن");
  assert.match(buildInstagramPrompt({ topic: "پد", objective: "sales", formatLabel: "پست" }), /اینستاگرام/);
});

test("WhatsApp prompt forbids invented commercial facts", () => {
  const prompt = buildWhatsAppPrompt({
    topic: "پد",
    objective: "sales",
    contentType: "product_intro",
  });
  assert.match(prompt, /قیمت، تخفیف، موجودی/);
});

test("all nine WhatsApp content types build a structured prompt", () => {
  assert.equal(WHATSAPP_CONTENT_TYPES.length, 9);
  for (const contentType of WHATSAPP_CONTENT_TYPES) {
    const prompt = buildWhatsAppPrompt({ topic: "محصول تست", objective: "sales", contentType });
    assert.match(prompt, /نوع محتوا:/);
    assert.match(prompt, /متن استاتوس/);
    assert.match(prompt, /suggested_template_name/);
  }
});

const compatibilityPayload: StoredWhatsAppPayload = {
  content_type: "product_intro",
  title: "Synthetic title",
  whatsapp_short_text: "Synthetic short text",
  whatsapp_long_text: "Synthetic long text",
  whatsapp_status_text: "Synthetic status",
  call_to_action: "Synthetic CTA",
  image_prompt: "Synthetic image prompt",
  suggested_template_name: "synthetic_template",
  template_variables: ["Synthetic variable"],
  compliance_note: "Synthetic compliance note",
};

test("WhatsApp generation can be stored before channel_payload exists", () => {
  const encoded = encodeLegacyWhatsAppPayload(compatibilityPayload);
  assert.deepEqual(decodeLegacyWhatsAppPayload([encoded]), compatibilityPayload);
  assert.equal(decodeLegacyWhatsAppPayload(["#ordinary"]), null);
});

test("schema and environment readiness are reported independently", () => {
  const configuredEnv = {
    WHATSAPP_CLOUD_API_TOKEN: "test-token",
    WHATSAPP_PHONE_NUMBER_ID: "test-phone-id",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "test-waba-id",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
    WHATSAPP_APP_SECRET: "test-app-secret",
    WHATSAPP_GRAPH_API_VERSION: "v23.0",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  };
  assert.deepEqual(getWhatsAppEnvironmentReadiness(configuredEnv), {
    cloudApiConfigured: true,
    webhookConfigured: true,
    graphApiVersionConfigured: true,
  });
  assert.equal(buildWhatsAppReadiness(false, configuredEnv).sendReady, false);
  assert.equal(buildWhatsAppReadiness(true, configuredEnv).sendReady, true);
  assert.equal(buildWhatsAppReadiness(true, {}).sendReady, false);
});

test("migration 023 keeps webhook event and message update atomic", () => {
  const migration = readFileSync("supabase/migrations/023_whatsapp_content_studio.sql", "utf8");
  assert.match(migration, /create or replace function public\.process_whatsapp_webhook_status/);
  assert.match(migration, /security definer/);
  assert.match(migration, /for update/);
  assert.match(migration, /on conflict \(event_key\) do nothing/);
  assert.match(migration, /when v_apply and not coalesce\(v_event_inserted, false\) then 'reconciled'/);
  assert.match(migration, /grant execute on function public\.process_whatsapp_webhook_status[\s\S]*to service_role/);
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.process_whatsapp_webhook_status[\s\S]*to authenticated/,
  );
});

test("rollback-only SQL covers atomic failure, RLS, and duplicate reconciliation", () => {
  const sql = readFileSync("supabase/tests/023_whatsapp_content_studio_rollback.sql", "utf8");
  assert.match(sql, /Expected duplicate event reconciliation/);
  assert.match(sql, /Webhook event survived a failed message update/);
  assert.match(sql, /RLS exposed another owner message/);
  assert.match(sql, /rollback;\s*$/i);
});

test("copy and image download remain independent from Cloud API sending", () => {
  const component = readFileSync("src/app/content-studio/whatsapp-content-card.tsx", "utf8");
  assert.match(component, /کپی متن کوتاه/);
  assert.match(component, /کپی متن کامل/);
  assert.match(component, /کپی استاتوس/);
  assert.match(component, /async function downloadImage\(\)/);
  assert.match(component, /fetch\(imageUrl\)/);
});

test("send route stores an ambiguous result without claiming failure", () => {
  const route = readFileSync("src/app/api/whatsapp/send/route.ts", "utf8");
  assert.match(route, /status: ambiguous \? "provider_result_unknown" : "failed"/);
  assert.match(route, /provider_result_unknown_at: ambiguous \? now : null/);
  assert.match(route, /برای جلوگیری از پیام تکراری درخواست خودکار تکرار نشد/);
});

test("migration RLS grants authenticated users read-only owner history", () => {
  const migration = readFileSync("supabase/migrations/023_whatsapp_content_studio.sql", "utf8");
  assert.match(migration, /for select to authenticated[\s\S]*owner_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke all on table public\.whatsapp_messages from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.whatsapp_messages to authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*authenticated/);
});
