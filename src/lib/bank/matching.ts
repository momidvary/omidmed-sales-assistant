// Suggests which customer and invoices a bank deposit pays for, and which
// category a withdrawal belongs to. Pure functions: the page loads the data,
// these only rank it. A suggestion is never applied to an invoice without the
// user confirming it, because settling an invoice changes which customers
// get payment reminders.

import { normalizeHoloBalance } from "@/lib/finance/metrics";
import { normalizeSearchText } from "@/lib/search/normalize";

export type RuleMatchType = "card" | "name";

export type CounterpartyRule = {
  kind: "deposit" | "withdrawal";
  match_type: RuleMatchType;
  match_value: string;
  category: string | null;
  customer_id: string | null;
};

export type OpenInvoice = {
  id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  /** Already paid by confirmed deposits (toman). */
  paid_amount?: number;
};

/** What is still owed on an invoice after earlier deposits. */
export function invoiceDue(invoice: OpenInvoice) {
  return Math.max(0, invoice.total_amount - (invoice.paid_amount ?? 0));
}

export type MatchCustomer = { id: string; name: string; contact_name?: string | null };

export type DepositSuggestion = {
  customerId: string;
  invoiceIds: string[];
  score: number;
  reasons: string[];
};

/** Name as compared and stored in rules: no brackets, unified letters. */
export function normalizeCounterpartyName(value: string | null | undefined) {
  return normalizeSearchText(String(value ?? "").replace(/\([^)]*\)/g, " "))
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keys a transaction can be recognised by next time, most specific first. */
export function ruleKeys(tx: { counterparty_card: string | null; counterparty_name: string | null }) {
  const keys: Array<{ match_type: RuleMatchType; match_value: string }> = [];
  if (tx.counterparty_card && /^\d{16}$/.test(tx.counterparty_card)) {
    keys.push({ match_type: "card", match_value: tx.counterparty_card });
  }
  const name = normalizeCounterpartyName(tx.counterparty_name);
  if (name.length >= 2) keys.push({ match_type: "name", match_value: name.slice(0, 120) });
  return keys;
}

export function findRule(
  rules: CounterpartyRule[],
  tx: { kind: "deposit" | "withdrawal"; counterparty_card: string | null; counterparty_name: string | null },
) {
  for (const key of ruleKeys(tx)) {
    const rule = rules.find(
      (item) => item.kind === tx.kind && item.match_type === key.match_type && item.match_value === key.match_value,
    );
    if (rule) return rule;
  }
  return null;
}

/**
 * Category to apply on import. Only withdrawals are categorised
 * automatically; a deposit's customer always needs confirmation.
 */
export function autoCategory(
  rules: CounterpartyRule[],
  tx: {
    kind: "deposit" | "withdrawal";
    is_fee: boolean;
    counterparty_card: string | null;
    counterparty_name: string | null;
  },
): { category: string; source: "fee" | "rule" } | null {
  if (tx.kind !== "withdrawal") return null;
  if (tx.is_fee) return { category: "bank_fee", source: "fee" };
  const rule = findRule(rules, tx);
  return rule?.category ? { category: rule.category, source: "rule" } : null;
}

/** Share of the shorter name's words found in the other name (0..1). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined) {
  const wordsA = normalizeCounterpartyName(a).split(" ").filter((word) => word.length > 1);
  const wordsB = normalizeCounterpartyName(b).split(" ").filter((word) => word.length > 1);
  if (!wordsA.length || !wordsB.length) return 0;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const pool = new Set(longer);
  return shorter.filter((word) => pool.has(word)).length / shorter.length;
}

/** Bank amounts are rial; Holoo invoices are toman. */
export function rialToToman(rial: number) {
  return rial / 10;
}

/** Smallest set of invoices (up to 4) whose totals add up to exactly `amount`. */
export function invoicesSummingTo(invoices: OpenInvoice[], amount: number) {
  const candidates = invoices.filter((invoice) => invoiceDue(invoice) > 0 && invoiceDue(invoice) <= amount).slice(0, 25);
  for (let size = 1; size <= Math.min(4, candidates.length); size += 1) {
    const found = searchSubset(candidates, amount, size, 0, []);
    if (found) return found;
  }
  return null;
}

function searchSubset(
  invoices: OpenInvoice[],
  remaining: number,
  size: number,
  start: number,
  chosen: OpenInvoice[],
): OpenInvoice[] | null {
  if (chosen.length === size) return remaining === 0 ? chosen : null;
  for (let index = start; index < invoices.length; index += 1) {
    const invoice = invoices[index];
    if (invoiceDue(invoice) > remaining) continue;
    const found = searchSubset(invoices, remaining - invoiceDue(invoice), size, index + 1, [...chosen, invoice]);
    if (found) return found;
  }
  return null;
}

const DAY_MS = 86_400_000;

