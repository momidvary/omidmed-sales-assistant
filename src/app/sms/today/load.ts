import { loadUnsettledInvoices } from "@/app/accounting/invoice-data";
import { latestContactByCustomer } from "@/lib/sales/followup-need";
import {
  draftSmsText,
  exclusionReason,
  DAILY_SMS_TARGETS,
  rankSmsTargets,
  rfmScores,
  salesThresholds,
  salesTrend,
  scoreSmsTarget,
  SMS_COOLDOWN_DAYS,
  TARGET_KIND_LABELS,
  topProducts,
  type TargetCustomer,
} from "@/lib/sales/sms-targets";
import { normalizeIranMobile } from "@/lib/sms/melipayamak";
import { predictNeed, type ItemPurchase, type NeedPrediction } from "@/lib/sales/purchase-timing";
import { configuredPatterns } from "@/lib/sms/patterns";
import type { createClient } from "@/lib/supabase/server";

import type { TodayTarget } from "./today-sms-list";

// Loads and scores today's SMS targets; shared by /sms/today and the
// "today's tasks" home page so both show the same list and count.

const DAY_MS = 86_400_000;

const mobileKey = (phone: string | null) => {
  const mobile = normalizeIranMobile(phone);
  return mobile ? `mobile:${mobile}` : null;
};

const later = (a: string | undefined, b: string | undefined) => (a && b ? (a > b ? a : b) : a ?? b) ?? null;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Reads every page of a query; PostgREST returns at most 1000 rows at a time. */
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await query(offset, offset + 999);
    if (error) return { rows, error: true };
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return { rows, error: false };
}

