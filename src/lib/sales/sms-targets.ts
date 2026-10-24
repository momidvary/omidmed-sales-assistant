// Ranks the customers who should get a sales SMS today, with the reasons in
// plain words and a draft message. Pure: the page loads the data.
//
// Holoo's debtor status is deliberately not used: payments are often not
// recorded there, so "owes money" is unreliable. Only an invoice the bank
// data shows unpaid is mentioned, as a note, and never removes a customer.

import { purchaseCycleDays, RECENT_CONTACT_DAYS } from "./followup-need";
import { isServiceLine } from "@/lib/products/service-lines";
import { persianLetters } from "@/lib/search/normalize";

import { timingReason, timingSignal, type NeedPrediction } from "./purchase-timing";

export const DAILY_SMS_TARGETS = 20;
/** A customer gets at most one SMS in this many days. */
export const SMS_COOLDOWN_DAYS = 14;

const DAY_MS = 86_400_000;
const TREND_WINDOW_DAYS = 182;

export type TargetKind = "scheduled" | "quote" | "winback" | "declining" | "reorder";

export type TargetCustomer = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  priority: string;
  archived_at: string | null;
  next_followup_at: string | null;
  purchase_count: number | string | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | string | null;
};

export type TargetSignals = {
  /** Sales in the last ~6 months and the 6 months before (toman). */
  recentSales: number;
  previousSales: number;
  /** Most often bought product, if any. */
  topProduct: string | null;
  lastSmsAt: string | null;
  lastContactAt: string | null;
  /** Asked for a price after the last purchase, or has an open quote. */
  wantsPrice: boolean;
  /** An invoice the bank data shows unpaid (note only). */
  unpaidInvoice: boolean;
  /** Predicted need date from invoices and line items; summary fields otherwise. */
  timing?: NeedPrediction | null;
  /** Frequency and order-value ranks over the last 12 months, if they bought. */
  rfm?: RfmScore | null;
};

export type RfmScore = {
  /** Purchase days in the last 12 months. */
  purchases: number;
  /** Average invoice amount in the last 12 months (toman). */
  averageOrder: number;
  /** 1-5 by fifths among customers who bought in the last 12 months. */
  frequencyRank: number;
  monetaryRank: number;
};

const RFM_WINDOW_DAYS = 365;

/** 1-5: which fifth of the sorted values this one falls in. */
function fifth(sorted: number[], value: number) {
  let below = 0;
  while (below < sorted.length && sorted[below] < value) below += 1;
  return Math.min(5, 1 + Math.floor((below / sorted.length) * 5));
}

/**
 * Frequency (purchase days) and monetary (average invoice) ranks over the
 * last 12 months. Recency is covered by the purchase timing.
 */
export function rfmScores(
  invoices: Array<{ customer_id: string; invoice_date: string; total_amount: number | string }>,
  now: Date,
) {
  const stats = new Map<string, { days: Set<string>; total: number; count: number }>();
  for (const invoice of invoices) {
    const age = (now.getTime() - Date.parse(invoice.invoice_date)) / DAY_MS;
    if (age < 0 || age >= RFM_WINDOW_DAYS) continue;
    const entry = stats.get(invoice.customer_id) ?? { days: new Set<string>(), total: 0, count: 0 };
    entry.days.add(invoice.invoice_date.slice(0, 10));
    entry.total += numeric(invoice.total_amount);
    entry.count += 1;
    stats.set(invoice.customer_id, entry);
  }
  const frequencies = [...stats.values()].map((entry) => entry.days.size).sort((a, b) => a - b);
  const averages = [...stats.values()].map((entry) => entry.total / entry.count).sort((a, b) => a - b);
  const scores = new Map<string, RfmScore>();
  for (const [customerId, entry] of stats) {
    const averageOrder = entry.total / entry.count;
    scores.set(customerId, {
      purchases: entry.days.size,
      averageOrder,
      frequencyRank: fifth(frequencies, entry.days.size),
      monetaryRank: fifth(averages, averageOrder),
    });
  }
  return scores;
}

export type SmsTarget = {
  customer: TargetCustomer;
  kind: TargetKind;
  score: number;
  reasons: string[];
  topProduct: string | null;
  note: string | null;
};

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  scheduled: "پیگیری تعیین‌شده",
  quote: "قیمت گرفته، خرید نکرده",
  winback: "در خطر از دست رفتن",
  declining: "خریدش کم شده",
  reorder: "موعد خرید مجدد",
};

const persianNumber = new Intl.NumberFormat("fa-IR");

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysSince(value: string | null, now: Date) {
  return value ? (now.getTime() - new Date(value).getTime()) / DAY_MS : Infinity;
}

