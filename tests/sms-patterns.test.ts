import assert from "node:assert/strict";
import test from "node:test";

import { sendPatternSms } from "../src/lib/sms/melipayamak";
import {
  configuredPatterns,
  fillPatternText,
  patternArgs,
  SMS_PATTERNS,
} from "../src/lib/sms/patterns";

const payment = SMS_PATTERNS.find((pattern) => pattern.key === "payment")!;

test("only patterns with a numeric bodyId are offered", () => {
  const keys = configuredPatterns({ MELIPAYAMAK_PATTERN_PAYMENT: "428065", MELIPAYAMAK_PATTERN_SHIPPED: "abc" }).map(
    (pattern) => pattern.key,
  );
  assert.deepEqual(keys, ["payment"]);
});

test("pattern texts follow Melipayamak service-line rules", () => {
  for (const pattern of SMS_PATTERNS) {
    assert.match(pattern.text, /omidmed\.com$/, `${pattern.key} must end with the website`);
    assert.doesNotMatch(pattern.text, /تومان|مبلغ|لینک پرداخت|تخفیف/, `${pattern.key} must avoid payment amounts and promotions`);
  }
});

test("pattern arguments are validated and filled in order", () => {
  const parsed = patternArgs(payment, { name: "  کلینیک   سلامت ", invoice: "1205" });
  assert.ok("args" in parsed);
  assert.deepEqual(parsed.args, ["کلینیک سلامت", "1205"]);
  assert.match(fillPatternText(payment, parsed.args), /^کلینیک سلامت گرامی، فاکتور شماره 1205/);
  assert.ok("error" in patternArgs(payment, { name: "x" }));
  assert.ok("error" in patternArgs(payment, { name: "x", invoice: "https://evil.example" }));
});

test("pattern send posts bodyId, recipient and args to the shared endpoint", async () => {
  const previousToken = process.env.MELIPAYAMAK_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.MELIPAYAMAK_API_TOKEN = "test-token";
  let url = "";
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    url = input;
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ recId: 4512345678, status: "ارسال موفق بود" }));
  }) as unknown as typeof fetch;
  try {
    const result = await sendPatternSms({ bodyId: 428065, to: "09121234567", args: ["الف", "1205"] });
    assert.match(url, /\/api\/send\/shared\/test-token$/);
    assert.deepEqual(body, { bodyId: 428065, to: "09121234567", args: ["الف", "1205"] });
    assert.equal(result.success, true);
    assert.equal(result.recId, "4512345678");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MELIPAYAMAK_API_TOKEN;
    else process.env.MELIPAYAMAK_API_TOKEN = previousToken;
  }
});
