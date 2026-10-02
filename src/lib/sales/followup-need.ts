// Splits customers into "needs follow-up" and "does not need follow-up" from
// their invoice history. One rule, shared by the Today page and the customer
// bank, so both always agree.

export type CustomerForNeed = {
  status: string;
  next_followup_at: string | null;
  purchase_count: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | string | null;
};

export type FollowupNeed = {
  needsFollowup: boolean;
  reason: string;
  /** Days past due (needs) or days until due (does not need); null when unknown. */
  days: number | null;
};

/** A customer with a single invoice is due again after this many days. */
export const SINGLE_PURCHASE_FOLLOWUP_DAYS = 60;
/** A call logged this recently counts as handled, even without a new invoice. */
export const RECENT_CONTACT_DAYS = 7;
/** Same-week repeat invoices should not produce a near-daily cycle. */
const MIN_CYCLE_DAYS = 7;
const DAY_MS = 86_400_000;

const persianNumber = new Intl.NumberFormat("fa-IR");
const persianDate = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeZone: "Asia/Tehran",
});

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tehranDayBounds(now: Date) {
  const key = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(now);
  return {
    start: new Date(`${key}T00:00:00+03:30`).getTime(),
    end: new Date(`${key}T23:59:59.999+03:30`).getTime(),
  };
}

export function purchaseCycleDays(customer: CustomerForNeed) {
  const purchaseCount = Math.round(numeric(customer.purchase_count));
  const averageGap = numeric(customer.avg_purchase_gap_days);
  if (purchaseCount >= 2 && averageGap > 0) {
    return Math.max(MIN_CYCLE_DAYS, Math.round(averageGap));
  }
  return SINGLE_PURCHASE_FOLLOWUP_DAYS;
}

export function classifyFollowupNeed(
  customer: CustomerForNeed,
  lastContactAt: string | null,
  now = new Date(),
): FollowupNeed {
  if (customer.status === "lost") {
    return { needsFollowup: false, reason: "از دست رفته ثبت شده است", days: null };
  }

  const { start, end } = tehranDayBounds(now);

  // A date the user chose always wins over the automatic rule.
  if (customer.next_followup_at) {
    const scheduled = new Date(customer.next_followup_at).getTime();
    if (scheduled <= end) {
      const overdueDays =
        scheduled < start ? Math.max(1, Math.ceil((start - scheduled) / DAY_MS)) : 0;
      return {
        needsFollowup: true,
        reason: overdueDays
          ? `${persianNumber.format(overdueDays)} روز از موعد پیگیری‌ای که تعیین کرده‌اید گذشته است`
          : "موعد پیگیری‌ای که تعیین کرده‌اید امروز است",
        days: overdueDays,
      };
    }
    return {
      needsFollowup: false,
      reason: `پیگیری بعدی برای ${persianDate.format(new Date(scheduled))} تنظیم شده است`,
      days: Math.ceil((scheduled - end) / DAY_MS),
    };
  }

  if (lastContactAt) {
    const daysAgo = Math.floor((now.getTime() - new Date(lastContactAt).getTime()) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < RECENT_CONTACT_DAYS) {
      return {
        needsFollowup: false,
        reason: daysAgo === 0
          ? "امروز پیگیری شده است"
          : `${persianNumber.format(daysAgo)} روز پیش پیگیری شده است`,
        days: RECENT_CONTACT_DAYS - daysAgo,
      };
    }
  }

  const purchaseCount = Math.round(numeric(customer.purchase_count));
  if (purchaseCount === 0 || customer.days_since_last_purchase == null) {
    return { needsFollowup: false, reason: "هنوز فاکتوری از هلو ثبت نشده است", days: null };
  }

  const daysSince = Math.round(numeric(customer.days_since_last_purchase));
  const cycle = purchaseCycleDays(customer);
  const cycleText =
    purchaseCount >= 2
      ? `معمولاً هر ${persianNumber.format(cycle)} روز خرید می‌کند`
      : "فقط یک خرید داشته است";

  if (daysSince >= cycle) {
    return {
      needsFollowup: true,
      reason: `${persianNumber.format(daysSince)} روز از آخرین خرید گذشته؛ ${cycleText}`,
      days: daysSince - cycle,
    };
  }

  return {
    needsFollowup: false,
    reason: `حدود ${persianNumber.format(cycle - daysSince)} روز دیگر موعد خرید بعدی است؛ ${cycleText}`,
    days: cycle - daysSince,
  };
}

/** Latest follow-up time per customer from rows in any order. */
export function latestContactByCustomer(
  followups: Array<{ customer_id: string; followup_at: string }>,
) {
  const latest = new Map<string, string>();
  for (const row of followups) {
    const current = latest.get(row.customer_id);
    if (!current || new Date(row.followup_at) > new Date(current)) {
      latest.set(row.customer_id, row.followup_at);
    }
  }
  return latest;
}