/** Why a customer is left out today, or null when they may be messaged. */
export function exclusionReason(
  customer: TargetCustomer,
  signals: Pick<TargetSignals, "lastSmsAt" | "lastContactAt">,
  hasMobile: boolean,
  now: Date,
) {
  if (customer.status === "lost") return "از دست رفته";
  if (customer.archived_at) return "بایگانی";
  if (!hasMobile) return "موبایل ندارد";
  if (daysSince(signals.lastSmsAt, now) < SMS_COOLDOWN_DAYS) return "پیامک اخیر";
  if (daysSince(signals.lastContactAt, now) < RECENT_CONTACT_DAYS) return "تماس اخیر";
  return null;
}

/** Timing from the summary view when invoice details were not loaded. */
function summaryTiming(customer: TargetCustomer): NeedPrediction | null {
  const purchases = Math.round(numeric(customer.purchase_count));
  if (!purchases || customer.days_since_last_purchase == null) return null;
  const intervalDays = purchaseCycleDays(customer);
  const daysSinceLast = Math.round(numeric(customer.days_since_last_purchase));
  return {
    basis: purchases >= 2 ? "cycle" : "single",
    intervalDays,
    progress: daysSinceLast / intervalDays,
    daysSinceLast,
    daysToDue: intervalDays - daysSinceLast,
    regular: false,
    product: null,
  };
}

export function scoreSmsTarget(
  customer: TargetCustomer,
  signals: TargetSignals,
  context: { topTenSales: number; topQuarterSales: number; now: Date },
): SmsTarget | null {
  const { now } = context;
  const reasons: string[] = [];
  let score = 0;
  const triggers = new Set<TargetKind>();

  // 1) Timing: just before the predicted need is the best moment.
  const timing = signals.timing === undefined ? summaryTiming(customer) : signals.timing;
  const timed = timing ? timingSignal(timing) : null;
  if (timing && timed) {
    score += timed.points;
    triggers.add(timed.kind);
    reasons.push(
      timed.kind === "winback"
        ? `${timingReason(timing)}؛ بیش از دو برابر حالت معمول خرید نکرده`
        : timingReason(timing),
    );
  }

  // 2) Trend: buying clearly less than six months before.
  if (signals.previousSales > 0 && signals.recentSales < signals.previousSales * 0.6) {
    const drop = Math.round((1 - signals.recentSales / signals.previousSales) * 100);
    score += 15;
    triggers.add("declining");
    reasons.push(`خرید ۶ ماه اخیرش ${persianNumber.format(drop)}٪ کمتر از ۶ ماه قبل است`);
  }

  // 3) Asked for a price and has not bought since.
  if (signals.wantsPrice) {
    score += 25;
    triggers.add("quote");
    reasons.push("قیمت گرفته و بعد از آن خریدی ثبت نشده");
  }

  // 4) A follow-up date the user chose.
  if (customer.next_followup_at && new Date(customer.next_followup_at).getTime() <= now.getTime()) {
    score += 30;
    triggers.add("scheduled");
    reasons.push("موعد پیگیری‌ای که تعیین کرده‌اید رسیده");
  }

  // Value alone never puts a customer on the list.
  if (!triggers.size) return null;

  // 5) Customer value: RFM over the last 12 months when the customer bought
  // in that time, the lifetime total otherwise (a big past customer still
  // matters for win-back).
  const rfm = signals.rfm;
  if (rfm) {
    const points = (rank: number) => (rank >= 5 ? 10 : rank >= 4 ? 7 : rank >= 3 ? 4 : 0);
    score += points(rfm.frequencyRank) + points(rfm.monetaryRank);
    if (rfm.frequencyRank >= 4) {
      reasons.push(
        `در ۱۲ ماه اخیر ${persianNumber.format(rfm.purchases)} بار خرید کرده (جزو ${
          rfm.frequencyRank >= 5 ? "۲۰" : "۴۰"
        }٪ پرتکرار)`,
      );
    }
    if (rfm.monetaryRank >= 4) {
      reasons.push(
        `میانگین هر سفارشش ${persianNumber.format(Math.round(rfm.averageOrder))} تومان است (جزو ${
          rfm.monetaryRank >= 5 ? "۲۰" : "۴۰"
        }٪ بالا)`,
      );
    }
  } else {
    const totalSales = numeric(customer.total_sales);
    if (totalSales > 0 && totalSales >= context.topTenSales) {
      score += 20;
      reasons.push("جزو ۱۰٪ مشتریان با بیشترین خرید است");
    } else if (totalSales > 0 && totalSales >= context.topQuarterSales) {
      score += 12;
      reasons.push("جزو ۲۵٪ مشتریان با بیشترین خرید است");
    }
  }
  if (customer.priority === "vip") score += 15;
  else if (customer.priority === "high") score += 10;

  const kind: TargetKind = (["scheduled", "quote", "winback", "declining", "reorder"] as const).find((item) =>
    triggers.has(item),
  )!;

  return {
    customer,
    kind,
    score: Math.round(score),
    reasons,
    // The product about to run out is the best thing to name in the message.
    topProduct: timing?.product ?? signals.topProduct,
    note: signals.unpaidInvoice ? "طبق اطلاعات بانک یک فاکتور تسویه‌نشده دارد" : null,
  };
}

