export type CustomerForFollowup = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  priority: string;
  next_followup_at: string | null;
  last_purchase_at: string | null;
  purchase_count: number | string | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | string | null;
};

export type FollowupForScoring = {
  customer_id: string;
  followup_at: string;
  outcome: string;
  next_followup_at: string | null;
  notes: string | null;
};

export type FollowupCandidate = CustomerForFollowup & {
  score: number;
  reasons: string[];
  isScheduled: boolean;
  isOverdue: boolean;
  isPurchaseDue: boolean;
  isRequestedPrice: boolean;
  isPriorityCustomer: boolean;
  hasReliablePurchaseCycle: boolean;
  purchaseCount: number;
  overdueDays: number;
  cycleRatio: number | null;
  latestFollowup: FollowupForScoring | null;
};

const DAY_MS = 86_400_000;
const MIN_PURCHASES_FOR_CYCLE = 2;

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tehranDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function tehranStartOfDay(date: Date) {
  const key = tehranDateKey(date);
  return new Date(`${key}T00:00:00+03:30`);
}

function tehranEndOfDay(date: Date) {
  const key = tehranDateKey(date);
  return new Date(`${key}T23:59:59.999+03:30`);
}

function isAfterLatestPurchase(
  followupAt: string,
  lastPurchaseAt: string | null,
) {
  if (!lastPurchaseAt) return true;
  const followupTime = new Date(followupAt).getTime();
  const purchaseTime = new Date(`${lastPurchaseAt}T23:59:59+03:30`).getTime();
  return followupTime > purchaseTime;
}

