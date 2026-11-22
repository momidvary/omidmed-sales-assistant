import assert from "node:assert/strict";
import test from "node:test";
import { isReorderUnit } from "../src/lib/sales/reorder-unit";

import {
  predictNeed,
  productRunOut,
  purchaseCycle,
  timingReason,
  timingSignal,
} from "../src/lib/sales/purchase-timing";

const now = new Date("2026-10-19T09:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

test("the cycle is the median gap, so one long silence does not distort it", () => {
  // Gaps: 30, 30, 120, 30 -> average 52.5, median 30.
  const cycle = purchaseCycle([daysAgo(240), daysAgo(210), daysAgo(180), daysAgo(60), daysAgo(30)]);
  assert.equal(cycle?.medianDays, 30);
  assert.equal(cycle?.regular, true, "three steady gaps out of four is regular");

  const erratic = purchaseCycle([daysAgo(200), daysAgo(190), daysAgo(100), daysAgo(85), daysAgo(5)]);
  assert.equal(erratic?.regular, false);

  assert.equal(purchaseCycle([daysAgo(10), daysAgo(10)]), null, "two invoices on one day are one purchase");
});

test("a double order lasts twice as long", () => {
  // 10 packs every 30 days, then 20 packs: the next need is 60 days out.
  const items = [
    { date: daysAgo(70), product: "ملحفه", quantity: 10 },
    { date: daysAgo(40), product: "ملحفه", quantity: 10 },
    { date: daysAgo(10), product: "ملحفه", quantity: 20 },
  ];
  const runOut = productRunOut(items);
  assert.equal(runOut?.product, "ملحفه");
  assert.equal(runOut?.intervalDays, 60);

  const prediction = predictNeed({ invoiceDates: items.map((item) => item.date), items, now })!;
  assert.equal(prediction.basis, "product");
  assert.equal(prediction.daysToDue, 50);
  assert.equal(timingSignal(prediction), null, "far from the run-out date: no message yet");
});

test("the product that runs out first, among reliable ones, decides", () => {
  const items = [
    // Gel: 3 purchases, runs out in ~5 days.
    { date: daysAgo(55), product: "ژل", quantity: 5 },
    { date: daysAgo(30), product: "ژل", quantity: 5 },
    { date: daysAgo(20), product: "ژل", quantity: 1 },
    // Sheets: 3 purchases, runs out in ~40 days.
    { date: daysAgo(80), product: "ملحفه", quantity: 10 },
    { date: daysAgo(50), product: "ملحفه", quantity: 10 },
    { date: daysAgo(20), product: "ملحفه", quantity: 20 },
  ];
  assert.equal(productRunOut(items)?.product, "ژل");
});

test("the best moment is just before the need; a long silence is win-back", () => {
  const regular = { basis: "cycle" as const, intervalDays: 30, daysToDue: 0, daysSinceLast: 0, regular: true, product: null };
  assert.equal(timingSignal({ ...regular, progress: 0.8 }), null);
  assert.deepEqual(timingSignal({ ...regular, progress: 0.9 }), { kind: "reorder", points: 35 });
  assert.deepEqual(timingSignal({ ...regular, progress: 1.2 }), { kind: "reorder", points: 30 });
  assert.deepEqual(timingSignal({ ...regular, progress: 2.5 }), { kind: "winback", points: 30 });
  // Less certain predictions weigh less.
  assert.deepEqual(timingSignal({ ...regular, regular: false, progress: 0.9 }), { kind: "reorder", points: 26 });
  assert.equal(timingSignal({ ...regular, basis: "single", progress: 3 })?.kind, "first_purchase", "one purchase gives a follow-up, not a measured cycle");
});

test("reasons say what the prediction is based on", () => {
  assert.match(
    timingReason({ basis: "product", intervalDays: 60, progress: 0.9, daysSinceLast: 54, daysToDue: 6, regular: true, product: "ملحفه" }),
    /موعد تقریبی سفارش ملحفه حدود ۶ روز دیگر/,
  );
  assert.match(
    timingReason({ basis: "cycle", intervalDays: 30, progress: 1.1, daysSinceLast: 33, daysToDue: -3, regular: true, product: null }),
    /۳۳ روز از آخرین خرید گذشته؛ معمولاً هر ۳۰ روز خرید می‌کند \(منظم\)/,
  );
});

test("shipping and other charges are never treated as products", async () => {
  const { isServiceLine } = await import("../src/lib/products/service-lines");
  for (const name of ["هزینه حمل", "هزينه ارسال", "کرایه باربری", "تخفیف", "بسته‌بندی", "هزینه پست"]) {
    assert.ok(isServiceLine(name), name);
  }
  for (const name of ["ملحفه یکبار مصرف", "ژل سونوگرافی", "الکترود"]) {
    assert.ok(!isServiceLine(name), name);
  }
  // Shipping on every invoice must not become the product "running out".
  const items = [
    { date: daysAgo(90), product: "هزینه حمل", quantity: 1 },
    { date: daysAgo(60), product: "هزینه حمل", quantity: 1 },
    { date: daysAgo(30), product: "هزینه حمل", quantity: 1 },
    { date: daysAgo(90), product: "ملحفه", quantity: 10 },
    { date: daysAgo(60), product: "ملحفه", quantity: 10 },
    { date: daysAgo(30), product: "ملحفه", quantity: 10 },
  ];
  assert.equal(productRunOut(items)?.product, "ملحفه");
});

test("a product dropped from later orders does not make an active customer win-back", () => {
  // Sheets every 30 days until 200 days ago; gel every month since, last 16 days ago.
  const items = [
    { date: daysAgo(260), product: "ملحفه", quantity: 10 },
    { date: daysAgo(230), product: "ملحفه", quantity: 10 },
    { date: daysAgo(200), product: "ملحفه", quantity: 10 },
    ...[166, 136, 106, 76, 46, 16].map((days) => ({ date: daysAgo(days), product: "ژل", quantity: 2 })),
  ];
  assert.equal(productRunOut(items)?.product, "ژل", "sheets ran out before the later orders");

  const prediction = predictNeed({ invoiceDates: items.map((item) => item.date), items, now })!;
  assert.equal(prediction.daysSinceLast, 16);
  assert.equal(timingSignal(prediction), null, "bought 16 days ago on a 30-day rhythm: nothing to send");

  // Ordering a little early without the product keeps it.
  const early = [
    { date: daysAgo(70), product: "ملحفه", quantity: 10 },
    { date: daysAgo(40), product: "ملحفه", quantity: 10 },
    { date: daysAgo(15), product: "ژل", quantity: 1 },
  ];
  assert.equal(productRunOut(early)?.product, "ملحفه");
});

test("a customer's pack uses equivalent SKUs and only complete pack orders reset its cycle", async () => {
  const { isReorderUnit, unitOrders, identifyProducts } = await import("../src/lib/sales/reorder-unit");
  const unit = { label: "پک درمان", parts: [
    { quantity: 2, keys: ["sku:FR", "sku:ES"] }, { quantity: 1, keys: ["sku:S"] }, { quantity: 1, keys: ["sku:B"] },
  ] };
  const line = (ago: number, articleCode: string, quantity: number, invoiceId = String(ago)) =>
    ({ date: daysAgo(ago), product: articleCode, articleCode, quantity, invoiceId });
  const items = [120, 80, 40].flatMap(ago =>
    [line(ago, ago === 40 ? "ES" : "FR", 2000), line(ago, "S", 1000), line(ago, "B", 1000)]);
  items.push(line(7, "FR", 200), line(7, "S", 50, "separate"), line(7, "B", 50, "separate"));
  const units = unitOrders(identifyProducts(items), unit);
  assert.deepEqual([...units.values()], [1000, 1000, 1000]);
  const inputs = { invoiceDates: items.map(x => x.date), items, now, unit };
  const result = predictNeed(inputs)!;
  assert.equal(result.product, "پک درمان");
  assert.equal(result.intervalDays, 40);
  assert.equal(timingSignal({ ...result, progress: 0.8, daysToDue: 8 }), null);
  assert.equal(timingSignal({ ...result, progress: 0.825, daysToDue: 7 })?.kind, "reorder");
  assert.equal(result.daysToDue, 0);
  assert.equal(predictNeed({ ...inputs, items: items.slice(0, 3) }), null);
  assert.equal(isReorderUnit(unit), true);
  assert.equal(isReorderUnit({ ...unit, parts: [...unit.parts, unit.parts[0]] }), false);
});

test("standalone pads and different needle sizes retain their own time series", async () => {
  const { identifyProducts } = await import("../src/lib/sales/reorder-unit");
  const line = (ago: number, product: string, articleCode: string | null, quantity: number) =>
    ({ date: daysAgo(ago), product, articleCode, quantity });
  const pads = [line(90, "پد قدیمی", null, 500), line(60, "پد قدیمی", "P", 500),
    line(30, "پد جدید", "P", 1000)];
  assert.equal(predictNeed({ items: pads, invoiceDates: pads.map(x => x.date), now })?.intervalDays, 60);
  const needles = [line(100, "نیدل", "N1", 1), line(60, "نیدل", "N1", 1), line(20, "نیدل", "N1", 1),
    line(60, "نیدل", "N2", 1), line(35, "نیدل", "N2", 1), line(10, "نیدل", "N2", 1)];
  const prediction = predictNeed({ items: needles, invoiceDates: needles.map(x => x.date), now })!;
  assert.equal(prediction.product, "نیدل (N2)");
  assert.equal(prediction.intervalDays, 25);
  assert.equal(prediction.daysToDue, 15);
  assert.equal(identifyProducts([...needles, line(5, "نیدل", null, 1)]).at(-1)?.key, "name:نیدل");
});

const stockUnit = {
  label: "بسته", parts: [{ quantity: 1, keys: ["sku:X"] }], leadDays: 3, reorderAt: 12,
  stockCounts: [{ date: daysAgo(12), quantity: 60 }, { date: daysAgo(2), quantity: 40 }],
};
const stockItems = (orders: [number, number][]) => orders.map(([ago, quantity]) =>
  ({ date: daysAgo(ago), product: "بسته", articleCode: "X", quantity }));

test("the reported balance and reorder point determine the SMS window", () => {
  // Total opening balance includes the old stock on hand as well as this delivery.
  const items = stockItems([[12, 46]]);
  const input = { items, invoiceDates: items.map(i => i.date), now, unit: stockUnit };
  const result = predictNeed(input)!;
  assert.equal(result.basis, "stock");
  assert.equal(result.daysToDue, 12);
  assert.equal(timingSignal(result), null);
  assert.match(timingReason(result), /آستانهٔ سفارش ۱۲/);
  const later = (days: number) => predictNeed({ ...input, now: new Date(daysAgo(-days) + "T12:00:00Z") })!;
  assert.equal(timingSignal(later(8)), null);
  assert.equal(timingSignal(later(9))?.kind, "reorder");
  assert.equal(later(12).daysToDue, 0);
  assert.equal(timingSignal(later(60))?.kind, "reorder");
});

test("receipts between counts and later deliveries update the stock estimate once", () => {
  const items = stockItems([[12, 46], [2, 20], [1, 10]]);
  items.push({ date: daysAgo(0), product: "کالای دیگر", articleCode: "Y", quantity: 100 });
  // 60 + 20 - 40 over 10 days = 4/day. After one day, add 10 to 36.
  const result = predictNeed({ items, invoiceDates: items.map(i => i.date), now, unit: stockUnit })!;
  assert.equal(result.daysToDue, 8);
  const later = stockItems([[12, 46], [-30, 20]]);
  const restocked = predictNeed({ items: later, invoiceDates: later.map(i => i.date), unit: stockUnit,
    now: new Date(daysAgo(-30) + "T12:00:00Z") })!;
  assert.equal(restocked.daysToDue, 4, "a delivery after depletion opens with zero old stock");
});

test("a direct threshold report needs no second count; insufficient rate data uses purchase history", () => {
  const items = stockItems([[50, 30], [20, 30]]);
  const input = { items, invoiceDates: items.map(i => i.date), now };
  const oneCount = { ...stockUnit, stockCounts: [{ date: daysAgo(0), quantity: 12 }] };
  assert.equal(predictNeed({ ...input, unit: oneCount })?.daysToDue, 0);
  assert.equal(predictNeed({ ...input, unit: { ...oneCount, reorderAt: 0 } })?.basis, "product");
  const noUse = { ...stockUnit, stockCounts: [
    { date: daysAgo(15), quantity: 20 }, { date: daysAgo(2), quantity: 20 },
    { date: daysAgo(-1), quantity: 0 },
  ] };
  assert.equal(predictNeed({ ...input, unit: noUse })?.basis, "product");
  const newer = { ...stockUnit, stockCounts: [{ date: daysAgo(1), quantity: 30 }, ...stockUnit.stockCounts] };
  assert.equal(predictNeed({ ...input, unit: newer })?.daysToDue, 1, "the latest two dated counts set the rate");
});

test("stock counts require real distinct calendar dates and non-negative whole quantities", () => {
  assert.equal(isReorderUnit(stockUnit), true);
  assert.equal(isReorderUnit({ ...stockUnit, reorderAt: 0, stockCounts: [] }), true);
  assert.equal(isReorderUnit({ ...stockUnit, reorderAt: -1 }), false);
  assert.equal(isReorderUnit({ ...stockUnit, stockCounts: stockUnit.stockCounts.concat(stockUnit.stockCounts) }), false);
  for (const count of [{ date: "2025-02-29", quantity: 0 }, { date: "invalid", quantity: 1 },
    { date: daysAgo(0), quantity: 0.5 }, { date: daysAgo(0), quantity: -1 }]) {
    assert.equal(isReorderUnit({ ...stockUnit, stockCounts: [count] }), false);
  }
});