/** Sales thresholds for the top 10% and top 25% of customers. */
export function salesThresholds(customers: Array<Pick<TargetCustomer, "total_sales">>) {
  const values = customers.map((customer) => numeric(customer.total_sales)).filter((value) => value > 0);
  values.sort((a, b) => b - a);
  const at = (share: number) => values[Math.max(0, Math.ceil(values.length * share) - 1)] ?? Infinity;
  return { topTenSales: at(0.1), topQuarterSales: at(0.25) };
}

/** Recent vs previous six-month sales per customer from invoice rows. */
export function salesTrend(
  invoices: Array<{ customer_id: string; invoice_date: string; total_amount: number | string }>,
  now: Date,
) {
  const trend = new Map<string, { recentSales: number; previousSales: number }>();
  for (const invoice of invoices) {
    const age = (now.getTime() - Date.parse(invoice.invoice_date)) / DAY_MS;
    if (age < 0 || age >= TREND_WINDOW_DAYS * 2) continue;
    const entry = trend.get(invoice.customer_id) ?? { recentSales: 0, previousSales: 0 };
    if (age < TREND_WINDOW_DAYS) entry.recentSales += numeric(invoice.total_amount);
    else entry.previousSales += numeric(invoice.total_amount);
    trend.set(invoice.customer_id, entry);
  }
  return trend;
}

/** Earliest date of invoices salesTrend needs. */
export function trendSince(now: Date) {
  return new Date(now.getTime() - TREND_WINDOW_DAYS * 2 * DAY_MS).toISOString().slice(0, 10);
}

/** Customer's most often bought product (ties: the most recent). */
export function topProducts(
  rows: Array<{ customer_id: string; product_name: string; invoice_count: number | string; last_purchase_at: string | null }>,
) {
  const best = new Map<string, { name: string; count: number; last: string }>();
  for (const row of rows) {
    const name = String(row.product_name ?? "").replace(/\s+/g, " ").trim();
    if (!name || isServiceLine(name)) continue;
    const count = numeric(row.invoice_count);
    const last = row.last_purchase_at ?? "";
    const current = best.get(row.customer_id);
    if (!current || count > current.count || (count === current.count && last > current.last)) {
      best.set(row.customer_id, { name, count, last });
    }
  }
  return new Map([...best].map(([id, entry]) => [id, entry.name]));
}

export function rankSmsTargets(
  targets: Array<SmsTarget | null>,
  limit = DAILY_SMS_TARGETS,
  phoneKey: (phone: string | null) => string | null = () => null,
) {
  // One mobile shared by two customer records gets one message: the
  // higher-ranked record keeps it.
  const seen = new Set<string>();
  return targets
    .filter((target): target is SmsTarget => Boolean(target))
    .sort((a, b) => b.score - a.score || numeric(b.customer.total_sales) - numeric(a.customer.total_sales))
    .filter((target) => {
      const key = phoneKey(target.customer.phone);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** Short product name that fits a sentence. */
function productPhrase(product: string | null) {
  if (!product) return "لوازم مصرفی فیزیوتراپی";
  const name = persianLetters(product);
  return name.length > 40 ? `${name.slice(0, 38)}…` : name;
}

/**
 * Draft for the public (5000) line. {contact} is replaced on the page with
 * the company number; the opt-out line is added by the send route.
 */
export function draftSmsText(kind: TargetKind, name: string, product: string | null) {
  const who = `${persianLetters(name).replace(/\s+/g, " ").trim()} گرامی`;
  const item = productPhrase(product);
  const texts: Record<TargetKind, string> = {
    reorder: `${who}، بر اساس سفارش‌های قبلی، زمان تهیه مجدد ${item} شما فرا رسیده است. برای ثبت سفارش و قیمت روز با {contact} تماس بگیرید.`,
    winback: `${who}، مدتی است از امیدمد سفارشی نداشته‌اید. اگر به ${item} یا سایر لوازم مصرفی فیزیوتراپی نیاز دارید، برای قیمت روز با {contact} تماس بگیرید.`,
    declining: `${who}، از همراهی شما با امیدمد سپاسگزاریم. برای تهیه ${item} و اطلاع از قیمت روز محصولات با {contact} در تماس باشید.`,
    quote: `${who}، اگر درباره قیمتی که اعلام شد سؤالی دارید یا آماده ثبت سفارش هستید، با {contact} تماس بگیرید.`,
    scheduled: `${who}، برای تهیه ${item} و سایر لوازم مصرفی فیزیوتراپی در خدمت شما هستیم. شماره تماس: {contact}`,
  };
  return `${texts[kind]}\nomidmed.com`;
}
