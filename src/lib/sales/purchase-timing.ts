// Predicts when a customer will need to buy again. Pure: callers pass the
// customer's invoice dates and line items.
//
// Customer stock counts and a known reorder point take precedence over:
// - product run-out: from how much of a product they buy and how fast it is
//   used up (a double order lasts twice as long);
// - purchase cycle: the median gap between purchase days, which one unusual
//   gap does not distort the way an average does.

import { tehranDateKey } from "@/lib/finance/metrics";
import { identifyProducts, unitOrders, type ItemPurchase, type ReorderUnit } from "./reorder-unit";
export type { ItemPurchase } from "./reorder-unit";

const DAY_MS = 86_400_000;
const MIN_INTERVAL_DAYS = 7;
const MAX_INTERVAL_DAYS = 365;
/** A customer with a single purchase is expected back after this many days. */
export const SINGLE_PURCHASE_DAYS = 60;
/** Gaps within this share of the median make a customer "regular". */
const REGULAR_SPREAD = 0.35;
/** A product not bought within this long before the last purchase is ignored. */
const STALE_PRODUCT_DAYS = 180;
/** Share of a product's interval an order may come early without it. */
const RUN_OUT_GRACE = 0.15;

export type NeedBasis = "stock" | "product" | "cycle" | "single";

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
  intervals?: number;
  errorDays?: number | null;
  leadDays?: number;
  reorderAt?: number;
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

type Order = [day: number, quantity: number];

function stockTiming(unit: ReorderUnit, orders: Order[], today: number): NeedPrediction | null {
  const threshold = unit.reorderAt;
  if (threshold === undefined || !unit.stockCounts?.length) return null;
  const counts = unit.stockCounts.map(count => ({ day: dayIndex(count.date), quantity: count.quantity }))
    .filter(count => count.day <= today).sort((a, b) => a.day - b.day);
  const latest = counts.at(-1);
  if (!latest) return null;
  const previous = counts.at(-2);
  const receipts = orders.filter(([day]) => day > latest.day);
  let dueDay = latest.day;
  let fromDay = latest.day;

  // A count at/below the threshold is actionable even without a known rate.
  if (latest.quantity > threshold || receipts.length) {
    if (!previous) return null;
    const span = latest.day - previous.day;
    // Counts include all receipts on the count day.
    const received = orders.reduce((sum, [day, qty]) =>
      day > previous.day && day <= latest.day ? sum + qty : sum, 0);
    const used = previous.quantity + received - latest.quantity;
    if (used <= 0) return null;
    // Keep the rate as a fraction to avoid rounding a whole-day forecast up a day.
    let balanceTimesSpan = latest.quantity * span;
    let balanceDay = latest.day;
    for (const [day, quantity] of receipts) {
      balanceTimesSpan = Math.max(0, balanceTimesSpan - (day - balanceDay) * used) + quantity * span;
      balanceDay = day;
    }
    const remaining = Math.max(0, balanceTimesSpan - threshold * span);
    dueDay = balanceDay + Math.ceil(remaining / used);
    if (!Number.isFinite(new Date(dueDay * DAY_MS).getTime())) return null;
    fromDay = receipts.length ? balanceDay : previous.day;
  }
  const intervalDays = Math.max(1, dueDay - fromDay);
  const daysToDue = dueDay - today;
  return {
    basis: "stock", intervalDays, daysToDue, progress: 1 - daysToDue / intervalDays,
    daysSinceLast: today - fromDay, regular: false, product: unit.label,
    reorderAt: threshold, leadDays: unit.leadDays ?? 7,
  };
}

function intervalFor(orders: Order[]) {
  const quantity = orders[orders.length - 1][1];
  const same: number[] = [];
  const scaled: number[] = [];
  for (let i = 1; i < orders.length; i++) {
    const [day, previousQuantity] = orders[i - 1];
    const gap = orders[i][0] - day;
    if (previousQuantity === quantity) same.push(gap);
    scaled.push(gap * quantity / previousQuantity);
  }
  const gaps = same.length >= 2 ? same : scaled;
  const typical = median(gaps);
  return {
    intervalDays: clampInterval(typical),
    intervals: gaps.length,
    regular: gaps.length >= 2 && median(gaps.map(gap => Math.abs(gap - typical))) <= typical * REGULAR_SPREAD,
  };
}

function pastError(orders: Order[]) {
  const errors: number[] = [];
  // Replay recent completed intervals using only information available at each order.
  for (let i = Math.max(2, orders.length - 8); i < orders.length; i++) {
    const estimate = intervalFor(orders.slice(0, i));
    errors.push(Math.abs(estimate.intervalDays - (orders[i][0] - orders[i - 1][0])));
  }
  return errors.length >= 2 ? Math.round(median(errors)) : null;
}

