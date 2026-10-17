import { settlementState, type OpenInvoice, type SettlementState } from "@/lib/bank/matching";

import { readAll, type Supabase } from "./shared";

export type InvoiceRow = {
  id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number | string;
  cash_amount: number | string | null;
  card_amount: number | string | null;
  check_amount: number | string | null;
  settled_at: string | null;
};

export type InvoiceCustomer = {
  id: string;
  name: string;
  phone: string | null;
  holo_balance_amount: number | string | null;
  holo_balance_status: string | null;
};

export async function customersByIds(supabase: Supabase, ids: string[]) {
  const map = new Map<string, InvoiceCustomer>();
  for (let index = 0; index < ids.length; index += 300) {
    const { data } = await supabase
      .from("customers")
      .select("id,name,phone,holo_balance_amount,holo_balance_status")
      .in("id", ids.slice(index, index + 300));
    for (const row of (data ?? []) as InvoiceCustomer[]) map.set(row.id, row);
  }
  return map;
}

/**
 * Invoices with no evidence of payment, limited to the period the bank
 * statements cover: before the first imported day a payment cannot be
 * checked, and Holoo is known to miss many of them.
 */
export async function loadUnsettledInvoices(supabase: Supabase) {
  const { data: first } = await supabase
    .from("bank_transactions")
    .select("tx_date")
    .order("tx_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!first) return null;
  const since = first.tx_date as string;

  const [invoices, older] = await Promise.all([
    readAll<InvoiceRow>((from, to) =>
      supabase
        .from("invoices")
        .select("id,customer_id,invoice_number,invoice_date,total_amount,cash_amount,card_amount,check_amount,settled_at")
        .is("settled_at", null)
        .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
        .gt("total_amount", 0)
        .gte("invoice_date", since)
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .is("settled_at", null)
      .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
      .gt("total_amount", 0)
      .lt("invoice_date", since),
  ]);

  const customers = await customersByIds(supabase, [...new Set(invoices.rows.map((row) => row.customer_id))]);
  const excluded: Record<Exclude<SettlementState, "open" | "settled">, number> = {
    paid_in_holoo: 0,
    customer_clear: 0,
  };
  const open: Array<InvoiceRow & { customer: InvoiceCustomer | null }> = [];
  for (const invoice of invoices.rows) {
    const customer = customers.get(invoice.customer_id) ?? null;
    const state = settlementState({
      invoice,
      customerBalance: customer
        ? { status: customer.holo_balance_status, amount: customer.holo_balance_amount }
        : null,
    });
    if (state === "open") open.push({ ...invoice, customer });
    else if (state !== "settled") excluded[state] += 1;
  }

  return { since, open, excluded, olderCount: older.count ?? 0, error: invoices.error };
}

/** Open invoices as the matcher wants them. */
export function asOpenInvoices(rows: InvoiceRow[]): OpenInvoice[] {
  return rows.map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    total_amount: Number(row.total_amount),
  }));
}

/**
 * Invoices a deposit may pay for: anything not yet settled from `since` on,
 * including invoices before the bank-data window (a payment often arrives
 * days after the invoice) and invoices Holoo shows as paid.
 */
export async function loadMatchableInvoices(supabase: Supabase, since: string) {
  const result = await readAll<InvoiceRow>((from, to) =>
    supabase
      .from("invoices")
      .select("id,customer_id,invoice_number,invoice_date,total_amount,cash_amount,card_amount,check_amount,settled_at")
      .is("settled_at", null)
      .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
      .gt("total_amount", 0)
      .gte("invoice_date", since)
      .order("invoice_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return asOpenInvoices(result.rows);
}
