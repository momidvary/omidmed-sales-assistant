import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyDelivery } from "../src/lib/sms/melipayamak-delivery";
import {
  ensureSingleSmsOptOut,
  SmsProviderError,
} from "../src/lib/sms/melipayamak";

test("provider accepted or sent status is not presented as delivered", () => {
  assert.equal(classifyDelivery("ارسال شده"), "accepted");
  assert.equal(classifyDelivery("تحویل شده"), "delivered");
  assert.equal(classifyDelivery("ارسال نشده"), "undelivered");
});

test("marketing SMS includes exactly one opt-out marker", () => {
  assert.equal(ensureSingleSmsOptOut("پیشنهاد امیدمد"), "پیشنهاد امیدمد\nلغو11");
  assert.equal(ensureSingleSmsOptOut("پیشنهاد امیدمد لغو11\nلغو 11"), "پیشنهاد امیدمد\nلغو11");
});

test("ambiguous provider errors are distinguishable from definite rejection", () => {
  assert.equal(new SmsProviderError("timeout", true).ambiguous, true);
  assert.equal(new SmsProviderError("rejected").ambiguous, false);
});

test("campaign sends persist an idempotency key before contacting the provider", () => {
  const route = readFileSync("src/app/api/sms/send-campaign/route.ts", "utf8");
  const component = readFileSync("src/components/sms/campaign-sms-sender.tsx", "utf8");
  assert.match(route, /client_request_id:\s*clientRequestId/);
  assert.ok(route.indexOf('.from("sms_send_batches")') < route.indexOf("sendMultipleSms({"));
  assert.match(route, /PROVIDER_RESULT_UNKNOWN/);
  assert.match(component, /crypto\.randomUUID\(\)/);
});

// ---------------------------------------------------------------------------
// Opt-out deduplication across digit systems.
//
// The dedup pattern matched only Latin "11", so an opt-out already written
// with Persian (۱۱) or Arabic-Indic (١١) digits survived and a second one was
// appended — two opt-out instructions in one marketing message, and an extra
// SMS segment billed for every recipient.
// ---------------------------------------------------------------------------

const OPT_OUT_ANYWHERE = /لغو\s*[۰-۹٠-٩0-9]{2}/gu;

test("marketing text carries exactly one opt-out in any digit system", () => {
  const cases = [
    "سلام",
    "سلام لغو11",
    "سلام لغو 11",
    "سلام لغو11 لغو11",
    "لغو11 سلام لغو11",
    "سلام\nلغو11",
    "سلام لغو۱۱",
    "سلام لغو١١",
    "سلام لغو ۱۱ لغو11",
    "سلام  لغو  11  ",
  ];
  for (const input of cases) {
    const result = ensureSingleSmsOptOut(input);
    const found = result.match(OPT_OUT_ANYWHERE) ?? [];
    assert.equal(
      found.length,
      1,
      `${JSON.stringify(input)} produced ${found.length} opt-outs: ${JSON.stringify(result)}`,
    );
  }
});

test("the appended opt-out is always the canonical Latin form", () => {
  assert.match(ensureSingleSmsOptOut("سلام لغو۱۱"), /\nلغو11$/);
  assert.match(ensureSingleSmsOptOut("سلام"), /\nلغو11$/);
});
