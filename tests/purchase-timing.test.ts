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
    /مقدار خریدهای قبلی، ملحفه او حدود ۶ روز دیگر تمام می‌شود/,
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
