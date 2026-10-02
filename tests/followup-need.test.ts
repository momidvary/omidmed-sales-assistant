import assert from "node:assert/strict";
import test from "node:test";

import { classifyFollowupNeed } from "../src/lib/sales/followup-need";

const now = new Date("2026-10-02T09:00:00+03:30");
const base = {
  status: "active",
  next_followup_at: null,
  purchase_count: 4,
  avg_purchase_gap_days: 30,
  days_since_last_purchase: 10,
};

test("repeat buyer past their usual gap needs follow-up", () => {
  assert.equal(classifyFollowupNeed({ ...base, days_since_last_purchase: 31 }, null, now).needsFollowup, true);
  assert.equal(classifyFollowupNeed({ ...base, days_since_last_purchase: 20 }, null, now).needsFollowup, false);
});

test("single-purchase customer is due after 60 days", () => {
  const single = { ...base, purchase_count: 1, avg_purchase_gap_days: null };
  assert.equal(classifyFollowupNeed({ ...single, days_since_last_purchase: 59 }, null, now).needsFollowup, false);
  assert.equal(classifyFollowupNeed({ ...single, days_since_last_purchase: 60 }, null, now).needsFollowup, true);
});

test("a scheduled date wins over the purchase cycle", () => {
  const overdueCycle = { ...base, days_since_last_purchase: 200 };
  assert.equal(
    classifyFollowupNeed({ ...overdueCycle, next_followup_at: "2026-10-20T10:00:00+03:30" }, null, now).needsFollowup,
    false,
  );
  assert.equal(
    classifyFollowupNeed({ ...base, next_followup_at: "2026-09-28T10:00:00+03:30" }, null, now).needsFollowup,
    true,
  );
});

test("a recent call hides the customer for a week", () => {
  const due = { ...base, days_since_last_purchase: 90 };
  assert.equal(classifyFollowupNeed(due, "2026-09-30T10:00:00+03:30", now).needsFollowup, false);
  assert.equal(classifyFollowupNeed(due, "2026-09-20T10:00:00+03:30", now).needsFollowup, true);
});

test("customers without invoices and lost customers do not need follow-up", () => {
  assert.equal(classifyFollowupNeed({ ...base, purchase_count: 0, days_since_last_purchase: null }, null, now).needsFollowup, false);
  assert.equal(classifyFollowupNeed({ ...base, status: "lost", days_since_last_purchase: 300 }, null, now).needsFollowup, false);
});
