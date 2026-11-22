import { loadDailySmsDismissals } from "@/lib/sms/daily-dismissals";
import { readHistory } from "@/lib/supabase/read-history";
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
  WINBACK_COOLDOWN_DAYS,
  topProducts,
  type TargetCustomer,
} from "@/lib/sales/sms-targets";
import { normalizeIranMobile } from "@/lib/sms/melipayamak";
import { predictNeed, type ItemPurchase, type NeedPrediction } from "@/lib/sales/purchase-timing";
import { isReorderUnit, type ReorderUnit } from "@/lib/sales/reorder-unit";
import { smsGreetingName } from "@/lib/sms/greeting";
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

async function loadSignals(supabase: Supabase, now: Date) {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const smsSince = since(WINBACK_COOLDOWN_DAYS);
  const [customers, invoices, invoiceItems, products, followups, sms, quotes, units, dismissals, unsettled] = await Promise.all([
    readHistory<TargetCustomer & { last_purchase_at: string | null }>((from, to) =>
      supabase
        .from("customer_crm_summary")
        .select(
          "id,name,phone,status,priority,archived_at,next_followup_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase,last_purchase_at",
        )
        .order("id")
        .range(from, to),
    ),
    // All invoices: purchase cycles and run-out dates need the full history.
    readHistory<{ id: string; customer_id: string; invoice_date: string; total_amount: number | string }>((from, to) =>
      supabase
        .from("invoices")
        .select("id,customer_id,invoice_date,total_amount")
        .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
        .order("id")
        .range(from, to),
    ),
    readHistory<{ invoice_id: string; holo_article_code: string | null; product_name: string | null; quantity: number | string | null }>((from, to) =>
      supabase
        .from("invoice_items")
        .select("invoice_id,product_name,holo_article_code,quantity")
        .order("id")
        .range(from, to),
    ),
    readHistory<{ customer_id: string; product_name: string; invoice_count: number; last_purchase_at: string | null }>(
      (from, to) =>
        supabase
          .from("customer_product_summary")
          .select("customer_id,product_name,invoice_count,last_purchase_at")
          .order("customer_id")
          .order("product_name")
          .range(from, to),
    ),
    readHistory<{ customer_id: string; followup_at: string; outcome: string }>((from, to) =>
      supabase
        .from("followups")
        .select("customer_id,followup_at,outcome")
        .gte("followup_at", since(180))
        .order("followup_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readHistory<{
      customer_id: string | null;
      recipient: string;
      created_at: string;
      sent_at: string | null;
      request_success: boolean;
      delivery_status: string | null;
    }>((from, to) =>
      supabase
        .from("sms_messages")
        .select("customer_id,recipient,created_at,sent_at,request_success,delivery_status")
        .or(`sent_at.gte.${smsSince},and(sent_at.is.null,created_at.gte.${smsSince})`)
        .order("id")
        .range(from, to),
    ),
    readHistory<{ customer_id: string }>((from, to) =>
      supabase
        .from("sales_opportunities")
        .select("customer_id")
        .in("status", ["open", "on_hold"])
        .order("id")
        .range(from, to),
    ),
    readHistory<{ id: string; reorder_unit: ReorderUnit }>((from, to) =>
      supabase.from("customers").select("id,reorder_unit").not("reorder_unit", "is", null).order("id").range(from, to),
    ),
    loadDailySmsDismissals(supabase, now),
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
    const at = row.sent_at ?? row.created_at;
    keep(row.customer_id, at);
    keep(mobileKey(row.recipient), at);
  }

  const latestOutcome = new Map<string, { at: string; outcome: string }>();
  for (const row of followups.rows) {
    if (!latestOutcome.has(row.customer_id)) latestOutcome.set(row.customer_id, { at: row.followup_at, outcome: row.outcome });
  }

  // Per customer: purchase dates and dated line items for the timing model.
  const invoiceById = new Map(invoices.rows.map((invoice) => [invoice.id, invoice]));
  const datesByCustomer = new Map<string, string[]>();
  for (const invoice of invoices.rows) {
    const dates = datesByCustomer.get(invoice.customer_id) ?? [];
    dates.push(invoice.invoice_date);
    datesByCustomer.set(invoice.customer_id, dates);
  }
  const itemsByCustomer = new Map<string, ItemPurchase[]>();
  for (const item of invoiceItems.rows) {
    const invoice = invoiceById.get(item.invoice_id);
    if (!invoice || !item.product_name) continue;
    const list = itemsByCustomer.get(invoice.customer_id) ?? [];
    list.push({ invoiceId: item.invoice_id, articleCode: item.holo_article_code, date: invoice.invoice_date, product: item.product_name, quantity: Number(item.quantity ?? 0) });
    itemsByCustomer.set(invoice.customer_id, list);
  }
  const timing = new Map<string, NeedPrediction | null>();
  // Without the invoice history the scorer falls back to the summary view.
  const profiles = new Map(units.rows.map(row => [row.id, row.reorder_unit]));
  for (const customer of customers.rows) {
    const unit = profiles.get(customer.id);
    if (unit && (!isReorderUnit(unit) || invoiceItems.error || invoices.error)) {
      timing.set(customer.id, null);
    } else if (!invoices.error) {
      timing.set(
        customer.id,
        predictNeed({
          invoiceDates: datesByCustomer.get(customer.id) ?? [],
          items: invoiceItems.error ? [] : itemsByCustomer.get(customer.id) ?? [],
          now,
          unit,
        }),
      );
    }
  }

  return {
    customers: customers.rows,
    dismissals,
    failed: customers.error,
    // Before migration 029 every customer uses the automatic product forecast.
    profilesUnavailable: units.error && units.code !== "42703" && units.code !== "PGRST204",
    smsHistoryUnavailable: sms.error,
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

export async function loadTodayTargets(supabase: Supabase, limit = DAILY_SMS_TARGETS, now = new Date()) {
  const data = await loadSignals(supabase, now);
  const thresholds = salesThresholds(data.customers);

  // Holoo sometimes has two accounts for one customer. When another record
  // with the same mobile bought more recently, that record speaks for the
  // customer and this older one is left out.
  const latestByMobile = new Map<string, string>();
  for (const customer of data.customers) {
    const key = mobileKey(customer.phone);
    if (!key || !customer.last_purchase_at) continue;
    const current = latestByMobile.get(key);
    if (!current || customer.last_purchase_at > current) latestByMobile.set(key, customer.last_purchase_at);
  }
  const newerTwin = (customer: (typeof data.customers)[number]) => {
    const latest = latestByMobile.get(mobileKey(customer.phone) ?? "");
    return Boolean(latest && latest > (customer.last_purchase_at ?? ""));
  };

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
    const mobile = normalizeIranMobile(customer.phone);
    const dismissed = data.dismissals.keys.has(customer.id) || (mobile && data.dismissals.keys.has(mobile));
    const excluded = dismissed ? "کنارگذاشتهٔ شما" :
      exclusionReason(customer, signals, Boolean(mobile), now, target?.kind ?? null) ??
      (newerTwin(customer) ? "شماره تکراری" : null);
    return { target, excluded };
  });

  const scoreById = new Map(
    ranked
      .filter((entry) => entry.target)
      .map((entry) => [
        entry.target!.customer.id,
        { score: entry.target!.score, reasons: entry.target!.reasons, kindLabel: entry.target!.kindLabel },
      ]),
  );
  const scored = ranked.map(({ target, excluded }) => {
    if (!excluded) return target;
    skipped[excluded] = (skipped[excluded] ?? 0) + 1;
    return null;
  });

  // A partial history can make a previously messaged customer look eligible.
  const unavailableReason = data.dismissals.error
    ? "فهرست مشتری‌های کنارگذاشته‌شده خوانده نشد. دوباره تلاش کنید."
    : data.smsHistoryUnavailable
    ? "سابقهٔ پیامک‌ها کامل خوانده نشد. فهرست را دوباره به‌روز کنید."
    : data.profilesUnavailable
      ? "تنظیمات الگوی خرید خوانده نشد. وضعیت اتصال و اجرای به‌روزرسانی ۰۲۹ پایگاه داده را بررسی کنید."
    : data.failed
      ? "اطلاعات مشتری‌ها کامل خوانده نشد. فهرست را دوباره به‌روز کنید."
      : null;
  const unique = unavailableReason ? [] : rankSmsTargets(scored, Infinity, mobileKey);
  if (!unavailableReason) {
    const duplicates = scored.filter(Boolean).length - unique.length;
    if (duplicates) skipped["شماره تکراری"] = duplicates;
  }
  const candidates = unique.length;
  const targets = unique.slice(0, limit);
  const reorderPattern = configuredPatterns().some((pattern) => pattern.key === "followup");

  const items: TodayTarget[] = targets.map((target) => ({
    customerId: target.customer.id,
    name: target.customer.name,
    greeting: smsGreetingName(target.customer.name),
    phone: target.customer.phone,
    kind: target.kind,
    kindLabel: target.kindLabel,
    score: target.score,
    reasons: target.reasons,
    note: target.note,
    draft: draftSmsText(target.kind, target.customer.name, target.topProduct),
    // The approved pattern only fits "time to reorder" messages.
    patternAllowed: reorderPattern && (target.kind === "reorder" || target.kind === "winback"),
  }));

  return { items, candidates, skipped, unavailableReason, scoreById,
    dismissed: data.dismissals.error ? [] : data.dismissals.customers.sort((a, b) => a.name.localeCompare(b.name, "fa")),
  };
}
