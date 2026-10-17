import assert from "node:assert/strict";
import test from "node:test";

import {
  dueBucket,
  normalizeHoloBalance,
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

test("due dates have distinct Tehran today, overdue and future buckets", () => {
  const now = new Date("2026-08-08T10:00:00+03:30");
  assert.equal(dueBucket("2026-08-08T01:00:00+03:30", now), "today");
  assert.equal(dueBucket("2026-08-07T23:59:00+03:30", now), "overdue");
  assert.equal(dueBucket("2026-08-09T00:01:00+03:30", now), "future");
  assert.equal(dueBucket(null, now), "unscheduled");
});