export function productRunOut(items: ItemPurchase[], lastPurchaseDate?: string) {
  const byProduct = new Map<string, Map<number, number>>();
  const labels = new Map<string, { date: string; name: string }>();
  for (const item of identifyProducts(items)) {
    const days = byProduct.get(item.key) ?? new Map<number, number>();
    const day = dayIndex(item.date);
    days.set(day, (days.get(day) ?? 0) + item.quantity);
    byProduct.set(item.key, days);
    const latest = labels.get(item.key);
    if (!latest || latest.date <= item.date) {
      const name = !item.legacyKey && item.articleCode ? `${item.product} (${item.articleCode})` : item.product;
      labels.set(item.key, { date: item.date, name });
    }
  }

  const lastPurchase = items.reduce((last, item) => Math.max(last, dayIndex(item.date)),
    lastPurchaseDate ? dayIndex(lastPurchaseDate) : -Infinity);
  let best: { product: string; lastDay: number; intervalDays: number; purchases: number; regular: boolean; intervals: number; orders: Order[] } | null = null;
  for (const [product, days] of byProduct) {
    const purchases = [...days.entries()].sort((a, b) => a[0] - b[0]);
    if (purchases.length < 2) continue;
    const [lastDay] = purchases[purchases.length - 1];
    if (lastPurchase - lastDay > STALE_PRODUCT_DAYS) continue;
    const estimate = intervalFor(purchases);
    const { intervalDays } = estimate;
    const grace = Math.max(MIN_INTERVAL_DAYS, Math.round(intervalDays * RUN_OUT_GRACE));
    if (lastDay + intervalDays + grace < lastPurchase) continue;
    const candidate = { product: labels.get(product)!.name, lastDay, ...estimate, purchases: purchases.length, orders: purchases };
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
  unit?: ReorderUnit | null;
}): NeedPrediction | null {
  const asOf = tehranDateKey(input.now);
  const invoiceDates = input.invoiceDates.filter(date => date <= asOf);
  const items = input.items.filter(item => item.date <= asOf);
  const today = dayIndex(asOf);

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

  if (input.unit) {
    const quantities = unitOrders(identifyProducts(items), input.unit);
    const orders: Order[] = [...quantities].map(([date, qty]): Order => [dayIndex(date), qty]).sort((a, b) => a[0] - b[0]);
    const stock = stockTiming(input.unit, orders, today);
    if (stock) return stock;
    if (orders.length < 2) return null;
    const estimate = intervalFor(orders);
    return {
      ...build("product", orders[orders.length - 1][0], estimate.intervalDays, estimate.regular, input.unit.label),
      intervals: estimate.intervals,
      errorDays: pastError(orders),
      leadDays: Math.min(input.unit.leadDays ?? 7, estimate.intervalDays - 1),
    };
  }
  if (!invoiceDates.length) return null;
  const lastDate = invoiceDates.reduce((latest, date) => date > latest ? date : latest);
  const lastDay = dayIndex(lastDate);
  const cycle = purchaseCycle(invoiceDates);
  const runOut = items.length ? productRunOut(items, lastDate) : null;
  // A product bought three or more times is the most specific signal; one
  // bought twice still beats a cycle built from a single gap.
  if (runOut && (runOut.purchases >= 3 || !cycle || cycle.purchases < 3)) {
    return {
      ...build("product", runOut.lastDay, runOut.intervalDays, runOut.regular, runOut.product),
      intervals: runOut.intervals,
      errorDays: pastError(runOut.orders),
    };
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
  const tooEarly = prediction.leadDays == null ? progress < 0.85 : prediction.daysToDue > prediction.leadDays;
  if (tooEarly) return null;
  if (basis === "stock") return { kind: "reorder" as const, points: 35 };
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
  if (basis === "stock") {
    return `موعد تقریبی سفارش ${product} ${when}، بر اساس موجودی گزارش‌شده و آستانهٔ سفارش ${persianNumber.format(prediction.reorderAt!)}`;
  }
  if (basis === "product") {
    const error = prediction.errorDays == null ? "" : `؛ میانهٔ خطای پیش‌بینی‌های قبلی ${persianNumber.format(prediction.errorDays)} روز`;
    const evidence = prediction.intervals ? ` (بر اساس ${persianNumber.format(prediction.intervals)} فاصلهٔ خرید)` : "";
    return `موعد تقریبی سفارش ${product} ${when}${evidence}${error}`;
  }
  if (basis === "cycle") {
    return `${persianNumber.format(daysSinceLast)} روز از آخرین خرید گذشته؛ معمولاً هر ${persianNumber.format(
      intervalDays,
    )} روز خرید می‌کند${regular ? " (منظم)" : ""}`;
  }
  return `${persianNumber.format(daysSinceLast)} روز از تنها خریدش گذشته (تخمین اولیهٔ ۶۰ روزه)`;
}
