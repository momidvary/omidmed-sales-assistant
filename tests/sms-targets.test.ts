import assert from "node:assert/strict";
import test from "node:test";

import {
  draftSmsText,
  exclusionReason,
  rankSmsTargets,
  salesThresholds,
  salesTrend,
  scoreSmsTarget,
  topProducts,
  type TargetCustomer,
  type TargetSignals,
} from "../src/lib/sales/sms-targets";

const now = new Date("2026-10-18T09:00:00+03:30");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const base: TargetCustomer = {
  id: "c1",
  name: "کلینیک نمونه",
  phone: "09120000000",
  status: "active",
  priority: "normal",
  archived_at: null,
  next_followup_at: null,
  purchase_count: 6,
  total_sales: 50_000_000,
  avg_purchase_gap_days: 30,
  days_since_last_purchase: 10,
};
const quiet: TargetSignals = {
  recentSales: 30_000_000,
  previousSales: 30_000_000,
  topProduct: "ملحفه یکبار مصرف",
  lastSmsAt: null,
  lastContactAt: null,
  wantsPrice: false,
  unpaidInvoice: false,
};
const context = { topTenSales: 200_000_000, topQuarterSales: 100_000_000, now };

test("a customer with no reason to hear from us today is not listed, whatever their value", () => {
  assert.equal(scoreSmsTarget({ ...base, total_sales: 900_000_000, priority: "vip" }, quiet, context), null);
});

test("reasons are spelled out and the strongest signal decides the message", () => {
  const due = scoreSmsTarget({ ...base, days_since_last_purchase: 36 }, quiet, context)!;
  assert.equal(due.kind, "reorder");
  assert.match(due.reasons[0], /۳۶ روز از آخرین خرید گذشته؛ معمولاً هر ۳۰ روز/);

  const gone = scoreSmsTarget({ ...base, days_since_last_purchase: 70 }, quiet, context)!;
  assert.equal(gone.kind, "winback");

  const declining = scoreSmsTarget(base, { ...quiet, recentSales: 6_000_000 }, context)!;
  assert.equal(declining.kind, "declining");
  assert.match(declining.reasons[0], /۸۰٪ کمتر/);

  const quote = scoreSmsTarget({ ...base, days_since_last_purchase: 36 }, { ...quiet, wantsPrice: true }, context)!;
  assert.equal(quote.kind, "quote", "an open price request outranks the routine reminder");
});

test("value raises the rank of customers who already have a reason", () => {
  const small = scoreSmsTarget({ ...base, days_since_last_purchase: 36 }, quiet, context)!;
  const big = scoreSmsTarget({ ...base, id: "c2", days_since_last_purchase: 36, total_sales: 300_000_000 }, quiet, context)!;
  assert.ok(big.score > small.score);
  assert.ok(big.reasons.some((reason) => reason.includes("۱۰٪")));
  assert.deepEqual(rankSmsTargets([small, null, big]).map((target) => target.customer.id), ["c2", "c1"]);
});

test("recent SMS or call, lost, archived and no mobile are left out", () => {
  assert.equal(exclusionReason(base, { lastSmsAt: daysAgo(5), lastContactAt: null }, true, now), "پیامک اخیر");
  assert.equal(exclusionReason(base, { lastSmsAt: daysAgo(15), lastContactAt: null }, true, now), null);
  assert.equal(exclusionReason(base, { lastSmsAt: null, lastContactAt: daysAgo(2) }, true, now), "تماس اخیر");
  assert.equal(exclusionReason({ ...base, status: "lost" }, { lastSmsAt: null, lastContactAt: null }, true, now), "از دست رفته");
  assert.equal(exclusionReason(base, { lastSmsAt: null, lastContactAt: null }, false, now), "موبایل ندارد");
});

test("Holoo debt plays no part; a bank-confirmed unpaid invoice is only a note", () => {
  const due = { ...base, days_since_last_purchase: 36 };
  const plain = scoreSmsTarget(due, quiet, context)!;
  const unpaid = scoreSmsTarget(due, { ...quiet, unpaidInvoice: true }, context)!;
  assert.equal(unpaid.score, plain.score);
  assert.match(unpaid.note ?? "", /فاکتور تسویه‌نشده/);
});

