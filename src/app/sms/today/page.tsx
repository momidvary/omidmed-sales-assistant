import Link from "next/link";

import { loadUnsettledInvoices } from "@/app/accounting/invoice-data";
import AppShell from "@/components/app-shell";
import { latestContactByCustomer } from "@/lib/sales/followup-need";
import {
  draftSmsText,
  exclusionReason,
  rankSmsTargets,
  salesThresholds,
  salesTrend,
  scoreSmsTarget,
  SMS_COOLDOWN_DAYS,
  TARGET_KIND_LABELS,
  topProducts,
  trendSince,
  type TargetCustomer,
} from "@/lib/sales/sms-targets";
import { normalizeIranMobile } from "@/lib/sms/melipayamak";
import { configuredPatterns } from "@/lib/sms/patterns";
import { createClient } from "@/lib/supabase/server";

import styles from "../sms.module.css";
import todayStyles from "./today.module.css";
import TodaySmsList, { type TodayTarget } from "./today-sms-list";

const number = new Intl.NumberFormat("fa-IR");
const DAY_MS = 86_400_000;

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
  const [customers, invoices, products, followups, sms, quotes, unsettled] = await Promise.all([
    readAll<TargetCustomer & { last_purchase_at: string | null }>((from, to) =>
      supabase
        .from("customer_crm_summary")
        .select(
          "id,name,phone,status,priority,archived_at,next_followup_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase,last_purchase_at",
        )
        .order("id")
        .range(from, to),
    ),
    readAll<{ customer_id: string; invoice_date: string; total_amount: number | string }>((from, to) =>
      supabase
        .from("invoices")
        .select("customer_id,invoice_date,total_amount")
        .gte("invoice_date", trendSince(now))
        .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
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
    readAll<{ customer_id: string | null; created_at: string; request_success: boolean; delivery_status: string | null }>(
      (from, to) =>
        supabase
          .from("sms_messages")
          .select("customer_id,created_at,request_success,delivery_status")
          .gte("created_at", since(SMS_COOLDOWN_DAYS))
          .not("customer_id", "is", null)
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
  const lastSms = new Map<string, string>();
  for (const row of sms.rows) {
    if (!row.customer_id || (!row.request_success && row.delivery_status !== "unknown")) continue;
    const current = lastSms.get(row.customer_id);
    if (!current || row.created_at > current) lastSms.set(row.customer_id, row.created_at);
  }

  const latestOutcome = new Map<string, { at: string; outcome: string }>();
  for (const row of followups.rows) {
    if (!latestOutcome.has(row.customer_id)) latestOutcome.set(row.customer_id, { at: row.followup_at, outcome: row.outcome });
  }

  return {
    customers: customers.rows,
    failed: customers.error,
    trend: salesTrend(invoices.rows, now),
    products: topProducts(products.rows),
    lastContact: latestContactByCustomer(followups.rows),
    latestOutcome,
    lastSms,
    openQuotes: new Set(quotes.rows.map((row) => row.customer_id)),
    unpaid: new Set((unsettled?.open ?? []).map((invoice) => invoice.customer_id)),
  };
}

export default async function TodaySmsPage() {
  const supabase = await createClient();
  const now = new Date();
  const data = await loadSignals(supabase, now);
  const thresholds = salesThresholds(data.customers);

  const skipped: Record<string, number> = {};
  const scored = data.customers.map((customer) => {
    const signals = {
      lastSmsAt: data.lastSms.get(customer.id) ?? null,
      lastContactAt: data.lastContact.get(customer.id) ?? null,
    };
    const excluded = exclusionReason(customer, signals, Boolean(normalizeIranMobile(customer.phone)), now);
    if (excluded) {
      skipped[excluded] = (skipped[excluded] ?? 0) + 1;
      return null;
    }
    const outcome = data.latestOutcome.get(customer.id);
    const askedPrice =
      outcome?.outcome === "requested_price" &&
      (!customer.last_purchase_at || outcome.at.slice(0, 10) > customer.last_purchase_at);
    const trend = data.trend.get(customer.id) ?? { recentSales: 0, previousSales: 0 };
    return scoreSmsTarget(
      customer,
      {
        ...signals,
        ...trend,
        topProduct: data.products.get(customer.id) ?? null,
        wantsPrice: askedPrice || data.openQuotes.has(customer.id),
        unpaidInvoice: data.unpaid.has(customer.id),
      },
      { ...thresholds, now },
    );
  });

  const candidates = scored.filter(Boolean).length;
  const targets = rankSmsTargets(scored);
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

  return (
    <AppShell active="sms-today" title="پیامک‌های امروز" subtitle="مشتری‌هایی که امروز ارزش پیام دادن دارند">
      <section className={styles.hero}>
        <div>
          <span>فروش و بازاریابی</span>
          <h2>{number.format(items.length)} مشتری برای پیامک امروز</h2>
          <p>
            از بین {number.format(candidates)} مشتری که امروز دلیلی برای پیام دارند، {number.format(items.length)} نفر با
            بیشترین امتیاز آمده‌اند. امتیاز از موعد خرید، کم شدن خرید، قیمت گرفتن، ارزش مشتری و پیگیری‌های شما ساخته
            می‌شود. بدهکاری هلو در آن حساب نمی‌شود.
          </p>
        </div>
        <Link href="/sms" className={styles.ready}>
          تاریخچه پیامک‌ها
        </Link>
      </section>

      {data.failed ? <p className={todayStyles.hint}>اطلاعات مشتری‌ها کامل خوانده نشد؛ صفحه را دوباره باز کنید.</p> : null}

      <p className={todayStyles.hint}>
        کنار گذاشته شده‌ها:{" "}
        {[
          ["پیامک اخیر", `پیامک در ${number.format(SMS_COOLDOWN_DAYS)} روز اخیر`],
          ["تماس اخیر", "تماس در هفته اخیر"],
          ["موبایل ندارد", "بدون موبایل معتبر"],
          ["از دست رفته", "از دست رفته"],
        ]
          .map(([key, label]) => `${label}: ${number.format(skipped[key] ?? 0)}`)
          .join(" · ")}
      </p>

      <TodaySmsList targets={items} />
    </AppShell>
  );
}
