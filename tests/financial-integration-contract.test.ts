import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("dashboard uses Holoo customer balance instead of summing invoice account balances", () => {
  const dashboard = source("src/app/page.tsx");
  assert.match(dashboard, /holo_balance_(?:amount|status)|customer_debt/);
  assert.doesNotMatch(dashboard, /account_balance_amount/);
});

test("customer profile uses canonical Holoo balance fields", () => {
  const profile = source("src/app/customers/[id]/page.tsx");
  assert.match(profile, /holo_balance_amount/);
  assert.match(profile, /holo_balance_status/);
  assert.doesNotMatch(profile, /account_balance_amount/);
});

test("assistant context does not reconstruct customer debt from invoice balances", () => {
  const assistant = source("src/lib/assistant/context.ts");
  assert.match(assistant, /holo_balance_amount/);
  assert.match(assistant, /holo_balance_status/);
  assert.doesNotMatch(assistant, /account_balance_amount/);
});

test("sales and reports explicitly use live Holoo invoice semantics", () => {
  const sales = source("src/app/sales/page.tsx");
  const reports = source("src/lib/reports/data.ts");
  const combined = `${sales}\n${reports}`;
  assert.match(combined, /holo_is_deleted|owner_sales_daily/);
});