test("helpers: thresholds, six-month trend, favourite product, draft text", () => {
  const thresholds = salesThresholds(Array.from({ length: 20 }, (_, index) => ({ total_sales: (index + 1) * 1000 })));
  assert.deepEqual(thresholds, { topTenSales: 19000, topQuarterSales: 16000 });

  const trend = salesTrend(
    [
      { customer_id: "c1", invoice_date: daysAgo(10).slice(0, 10), total_amount: 100 },
      { customer_id: "c1", invoice_date: daysAgo(200).slice(0, 10), total_amount: 500 },
      { customer_id: "c1", invoice_date: daysAgo(400).slice(0, 10), total_amount: 999 },
    ],
    now,
  );
  assert.deepEqual(trend.get("c1"), { recentSales: 100, previousSales: 500 });

  const products = topProducts([
    { customer_id: "c1", product_name: "ژل", invoice_count: 2, last_purchase_at: "2026-10-01" },
    { customer_id: "c1", product_name: "ملحفه", invoice_count: 5, last_purchase_at: "2026-01-01" },
  ]);
  assert.equal(products.get("c1"), "ملحفه");

  const draft = draftSmsText("reorder", "کلینیک نمونه", "ملحفه");
  assert.match(draft, /^کلینیک نمونه گرامی، .*ملحفه.*\{contact\}/);
  assert.doesNotMatch(draft, /https?:/);
});

test("RFM ranks frequency and order value over the last 12 months", async () => {
  const { rfmScores } = await import("../src/lib/sales/sms-targets");
  const invoices = [
    // c1: 6 purchases a year, big orders.
    ...Array.from({ length: 6 }, (_, i) => ({ customer_id: "c1", invoice_date: daysAgo(30 + i * 50).slice(0, 10), total_amount: 40_000_000 })),
    // c2: 2 small purchases.
    { customer_id: "c2", invoice_date: daysAgo(20).slice(0, 10), total_amount: 2_000_000 },
    { customer_id: "c2", invoice_date: daysAgo(200).slice(0, 10), total_amount: 2_000_000 },
    // Ten typical customers: 3 purchases of 10m each.
    ...Array.from({ length: 30 }, (_, i) => ({
      customer_id: `f${i % 10}`,
      invoice_date: daysAgo(10 + i * 9).slice(0, 10),
      total_amount: 10_000_000,
    })),
    // c3: older than 12 months only.
    { customer_id: "c3", invoice_date: daysAgo(500).slice(0, 10), total_amount: 90_000_000 },
  ];
  const scores = rfmScores(invoices, now);
  assert.equal(scores.get("c1")?.purchases, 6);
  assert.equal(scores.get("c1")?.frequencyRank, 5);
  assert.equal(scores.get("c1")?.monetaryRank, 5);
  assert.equal(scores.get("c2")?.frequencyRank, 1);
  assert.equal(scores.has("c3"), false, "no purchase in 12 months: falls back to lifetime value");

  const due = { ...base, days_since_last_purchase: 36 };
  const strong = scoreSmsTarget(due, { ...quiet, rfm: scores.get("c1") }, context)!;
  const weak = scoreSmsTarget(due, { ...quiet, rfm: scores.get("c2") }, context)!;
  assert.ok(strong.score > weak.score);
  assert.ok(strong.reasons.some((reason) => reason.includes("۶ بار خرید")));
});

test("today's SMS list drops sent customers and refreshes to bring in the next ones", async () => {
  const { readFileSync } = await import("node:fs");
  const list = readFileSync("src/app/sms/today/today-sms-list.tsx", "utf8");
  assert.match(list, /targets\.filter\(\(target\) => !sent\.has\(target\.customerId\)\)/);
  assert.match(list, /if \(ok\) router\.refresh\(\)/);
  assert.match(list, /if \(anySent\) router\.refresh\(\)/);
  const page = readFileSync("src/app/sms/today/page.tsx", "utf8");
  assert.match(page, /loadTodayTargets\(supabase, limit\)/, "the list can grow past 20");
});
