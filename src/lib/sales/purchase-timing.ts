// Predicts when a customer will need to buy again. Pure: callers pass the
// customer's invoice dates and line items.
//
// Two estimates, the more specific one wins:
// - product run-out: from how much of a product they buy and how fast it is
//   used up (a double order lasts twice as long);
// - purchase cycle: the median gap between purchase days, which one unusual
//   gap does not distort the way an average does.

import { isServiceLine } from "@/lib/products/service-lines";

const DAY_MS = 86_400_000;
const MIN_INTERVAL_DAYS = 7;
const MAX_INTERVAL_DAYS = 365;
/** A customer with a single purchase is expected back after this many days. */
export const SINGLE_PURCHASE_DAYS = 60;
/** Gaps within this share of the median make a customer "regular". */
const REGULAR_SPREAD = 0.35;
/** A product not bought within this long before the last purchase is ignored. */
const STALE_PRODUCT_DAYS = 180;

export type NeedBasis = "product" | "cycle" | "single";

export type NeedPrediction = {
  basis: NeedBasis;
  /** Days a purchase is expected to last. */
  intervalDays: number;
  /** Share of the interval already used: 1 means due today. */
  progress: number;
  daysSinceLast: number;
  /** Days until the predicted need date (negative when it has passed). */
  daysToDue: number;
  regular: boolean;
  /** Product the prediction is about (product basis). */
  product: string | null;
};

function dayIndex(date: string) {
  return Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clampInterval(days: number) {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(days)));
}

/** Median gap between distinct purchase days, and whether the gaps are steady. */
export function purchaseCycle(invoiceDates: string[]) {
  const days = [...new Set(invoiceDates.map(dayIndex))].sort((a, b) => a - b);
  const gaps = days.slice(1).map((day, index) => day - days[index]);
  if (!gaps.length) return null;
  const mid = median(gaps);
  // Median absolute deviation: robust measure of how much the gaps vary.
  const spread = median(gaps.map((gap) => Math.abs(gap - mid)));
  return {
    medianDays: clampInterval(mid),
    regular: gaps.length >= 2 && mid > 0 && spread / mid <= REGULAR_SPREAD,
    purchases: days.length,
  };
}

export type ItemPurchase = { date: string; product: string; quantity: number };

/**
 * Earliest predicted run-out over the products bought on at least two days.
 * Usage rate = quantity bought before the last purchase / days it covered;
 * the last purchase lasts its quantity / rate.
 */
export function productRunOut(items: ItemPurchase[]) {
  const byProduct = new Map<string, Map<number, number>>();
  for (const item of items) {
    const name = item.product.replace(/\s+/g, " ").trim();
    if (!name || !(item.quantity > 0) || isServiceLine(name)) continue;
    const days = byProduct.get(name) ?? new Map<number, number>();
    const day = dayIndex(item.date);
    days.set(day, (days.get(day) ?? 0) + item.quantity);
    byProduct.set(name, days);
  }

  const lastPurchase = Math.max(...items.map((item) => dayIndex(item.date)));
  let best: { product: string; lastDay: number; intervalDays: number; purchases: number } | null = null;
  for (const [product, days] of byProduct) {
    const purchases = [...days.entries()].sort((a, b) => a[0] - b[0]);
    if (purchases.length < 2) continue;
    const [lastDay, lastQuantity] = purchases[purchases.length - 1];
    if (lastPurchase - lastDay > STALE_PRODUCT_DAYS) continue;
    const span = lastDay - purchases[0][0];
    const usedBeforeLast = purchases.slice(0, -1).reduce((sum, [, quantity]) => sum + quantity, 0);
    if (span <= 0 || usedBeforeLast <= 0) continue;
    const intervalDays = clampInterval(lastQuantity / (usedBeforeLast / span));
    const candidate = { product, lastDay, intervalDays, purchases: purchases.length };
    if (!best) {
      best = candidate;
      continue;
    }
    // Products bought three or more times are more reliable; among equals,
    // the one that runs out first decides.
    const reliable = candidate.purchases >= 3;
    const bestReliable = best.purchases >= 3;
    if (reliable !== bestReliable ? reliable : candidate.lastDay + candidate.intervalDays < best.lastDay + best.intervalDays) {
      best = candidate;
    }
  }
  return best;
}

export function predictNeed(input: {
  invoiceDates: string[];
  items: ItemPurchase[];
  now: Date;
}): NeedPrediction | null {
  if (!input.invoiceDates.length) return null;
  const today = Math.floor(input.now.getTime() / DAY_MS);
  const lastDay = Math.max(...input.invoiceDates.map(dayIndex));
  const cycle = purchaseCycle(input.invoiceDates);
  const runOut = input.items.length ? productRunOut(input.items) : null;

  const build = (basis: NeedBasis, fromDay: number, intervalDays: number, regular: boolean, product: string | null) => {
    const daysSinceLast = today - fromDay;
    return {
      basis,
      intervalDays,
      progress: daysSinceLast / intervalDays,
      daysSinceLast,
      daysToDue: fromDay + intervalDays - today,
      regular,
      product,
    };
  };

  // A product bought three or more times is the most specific signal; one
  // bought twice still beats a cycle built from a single gap.
  if (runOut && (runOut.purchases >= 3 || !cycle || cycle.purchases < 3)) {
    return build("product", runOut.lastDay, runOut.intervalDays, runOut.purchases >= 3, runOut.product);
  }
  if (cycle) return build("cycle", lastDay, cycle.medianDays, cycle.regular, null);
  return build("single", lastDay, SINGLE_PURCHASE_DAYS, false, null);
}

/**
 * Score and wording for the timing part of a target. The best moment is just
 * before the predicted need (85-100%), not after the customer has bought
 * elsewhere; a long silence is a win-back case instead.
 */
export function timingSignal(prediction: NeedPrediction) {
  const { progress, basis, regular } = prediction;
  if (progress < 0.85) return null;
  const confidence = basis === "single" ? 0.6 : regular ? 1 : 0.75;
  if (progress >= 2 && basis !== "single") return { kind: "winback" as const, points: Math.round(30 * confidence) };
  const points = progress < 1 ? 35 : progress < 1.5 ? 30 : 22;
  return { kind: "reorder" as const, points: Math.round(points * confidence) };
}

const persianNumber = new Intl.NumberFormat("fa-IR");

/** One plain sentence explaining the timing. */
export function timingReason(prediction: NeedPrediction) {
  const { basis, daysToDue, daysSinceLast, intervalDays, regular, product } = prediction;
  const when =
    daysToDue > 0
      ? `حدود ${persianNumber.format(daysToDue)} روز دیگر`
      : daysToDue === 0
        ? "همین روزها"
        : `حدود ${persianNumber.format(-daysToDue)} روز پیش`;
  if (basis === "product") {
    return `بر اساس مقدار خریدهای قبلی، ${product} او ${when} تمام ${daysToDue > 0 ? "می‌شود" : "شده"}`;
  }
  if (basis === "cycle") {
    return `${persianNumber.format(daysSinceLast)} روز از آخرین خرید گذشته؛ معمولاً هر ${persianNumber.format(
      intervalDays,
    )} روز خرید می‌کند${regular ? " (منظم)" : ""}`;
  }
  return `${persianNumber.format(daysSinceLast)} روز از تنها خریدش گذشته`;
}