export function buildFollowupCandidates({
  customers,
  followups,
  now = new Date(),
}: {
  customers: CustomerForFollowup[];
  followups: FollowupForScoring[];
  now?: Date;
}) {
  const latestFollowups = new Map<string, FollowupForScoring>();
  for (const followup of followups) {
    if (!latestFollowups.has(followup.customer_id)) {
      latestFollowups.set(followup.customer_id, followup);
    }
  }

  const todayStart = tehranStartOfDay(now);
  const todayEnd = tehranEndOfDay(now);
  const salesValues = customers
    .map((customer) => numeric(customer.total_sales))
    .sort((a, b) => b - a);
  const topTenThreshold =
    salesValues[Math.max(0, Math.floor(salesValues.length * 0.1) - 1)] ?? 0;
  const topQuarterThreshold =
    salesValues[Math.max(0, Math.floor(salesValues.length * 0.25) - 1)] ?? 0;

  return customers
    .filter((customer) => customer.status !== "lost")
    .map<FollowupCandidate>((customer) => {
      const reasons: string[] = [];
      const latestFollowup = latestFollowups.get(customer.id) ?? null;
      const nextFollowup = customer.next_followup_at
        ? new Date(customer.next_followup_at)
        : null;
      const isScheduled = Boolean(
        nextFollowup && nextFollowup.getTime() <= todayEnd.getTime(),
      );
      const isOverdue = Boolean(
        nextFollowup && nextFollowup.getTime() < todayStart.getTime(),
      );
      const overdueDays =
        isOverdue && nextFollowup
          ? Math.max(
              1,
              Math.floor(
                (todayStart.getTime() - nextFollowup.getTime()) / DAY_MS,
              ),
            )
          : 0;

      const purchaseCount = Math.max(
        0,
        Math.round(numeric(customer.purchase_count)),
      );
      const averageGap = numeric(customer.avg_purchase_gap_days);
      const daysSinceLastPurchase = numeric(customer.days_since_last_purchase);
      const hasReliablePurchaseCycle =
        purchaseCount >= MIN_PURCHASES_FOR_CYCLE && averageGap >= 7;
      const cycleRatio = hasReliablePurchaseCycle
        ? daysSinceLastPurchase / averageGap
        : null;
      const isPurchaseDue = Boolean(
        cycleRatio !== null &&
          daysSinceLastPurchase >= Math.max(7, averageGap * 0.85),
      );
      const isRequestedPrice = Boolean(
        latestFollowup?.outcome === "requested_price" &&
          isAfterLatestPurchase(
            latestFollowup.followup_at,
            customer.last_purchase_at,
          ),
      );
      const isPriorityCustomer =
        customer.priority === "vip" || customer.priority === "high";

      let score = 0;

      if (isOverdue) {
        score += 72 + Math.min(28, overdueDays * 2);
        reasons.push(`پیگیری ${overdueDays} روز عقب افتاده است`);
      } else if (isScheduled) {
        score += 68;
        reasons.push("زمان پیگیری تعیین‌شده امروز است");
      }

      if (customer.priority === "vip") {
        score += 24;
        reasons.push("ارزش تجاری مشتری ویژه است");
      } else if (customer.priority === "high") {
        score += 16;
        reasons.push("ارزش تجاری مشتری کلیدی است");
      } else if (customer.priority === "normal") {
        score += 5;
      }

      if (cycleRatio !== null) {
        if (cycleRatio >= 1.5) {
          score += 34;
          reasons.push("بیش از یک‌ونیم برابر چرخه معمول از خرید گذشته است");
        } else if (cycleRatio >= 1.15) {
          score += 28;
          reasons.push("از زمان معمول سفارش مجدد گذشته است");
        } else if (cycleRatio >= 1) {
          score += 22;
          reasons.push("به زمان معمول سفارش مجدد رسیده است");
        } else if (cycleRatio >= 0.85) {
          score += 12;
          reasons.push("به موعد خرید بعدی نزدیک است");
        }
      }

      if (isRequestedPrice) {
        score += 24;
        reasons.push("در آخرین تماس قیمت خواسته و خرید جدید ثبت نشده است");
      } else if (latestFollowup?.outcome === "payment_pending") {
        score += 18;
        reasons.push("پیگیری تسویه ثبت شده است");
      } else if (latestFollowup?.outcome === "no_answer") {
        score += 7;
        reasons.push("در تماس قبلی پاسخ نداده است");
      }

      const totalSales = numeric(customer.total_sales);
      if (totalSales > 0 && totalSales >= topTenThreshold) {
        score += 10;
        reasons.push("جزو مشتریان با خرید بالاست");
      } else if (totalSales > 0 && totalSales >= topQuarterThreshold) {
        score += 6;
      }

      if (!customer.phone) {
        score -= 20;
        reasons.push("شماره تماس نیاز به تکمیل دارد");
      }

      return {
        ...customer,
        score: Math.max(0, Math.round(score)),
        reasons: Array.from(new Set(reasons)).slice(0, 3),
        isScheduled,
        isOverdue,
        isPurchaseDue,
        isRequestedPrice,
        isPriorityCustomer,
        hasReliablePurchaseCycle,
        purchaseCount,
        overdueDays,
        cycleRatio,
        latestFollowup,
      };
    })
    .filter((customer) => {
      if (
        customer.isScheduled ||
        customer.isPurchaseDue ||
        customer.isRequestedPrice
      ) {
        return true;
      }

      // A manual customer-value label can strengthen a real purchase pattern,
      // but it must not turn a one-off or annual customer into a recurring priority.
      if (
        customer.isPriorityCustomer &&
        customer.hasReliablePurchaseCycle &&
        customer.purchaseCount >= MIN_PURCHASES_FOR_CYCLE
      ) {
        const averageGap = numeric(customer.avg_purchase_gap_days);
        const daysSinceLastPurchase = numeric(
          customer.days_since_last_purchase,
        );
        return (
          daysSinceLastPurchase >= Math.max(30, averageGap * 0.75)
        );
      }

      return false;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return numeric(b.total_sales) - numeric(a.total_sales);
    });
}

export function makeAutomaticNextFollowup(
  outcome: string,
  now = new Date(),
) {
  const delayByOutcome: Record<string, number | null> = {
    no_answer: 1,
    requested_price: 1,
    no_need: 30,
    order_placed: null,
  };

  const days = delayByOutcome[outcome];
  if (days === null || days === undefined) return null;

  const target = new Date(now.getTime() + days * DAY_MS);
  const dateKey = tehranDateKey(target);
  return `${dateKey}T10:00:00+03:30`;
}