async function loadSignals(supabase: Supabase, now: Date) {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const [customers, invoices, invoiceItems, products, followups, sms, quotes, unsettled] = await Promise.all([
    readAll<TargetCustomer & { last_purchase_at: string | null }>((from, to) =>
      supabase
        .from("customer_crm_summary")
        .select(
          "id,name,phone,status,priority,archived_at,next_followup_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase,last_purchase_at",
        )
        .order("id")
        .range(from, to),
    ),
    // All invoices: purchase cycles and run-out dates need the full history.
    readAll<{ id: string; customer_id: string; invoice_date: string; total_amount: number | string }>((from, to) =>
      supabase
        .from("invoices")
        .select("id,customer_id,invoice_date,total_amount")
        .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
        .order("id")
        .range(from, to),
    ),
    readAll<{ invoice_id: string; product_name: string | null; quantity: number | string | null }>((from, to) =>
      supabase
        .from("invoice_items")
        .select("invoice_id,product_name,quantity")
        .order("id")
        .range(from, to),
    ),
    readAll<{ customer_id: string; product_name: string; invoice_count: number; last_purchase_at: string | null }>(
      (from, to) =>
        supabase
          .from("customer_product_summary")
          .select("customer_id,product_name,invoice_count,last_purchase_at")
          .order("customer_id")
          .order("product_name")
          .range(from, to),
    ),
    readAll<{ customer_id: string; followup_at: string; outcome: string }>((from, to) =>
      supabase
        .from("followups")
        .select("customer_id,followup_at,outcome")
        .gte("followup_at", since(180))
        .order("followup_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAll<{
      customer_id: string | null;
      recipient: string;
      created_at: string;
      request_success: boolean;
      delivery_status: string | null;
    }>((from, to) =>
      supabase
        .from("sms_messages")
        .select("customer_id,recipient,created_at,request_success,delivery_status")
        .gte("created_at", since(SMS_COOLDOWN_DAYS))
        .order("id")
        .range(from, to),
    ),
    readAll<{ customer_id: string }>((from, to) =>
      supabase
        .from("sales_opportunities")
        .select("customer_id")
        .in("status", ["open", "on_hold"])
        .order("id")
        .range(from, to),
    ),
    loadUnsettledInvoices(supabase).catch(() => null),
  ]);

  // A failed or rejected send does not count; an accepted or unknown one does.
  // Kept per customer and per mobile, so a number shared by two records, or
  // messaged from the free SMS page, also waits out the cooldown.
  const lastSms = new Map<string, string>();
  const keep = (key: string | null, at: string) => {
    if (!key) return;
    const current = lastSms.get(key);
    if (!current || at > current) lastSms.set(key, at);
  };
  for (const row of sms.rows) {
    if (!row.request_success && row.delivery_status !== "unknown") continue;
    keep(row.customer_id, row.created_at);
    keep(mobileKey(row.recipient), row.created_at);
  }

  const latestOutcome = new Map<string, { at: string; outcome: string }>();
  for (const row of followups.rows) {
    if (!latestOutcome.has(row.customer_id)) latestOutcome.set(row.customer_id, { at: row.followup_at, outcome: row.outcome });
  }

  // Per customer: purchase dates and dated line items for the timing model.
  const invoiceById = new Map(invoices.rows.map((invoice) => [invoice.id, invoice]));
  const datesByCustomer = new Map<string, string[]>();
  for (const invoice of invoices.rows) {
    datesByCustomer.set(invoice.customer_id, [...(datesByCustomer.get(invoice.customer_id) ?? []), invoice.invoice_date]);
  }
  const itemsByCustomer = new Map<string, ItemPurchase[]>();
  for (const item of invoiceItems.rows) {
    const invoice = invoiceById.get(item.invoice_id);
    if (!invoice || !item.product_name) continue;
    const list = itemsByCustomer.get(invoice.customer_id) ?? [];
    list.push({ date: invoice.invoice_date, product: item.product_name, quantity: Number(item.quantity ?? 0) });
    itemsByCustomer.set(invoice.customer_id, list);
  }
  const timing = new Map<string, NeedPrediction | null>();
  // Without the invoice history the scorer falls back to the summary view.
  if (!invoices.error) {
    for (const customer of customers.rows) {
      timing.set(
        customer.id,
        predictNeed({
          invoiceDates: datesByCustomer.get(customer.id) ?? [],
          items: invoiceItems.error ? [] : itemsByCustomer.get(customer.id) ?? [],
          now,
        }),
      );
    }
  }

  return {
    customers: customers.rows,
    failed: customers.error,
    trend: salesTrend(invoices.rows, now),
    timing,
    rfm: invoices.error ? null : rfmScores(invoices.rows, now),
    products: topProducts(products.rows),
    lastContact: latestContactByCustomer(followups.rows),
    latestOutcome,
    lastSms,
    openQuotes: new Set(quotes.rows.map((row) => row.customer_id)),
    unpaid: new Set((unsettled?.open ?? []).map((invoice) => invoice.customer_id)),
  };
}

export async function loadTodayTargets(supabase: Supabase, limit = DAILY_SMS_TARGETS) {
  const now = new Date();
  const data = await loadSignals(supabase, now);
  const thresholds = salesThresholds(data.customers);

  const skipped: Record<string, number> = {};
  // Every customer is scored (the call list uses it); exclusions only keep
  // someone off today's SMS list.
  const ranked = data.customers.map((customer) => {
    const signals = {
      lastSmsAt: later(data.lastSms.get(customer.id), data.lastSms.get(mobileKey(customer.phone) ?? "")),
      lastContactAt: data.lastContact.get(customer.id) ?? null,
    };
    const outcome = data.latestOutcome.get(customer.id);
    const askedPrice =
      outcome?.outcome === "requested_price" &&
      (!customer.last_purchase_at || outcome.at.slice(0, 10) > customer.last_purchase_at);
    const trend = data.trend.get(customer.id) ?? { recentSales: 0, previousSales: 0 };
    const target = scoreSmsTarget(
      customer,
      {
        ...signals,
        ...trend,
        topProduct: data.products.get(customer.id) ?? null,
        wantsPrice: askedPrice || data.openQuotes.has(customer.id),
        unpaidInvoice: data.unpaid.has(customer.id),
        timing: data.timing.has(customer.id) ? data.timing.get(customer.id) : undefined,
        rfm: data.rfm?.get(customer.id) ?? null,
      },
      { ...thresholds, now },
    );
    const excluded = exclusionReason(customer, signals, Boolean(normalizeIranMobile(customer.phone)), now);
    return { target, excluded };
  });

  const scoreById = new Map(
    ranked
      .filter((entry) => entry.target)
      .map((entry) => [
        entry.target!.customer.id,
        { score: entry.target!.score, reasons: entry.target!.reasons, kindLabel: TARGET_KIND_LABELS[entry.target!.kind] },
      ]),
  );
  const scored = ranked.map(({ target, excluded }) => {
    if (!excluded) return target;
    skipped[excluded] = (skipped[excluded] ?? 0) + 1;
    return null;
  });

  const unique = rankSmsTargets(scored, Infinity, mobileKey);
  const duplicates = scored.filter(Boolean).length - unique.length;
  if (duplicates) skipped["شماره تکراری"] = duplicates;
  const candidates = unique.length;
  const targets = unique.slice(0, limit);
  const reorderPattern = configuredPatterns().some((pattern) => pattern.key === "followup");

  const items: TodayTarget[] = targets.map((target) => ({
    customerId: target.customer.id,
    name: target.customer.name,
    phone: target.customer.phone,
    kind: target.kind,
    kindLabel: TARGET_KIND_LABELS[target.kind],
    score: target.score,
    reasons: target.reasons,
    note: target.note,
    draft: draftSmsText(target.kind, target.customer.name, target.topProduct),
    // The approved pattern only fits "time to reorder" messages.
    patternAllowed: reorderPattern && (target.kind === "reorder" || target.kind === "winback"),
  }));

  return { items, candidates, skipped, failed: data.failed, scoreById };
}
