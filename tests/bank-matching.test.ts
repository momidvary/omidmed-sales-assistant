import assert from "node:assert/strict";
import test from "node:test";

import { BANK_CATEGORIES, isValidCategory } from "../src/lib/bank/categories";
import {
  autoCategory,
  invoicesSummingTo,
  nameSimilarity,
  normalizeCounterpartyName,
  ruleKeys,
  settlementState,
  suggestDepositMatches,
  type CounterpartyRule,
  type OpenInvoice,
} from "../src/lib/bank/matching";

const invoices: OpenInvoice[] = [
  { id: "i1", customer_id: "c1", invoice_number: "101", invoice_date: "2026-10-10", total_amount: 560_000 },
  { id: "i2", customer_id: "c2", invoice_number: "102", invoice_date: "2026-10-12", total_amount: 300_000 },
  { id: "i3", customer_id: "c2", invoice_number: "103", invoice_date: "2026-10-13", total_amount: 260_000 },
  { id: "i4", customer_id: "c3", invoice_number: "90", invoice_date: "2026-01-01", total_amount: 560_000 },
];
const customers = [
  { id: "c1", name: "کلینیک فیزیوتراپی نمونه", contact_name: "نسرین صالحی" },
  { id: "c2", name: "مرکز توانبخشی آلفا" },
  { id: "c3", name: "فیزیوتراپی قدیمی" },
];

test("names compare without brackets and Arabic letter variants", () => {
  assert.equal(normalizeCounterpartyName("علي  كريمي (علي كريمي)"), "علی کریمی");
  assert.equal(nameSimilarity("نسرين صالحي", "نسرین صالحی"), 1);
  assert.equal(nameSimilarity("رضا", "نسرین صالحی"), 0);
});

test("a card is a stronger rule key than a name", () => {
  assert.deepEqual(ruleKeys({ counterparty_card: "6219860000000002", counterparty_name: "تامین کننده" }), [
    { match_type: "card", match_value: "6219860000000002" },
    { match_type: "name", match_value: "تامین کننده" },
  ]);
});

test("withdrawals are categorised by fee or learned rule; deposits never automatically", () => {
  const rules: CounterpartyRule[] = [
    { kind: "withdrawal", match_type: "card", match_value: "6219860000000002", category: "workshop_materials", customer_id: null },
    { kind: "deposit", match_type: "name", match_value: "مشتری", category: "customer_payment", customer_id: "c1" },
  ];
  assert.deepEqual(
    autoCategory(rules, { kind: "withdrawal", is_fee: true, counterparty_card: null, counterparty_name: null }),
    { category: "bank_fee", source: "fee" },
  );
  assert.deepEqual(
    autoCategory(rules, { kind: "withdrawal", is_fee: false, counterparty_card: "6219860000000002", counterparty_name: "x" }),
    { category: "workshop_materials", source: "rule" },
  );
  assert.equal(
    autoCategory(rules, { kind: "deposit", is_fee: false, counterparty_card: null, counterparty_name: "مشتری" }),
    null,
  );
});

test("finds the exact invoice combination a payment covers", () => {
  assert.deepEqual(invoicesSummingTo(invoices.slice(1, 3), 560_000)?.map((i) => i.id), ["i2", "i3"]);
  assert.equal(invoicesSummingTo(invoices.slice(1, 3), 559_000), null);
});

test("deposit suggestions combine learned card, name and exact amount (rial to toman)", () => {
  const suggestions = suggestDepositMatches({
    deposit: { amount_rial: 5_600_000, tx_date: "2026-10-16", counterparty_card: null, counterparty_name: "نسرين صالحي" },
    customers,
    rules: [],
    openInvoices: invoices,
  });
  assert.equal(suggestions[0].customerId, "c1", "name + exact invoice amount wins");
  assert.deepEqual(suggestions[0].invoiceIds, ["i1"]);
  assert.equal(suggestions[1].customerId, "c2");
  assert.deepEqual(suggestions[1].invoiceIds, ["i2", "i3"]);
  assert.ok(!suggestions.some((s) => s.customerId === "c3"), "invoices far before the deposit are not suggested");

  const learned = suggestDepositMatches({
    deposit: { amount_rial: 1_234_560, tx_date: "2026-10-16", counterparty_card: "5041720000000001", counterparty_name: null },
    customers,
    rules: [{ kind: "deposit", match_type: "card", match_value: "5041720000000001", category: null, customer_id: "c2" }],
    openInvoices: invoices,
  });
  assert.equal(learned[0].customerId, "c2");
  assert.deepEqual(learned[0].invoiceIds, ["i2"], "a smaller amount is proposed as part of the oldest invoice");
});

test("any evidence of payment blocks the payment reminder", () => {
  const invoice = { settled_at: null, total_amount: 500_000, cash_amount: 0, card_amount: 0, check_amount: 0 };
  assert.equal(settlementState({ invoice }), "open");
  assert.equal(settlementState({ invoice: { ...invoice, settled_at: "2026-10-16T10:00:00Z" } }), "settled");
  assert.equal(settlementState({ invoice: { ...invoice, card_amount: 500_000 } }), "paid_in_holoo");
  assert.equal(
    settlementState({ invoice, customerBalance: { status: "creditor", amount: 1000 } }),
    "customer_clear",
  );
  assert.equal(settlementState({ invoice, customerBalance: { status: "debtor", amount: 0 } }), "customer_clear");
  assert.equal(settlementState({ invoice, customerBalance: { status: "unknown", amount: 0 } }), "open");
});

test("category keys fit the database check and belong to one kind", () => {
  for (const category of BANK_CATEGORIES) {
    assert.match(category.key, /^[a-z_]{2,40}$/);
    assert.ok(isValidCategory(category.key, category.kind));
  }
  assert.equal(new Set(BANK_CATEGORIES.map((c) => c.key)).size, BANK_CATEGORIES.length);
  assert.ok(!isValidCategory("bank_fee", "deposit"));
});

test("part payments: the first instalment points at the invoice, the last one matches what is left", () => {
  const invoice: OpenInvoice = {
    id: "big",
    customer_id: "c1",
    invoice_number: "500",
    invoice_date: "2026-10-10",
    total_amount: 22_000_000,
  };
  const first = suggestDepositMatches({
    deposit: { amount_rial: 150_000_000, tx_date: "2026-10-16", counterparty_card: null, counterparty_name: "نسرین صالحی" },
    customers,
    rules: [],
    openInvoices: [invoice],
  });
  assert.equal(first[0].customerId, "c1");
  assert.deepEqual(first[0].invoiceIds, ["big"]);
  assert.ok(first[0].reasons.some((reason) => reason.includes("قسطی")));

  // Amount alone never proposes a part payment for an unrecognised payer.
  const unknown = suggestDepositMatches({
    deposit: { amount_rial: 150_000_000, tx_date: "2026-10-16", counterparty_card: null, counterparty_name: null },
    customers,
    rules: [],
    openInvoices: [invoice],
  });
  assert.equal(unknown.length, 0);

  const second = suggestDepositMatches({
    deposit: { amount_rial: 70_000_000, tx_date: "2026-10-17", counterparty_card: null, counterparty_name: null },
    customers,
    rules: [],
    openInvoices: [{ ...invoice, paid_amount: 15_000_000 }],
  });
  assert.equal(second[0].customerId, "c1");
  assert.deepEqual(second[0].invoiceIds, ["big"]);
  assert.match(second[0].reasons[0], /مانده فاکتور 500/);
});
