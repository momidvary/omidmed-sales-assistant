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

export type InvoiceForSales = {
  total_amount: NumericValue;
  holo_is_deleted?: boolean | null;
};

export function actualInvoicedSales(invoices: InvoiceForSales[]) {
  return invoices.reduce(
    (total, invoice) =>
      invoice.holo_is_deleted === true
        ? total
        : total + Math.max(0, numeric(invoice.total_amount)),
    0,
  );
}

export function purchaseBalance(input: {
  total: NumericValue;
  openingPaid?: NumericValue;
  payments?: NumericValue[];
}) {
  const total = Math.max(0, numeric(input.total));
  const paid = Math.min(
    total,
    Math.max(
      0,
      numeric(input.openingPaid) +
        (input.payments ?? []).reduce<number>(
          (sum, amount) => sum + numeric(amount),
          0,
        ),
    ),
  );
  const outstanding = Math.max(0, total - paid);
  const status = paid <= 0 ? "unpaid" : outstanding <= 0 ? "paid" : "partial";
  return { total, paid, outstanding, status } as const;
}

export function payrollTotals(input: {
  baseSalary: NumericValue;
  overtime?: NumericValue;
  bonus?: NumericValue;
  allowance?: NumericValue;
  deductions?: NumericValue;
  advance?: NumericValue;
  paid?: NumericValue;
  employerCosts?: NumericValue;
}) {
  const gross = Math.max(
    0,
    numeric(input.baseSalary) +
      numeric(input.overtime) +
      numeric(input.bonus) +
      numeric(input.allowance),
  );
  const deductions = Math.max(0, numeric(input.deductions));
  const net = Math.max(0, gross - deductions);
  const paid = Math.min(
    net,
    Math.max(0, numeric(input.advance) + numeric(input.paid)),
  );
  return {
    gross,
    deductions,
    net,
    paid,
    remaining: Math.max(0, net - paid),
    laborCost: gross + Math.max(0, numeric(input.employerCosts)),
    status: paid <= 0 ? "unpaid" : paid >= net ? "paid" : "partial",
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

export function confirmedManufacturingExpense<T extends {
  classification_status?: string | null;
  expense_scope?: string | null;
}>(expense: T) {
  return (
    expense.classification_status === "confirmed" &&
    expense.expense_scope === "manufacturing"
  );
}
