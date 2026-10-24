import assert from "node:assert/strict";
import test from "node:test";

import { callNeed } from "../src/lib/sales/call-list";

const now = new Date("2026-10-24T09:00:00+03:30");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const customer = { status: "active", next_followup_at: null, last_purchase_at: "2026-06-01", phone: "09120000000" };
const base = {
  customer,
  hasMobile: true,
  smsReason: "موعد خرید رسیده",
  lastSms: null,
  lastContactAt: null,
  highValue: false,
  now,
};
const sms = (days: number, deliveryStatus: string, providerStatus: string | null = null, mode = "simple") => ({
  at: daysAgo(days),
  deliveryStatus,
  providerStatus,
  mode,
});

test("a customer the SMS can reach is not called", () => {
  assert.equal(callNeed(base), null, "has a reason but a mobile: SMS, not a call");
  assert.equal(callNeed({ ...base, lastSms: sms(3, "delivered") }), null);
  assert.equal(callNeed({ ...base, highValue: true, lastSms: sms(3, "delivered") }), null, "too soon for 'no reply'");
});

test("an SMS that did not reach them puts them on the call list, with why", () => {
  const blocked = callNeed({ ...base, lastSms: sms(2, "undelivered", "در لیست سیاه (کد 35)") })!;
  assert.equal(blocked.kind, "undelivered");
  assert.match(blocked.reason, /تبلیغاتی را بسته؛ .*الگوی «یادآوری سفارش مجدد»/);
  assert.match(callNeed({ ...base, lastSms: sms(2, "undelivered", "نرسیده (کد 2)") })!.reason, /خاموش یا خارج از دسترس/);
  // Bought after the SMS: answered.
  assert.equal(
    callNeed({ ...base, customer: { ...customer, last_purchase_at: daysAgo(1).slice(0, 10) }, lastSms: sms(2, "undelivered") }),
    null,
  );
  assert.equal(callNeed({ ...base, lastSms: sms(40, "undelivered") }), null, "too old to act on");
});

test("no mobile with a reason to contact, and a valuable customer with no reply", () => {
  const landline = callNeed({ ...base, hasMobile: false, customer: { ...customer, phone: "02112345678" } })!;
  assert.equal(landline.kind, "no_mobile");
  assert.match(landline.reason, /^موبایل ثبت نشده؛ موعد خرید رسیده/);
  assert.equal(callNeed({ ...base, hasMobile: false, smsReason: null }), null, "no reason today: no call");

  const silent = callNeed({ ...base, highValue: true, lastSms: sms(8, "delivered") })!;
  assert.equal(silent.kind, "no_reply");
  assert.equal(callNeed({ ...base, lastSms: sms(8, "delivered") }), null, "only valuable customers are chased");
  assert.equal(
    callNeed({ ...base, highValue: true, lastSms: sms(8, "delivered"), lastContactAt: daysAgo(7.5) }),
    null,
    "a call logged after the SMS is its answer",
  );
});

test("your own follow-up date always counts; a recent call removes the rest", () => {
  const scheduled = callNeed({ ...base, customer: { ...customer, next_followup_at: daysAgo(1) } })!;
  assert.equal(scheduled.kind, "scheduled");
  assert.equal(callNeed({ ...base, hasMobile: false, lastContactAt: daysAgo(2) }), null);
  assert.equal(callNeed({ ...base, customer: { ...customer, status: "lost" }, hasMobile: false }), null);
});

test("an SMS is never mistaken for a contact, and does not schedule a call by default", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("src/app/sms/today/load.ts", "utf8"), /\.neq\("channel", "sms"\)/);
  assert.match(readFileSync("src/app/page.tsx", "utf8"), /followups\.filter\(\(item\) => item\.channel !== "sms"\)/);
  assert.match(
    readFileSync("src/components/sms/single-sms-composer.tsx", "utf8"),
    /useState\(false\);/,
    "the 'remind me in three days' box starts unticked",
  );
});
