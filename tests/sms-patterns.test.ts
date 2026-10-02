import assert from "node:assert/strict";
import test from "node:test";

import { sendPatternSms } from "../src/lib/sms/melipayamak";
import {
  configuredPatterns,
  fillPatternText,
  patternArgs,
  patternItemsSummary,
  SMS_PATTERNS,
} from "../src/lib/sms/patterns";

const payment = SMS_PATTERNS.find((pattern) => pattern.key === "payment")!;

test("only patterns with a numeric bodyId are offered", () => {
  const keys = configuredPatterns({ MELIPAYAMAK_PATTERN_PAYMENT: "428065", MELIPAYAMAK_PATTERN_SHIPPED: "abc" }).map(
    (pattern) => pattern.key,
  );
  // "order" is the pattern already approved in the panel and works by default.
  assert.deepEqual(keys, ["order", "payment"]);
  assert.deepEqual(
    configuredPatterns({ MELIPAYAMAK_PATTERN_ORDER: "invalid" }).map((pattern) => pattern.key),
    [],
  );
});

test("order items are summarised to fit one pattern variable", () => {
  assert.equal(
    patternItemsSummary([
      { product_name: "پد یکبار مصرف", quantity: 2 },
      { product_name: "ملحفه", quantity: 1 },
    ]),
    "پد یکبار مصرف ۲ عدد، ملحفه ۱ عدد",
  );
  const many = Array.from({ length: 12 }, (_, index) => ({ product_name: `کالای شماره ${index}`, quantity: 1 }));
  const summary = patternItemsSummary(many);
  assert.ok(summary.length <= 80);
  assert.match(summary, /قلم دیگر$/);
});

test("pattern texts follow Melipayamak service-line rules", () => {
  // "order" was approved earlier with its own wording, amount included.
  for (const pattern of SMS_PATTERNS.filter((item) => item.key !== "order")) {
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
