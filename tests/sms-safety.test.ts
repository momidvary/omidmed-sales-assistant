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
