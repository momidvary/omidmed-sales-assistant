import assert from "node:assert/strict";
import test from "node:test";

import {
  actualInvoicedSales,
  confirmedManufacturingExpense,
  dueBucket,
  normalizeHoloBalance,
  payrollTotals,
  purchaseBalance,
} from "../src/lib/finance/metrics";

test("customer balance uses Holoo status without summing invoice balances", () => {
  assert.deepEqual(normalizeHoloBalance({ amount: "125000", status: "debtor" }), {
    amount: 125000,
    status: "debtor",
    signedAmount: 125000,
  });
  assert.equal(
    normalizeHoloBalance({ amount: 90000, status: "creditor" }).signedAmount,
    -90000,
  );
  assert.equal(normalizeHoloBalance({ amount: 0, status: "debtor" }).status, "zero");
  assert.equal(normalizeHoloBalance({ amount: 0, status: "zero" }).status, "zero");
  assert.equal(normalizeHoloBalance({ amount: null, status: null }).status, "unknown");
});

test("actual sales exclude soft-deleted invoices", () => {
  assert.equal(
    actualInvoicedSales([
      { total_amount: 1_000_000, holo_is_deleted: false },
      { total_amount: 500_000, holo_is_deleted: true },
      { total_amount: 250_000, holo_is_deleted: null },
    ]),
    1_250_000,
  );
});

test("partial purchase invoices expose only their outstanding amount", () => {
  assert.deepEqual(
    purchaseBalance({ total: 1_000_000, openingPaid: 250_000, payments: [100_000] }),
    { total: 1_000_000, paid: 350_000, outstanding: 650_000, status: "partial" },
  );
});

test("advance affects paid and remaining, never labor cost", () => {
  assert.deepEqual(
    payrollTotals({
      baseSalary: 10_000_000,
      overtime: 1_000_000,
      allowance: 500_000,
      deductions: 500_000,
      advance: 2_000_000,
      paid: 3_000_000,
      employerCosts: 1_500_000,
    }),
    {
      gross: 11_500_000,
      deductions: 500_000,
      net: 11_000_000,
      paid: 5_000_000,
      remaining: 6_000_000,
      laborCost: 13_000_000,
      status: "partial",
    },
  );
});

test("due dates have distinct Tehran today, overdue and future buckets", () => {
  const now = new Date("2026-08-08T10:00:00+03:30");
  assert.equal(dueBucket("2026-08-08T01:00:00+03:30", now), "today");
  assert.equal(dueBucket("2026-08-07T23:59:00+03:30", now), "overdue");
  assert.equal(dueBucket("2026-08-09T00:01:00+03:30", now), "future");
  assert.equal(dueBucket(null, now), "unscheduled");
});

test("unconfirmed expenses never enter manufacturing overhead", () => {
  assert.equal(
    confirmedManufacturingExpense({
      classification_status: "suggested",
      expense_scope: "manufacturing",
    }),
    false,
  );
  assert.equal(
    confirmedManufacturingExpense({
      classification_status: "confirmed",
      expense_scope: "manufacturing",
    }),
    true,
  );
});
