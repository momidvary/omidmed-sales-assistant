import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportRange } from "./period";
import { toTimestampEnd, toTimestampStart } from "./period";

export type SaleRow = {
  id: string;
  customer_id: string;
  invoice_number: string | null;
  document_number: string | null;
  sale_date: string;
  amount: number | string;
  description: string | null;
};

export type CustomerSummaryRow = {
  id: string;
  name: string;
  phone: string | null;
  normalized_phone: string | null;
  city: string | null;
  address: string | null;
  status: string;
  priority: string;
  last_purchase_at: string | null;
  purchase_count: number | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | null;
  next_followup_at: string | null;
};

export type FollowupRow = {
  id: string;
  customer_id: string;
  followup_at: string;
  channel: string;
  outcome: string;
  notes: string | null;
  next_followup_at: string | null;
  potential_value: number | string | null;
};

export type InvoiceRow = {
  id: string;
  customer_id: string;
  invoice_number: string;
  document_number: string | null;
  invoice_date: string;
  total_amount: number | string;
};

export type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  product_name: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
};

const PAGE_SIZE = 1000;

export async function fetchAllSales(
  supabase: SupabaseClient,
  range: Pick<ReportRange, "from" | "to">,
) {
  const rows: SaleRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase
      .from("sales")
      .select(
        "id,customer_id,invoice_number,document_number,sale_date,amount,description",
      )
      .order("sale_date", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (range.from) query = query.gte("sale_date", range.from);
    if (range.to) query = query.lte("sale_date", range.to);

    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as SaleRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchAllCustomers(supabase: SupabaseClient) {
  const rows: CustomerSummaryRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("customer_sales_summary")
      .select(
        "id,name,phone,normalized_phone,city,address,status,priority,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase,next_followup_at",
      )
      .order("total_sales", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data ?? []) as CustomerSummaryRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchAllFollowups(
  supabase: SupabaseClient,
  range: Pick<ReportRange, "from" | "to">,
) {
  const rows: FollowupRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase
      .from("followups")
      .select(
        "id,customer_id,followup_at,channel,outcome,notes,next_followup_at,potential_value",
      )
      .order("followup_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    const from = toTimestampStart(range.from);
    const to = toTimestampEnd(range.to);
    if (from) query = query.gte("followup_at", from);
    if (to) query = query.lte("followup_at", to);

    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as FollowupRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchAllInvoices(
  supabase: SupabaseClient,
  range: Pick<ReportRange, "from" | "to">,
) {
  const rows: InvoiceRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase
      .from("invoices")
      .select(
        "id,customer_id,invoice_number,document_number,invoice_date,total_amount",
      )
      .order("invoice_date", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (range.from) query = query.gte("invoice_date", range.from);
    if (range.to) query = query.lte("invoice_date", range.to);

    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }
    const page = (data ?? []) as InvoiceRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchInvoiceItems(
  supabase: SupabaseClient,
  invoiceIds: string[],
) {
  if (!invoiceIds.length) return [] as InvoiceItemRow[];
  const rows: InvoiceItemRow[] = [];
  const chunkSize = 150;

  for (let index = 0; index < invoiceIds.length; index += chunkSize) {
    const chunk = invoiceIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("invoice_items")
      .select("id,invoice_id,product_name,quantity,unit_price,line_total")
      .in("invoice_id", chunk)
      .limit(10000);

    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }
    rows.push(...((data ?? []) as InvoiceItemRow[]));
  }
  return rows;
}