export function suggestDepositMatches(input: {
  deposit: {
    amount_rial: number;
    tx_date: string;
    counterparty_card: string | null;
    counterparty_name: string | null;
  };
  customers: MatchCustomer[];
  rules: CounterpartyRule[];
  openInvoices: OpenInvoice[];
  /** Invoices older than this many days before the deposit are not suggested. */
  windowDays?: number;
}): DepositSuggestion[] {
  const { deposit, customers, rules } = input;
  const amount = rialToToman(deposit.amount_rial);
  const depositTime = Date.parse(deposit.tx_date);
  const windowDays = input.windowDays ?? 120;
  const invoices = input.openInvoices.filter((invoice) => {
    const time = Date.parse(invoice.invoice_date);
    // An invoice can be issued a few days after the money arrives.
    return time <= depositTime + 7 * DAY_MS && time >= depositTime - windowDays * DAY_MS;
  });

  const scores = new Map<string, { score: number; reasons: string[] }>();
  const add = (customerId: string, score: number, reason: string) => {
    const entry = scores.get(customerId) ?? { score: 0, reasons: [] };
    entry.score += score;
    entry.reasons.push(reason);
    scores.set(customerId, entry);
  };

  const rule = findRule(rules, { kind: "deposit", ...deposit });
  if (rule?.customer_id) {
    add(
      rule.customer_id,
      rule.match_type === "card" ? 100 : 80,
      rule.match_type === "card" ? "این کارت قبلاً برای همین مشتری تأیید شده" : "این نام قبلاً برای همین مشتری تأیید شده",
    );
  }

  if (deposit.counterparty_name) {
    for (const customer of customers) {
      const similarity = Math.max(
        nameSimilarity(deposit.counterparty_name, customer.name),
        nameSimilarity(deposit.counterparty_name, customer.contact_name),
      );
      if (similarity >= 0.5) add(customer.id, Math.round(40 * similarity), "نام واریزکننده شبیه نام مشتری است");
    }
  }

  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const invoice of invoices) {
    byCustomer.set(invoice.customer_id, [...(byCustomer.get(invoice.customer_id) ?? []), invoice]);
  }

  const invoiceIds = new Map<string, string[]>();
  if (Number.isInteger(amount) && amount > 0) {
    for (const [customerId, customerInvoices] of byCustomer) {
      // Exact amounts only: a near match is too easy to confirm by mistake.
      const subset = invoicesSummingTo(customerInvoices, amount);
      if (!subset) continue;
      invoiceIds.set(customerId, subset.map((invoice) => invoice.id));
      add(
        customerId,
        subset.length === 1 ? 50 : 40,
        subset.length === 1
          ? subset[0].paid_amount
            ? `مبلغ دقیقاً برابر مانده فاکتور ${subset[0].invoice_number} است`
            : `مبلغ دقیقاً برابر فاکتور ${subset[0].invoice_number} است`
          : `مبلغ برابر جمع فاکتورهای ${subset.map((invoice) => invoice.invoice_number).join("، ")} است`,
      );
    }

    // Part payment: for a customer already recognised by card or name, the
    // oldest invoice the deposit does not fully cover (e.g. 15m of a 22m).
    for (const customerId of scores.keys()) {
      if (invoiceIds.has(customerId)) continue;
      const partial = (byCustomer.get(customerId) ?? [])
        .filter((invoice) => invoiceDue(invoice) > amount)
        .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))[0];
      if (!partial) continue;
      invoiceIds.set(customerId, [partial.id]);
      add(customerId, 10, `بخشی از فاکتور ${partial.invoice_number} (پرداخت قسطی)`);
    }
  }

  return [...scores.entries()]
    .map(([customerId, entry]) => ({
      customerId,
      invoiceIds: invoiceIds.get(customerId) ?? [],
      score: entry.score,
      reasons: entry.reasons,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Invoice already paid according to Holoo's own cash/card/cheque fields. */
export function paidInHoloo(invoice: {
  total_amount: number | string | null;
  cash_amount?: number | string | null;
  card_amount?: number | string | null;
  check_amount?: number | string | null;
}) {
  const total = Number(invoice.total_amount ?? 0);
  const paid =
    Number(invoice.cash_amount ?? 0) + Number(invoice.card_amount ?? 0) + Number(invoice.check_amount ?? 0);
  return total > 0 && paid >= total;
}

export type SettlementState = "settled" | "paid_in_holoo" | "customer_clear" | "open";

/**
 * Whether a payment reminder may be sent for an invoice. Holoo often misses
 * payments, so "open" only means no evidence of payment was found; the user
 * still decides. Any evidence of payment blocks the reminder.
 */
export function settlementState(input: {
  invoice: {
    settled_at: string | null;
    total_amount: number | string | null;
    cash_amount?: number | string | null;
    card_amount?: number | string | null;
    check_amount?: number | string | null;
  };
  customerBalance?: { status: string | null; amount: number | string | null } | null;
}): SettlementState {
  if (input.invoice.settled_at) return "settled";
  if (paidInHoloo(input.invoice)) return "paid_in_holoo";
  if (input.customerBalance) {
    const { status } = normalizeHoloBalance(input.customerBalance);
    if (status === "zero" || status === "creditor") return "customer_clear";
  }
  return "open";
}

export const SETTLEMENT_LABELS: Record<SettlementState, string> = {
  settled: "تسویه شده",
  paid_in_holoo: "در هلو پرداخت ثبت شده",
  customer_clear: "حساب مشتری در هلو بدهکار نیست",
  open: "پرداختی پیدا نشد",
};
