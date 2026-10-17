// Shared financial helpers.
//
// Scope rule: a helper lives here only when real UI/API code calls it. Amounts
// that a SQL view already derives (actual invoiced sales, purchase outstanding
// balance, manufacturing expense scope) are deliberately NOT reimplemented in
// TypeScript — a second copy can silently drift from the view that production
// actually reads. Those contracts are covered by tests/financial-sql.test.ts.

export type NumericValue = number | string | null | undefined;

export function numeric(value: NumericValue) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type HoloBalanceStatus = "debtor" | "creditor" | "zero" | "unknown";

export function normalizeHoloBalance(input: {
  amount: NumericValue;
  status: string | null | undefined;
}) {
  const amount = Math.max(0, numeric(input.amount));
  const status: HoloBalanceStatus =
    input.status === "debtor" ||
    input.status === "creditor" ||
    input.status === "zero"
      ? input.status
      : "unknown";

  return {
    amount,
    status: amount === 0 && status !== "unknown" ? "zero" : status,
    signedAmount:
      status === "debtor" ? amount : status === "creditor" ? -amount : 0,
  } as const;
}

export type DueBucket = "today" | "overdue" | "future" | "unscheduled";

export function tehranDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dueBucket(
  value: string | null | undefined,
  now: Date,
): DueBucket {
  if (!value) return "unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unscheduled";
  const currentKey = tehranDateKey(now);
  const valueKey = tehranDateKey(date);
  if (valueKey === currentKey) return "today";
  return valueKey < currentKey ? "overdue" : "future";
}
