import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(timingSignal({ ...regular, basis: "single", progress: 3 })?.kind, "reorder", "one purchase is never win-back");
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
