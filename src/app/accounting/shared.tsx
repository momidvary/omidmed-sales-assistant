import Link from "next/link";

import type { createClient } from "@/lib/supabase/server";

import styles from "./accounting.module.css";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

const number = new Intl.NumberFormat("fa-IR");

export function formatNumber(value: number | string | null | undefined) {
  return number.format(Math.round(Number(value ?? 0)));
}

/** Bank rows are rial; everything on screen is toman like Holoo. */
export function rialAsToman(value: number | string | null | undefined) {
  return formatNumber(Number(value ?? 0) / 10);
}

export function maskCard(card: string | null | undefined) {
  return card ? `${card.slice(0, 4)}…${card.slice(-4)}` : null;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeZone: "Asia/Tehran" }).format(new Date(value));
}

const tabs = [
  { key: "overview", label: "نمای کلی", href: "/accounting" },
  { key: "deposits", label: "واریزها", href: "/accounting/deposits" },
  { key: "withdrawals", label: "برداشت‌ها", href: "/accounting/withdrawals" },
  { key: "invoices", label: "فاکتورهای تسویه‌نشده", href: "/accounting/invoices" },
  { key: "rules", label: "قوانین", href: "/accounting/rules" },
];

export function AccountingTabs({ active, counts }: { active: string; counts?: Record<string, number> }) {
  return (
    <nav className={styles.tabs}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className={tab.key === active ? styles.activeTab : undefined}>
          {tab.label}
          {counts?.[tab.key] ? <b>{formatNumber(counts[tab.key])}</b> : null}
        </Link>
      ))}
    </nav>
  );
}

const savedMessages: Record<string, string> = {
  deposit: "واریز برای مشتری ثبت شد.",
  category: "دسته‌بندی ثبت شد.",
  ignored: "تراکنش کنار گذاشته شد.",
  reopened: "تراکنش دوباره به صف بررسی برگشت.",
  settled: "فاکتور تسویه‌شده علامت خورد.",
  "invoice-reopened": "فاکتور دوباره باز شد.",
  "rule-deleted": "قانون حذف شد.",
};

const errorMessages: Record<string, string> = {
  invalid: "اطلاعات فرم معتبر نیست.",
  customer: "مشتری پیدا نشد.",
  invoice: "یکی از فاکتورهای انتخاب‌شده پیدا نشد یا قبلاً تسویه شده است.",
  amount: "مبلغ این واریز به همه فاکتورهای تیک‌خورده نمی‌رسد؛ فاکتورهای اضافه را بردارید.",
  reviewed: "این تراکنش قبلاً بررسی شده است؛ اول «برگرداندن» را بزنید.",
  save: "ذخیره انجام نشد. دوباره تلاش کنید.",
};

export function Notice({ saved, error, applied }: { saved?: string; error?: string; applied?: string }) {
  if (error) return <div className={styles.alert}>{errorMessages[error] ?? "خطا رخ داد."}</div>;
  if (!saved || !savedMessages[saved]) return null;
  const extra = Number(applied ?? 0) > 0 ? ` ${formatNumber(applied)} برداشت مشابه هم با همین قانون دسته‌بندی شد.` : "";
  return <div className={styles.success}>{savedMessages[saved] + extra}</div>;
}

export function MissingMigration() {
  return (
    <div className={styles.alert}>
      جدول‌های حسابداری بانکی هنوز ساخته نشده‌اند. فایل <code>supabase/migrations/026_bank_accounting.sql</code> را در
      Supabase → SQL Editor اجرا کنید.
    </div>
  );
}

/** Reads every page of a query; PostgREST returns at most 1000 rows at a time. */
export async function readAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  limit = 20_000,
) {
  const rows: T[] = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const { data, error } = await query(offset, offset + 999);
    if (error) return { rows, error: true as const };
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return { rows, error: false as const };
}

export type TransactionRow = {
  id: string;
  jalali_date: string;
  tx_date: string;
  tx_time: string | null;
  kind: "deposit" | "withdrawal";
  amount_rial: number | string;
  description: string;
  counterparty_name: string | null;
  counterparty_card: string | null;
  is_fee: boolean;
  category: string | null;
  category_source: string | null;
  customer_id: string | null;
  review_status: "pending" | "confirmed" | "ignored";
  user_note: string | null;
};

export const TRANSACTION_COLUMNS =
  "id,jalali_date,tx_date,tx_time,kind,amount_rial,description,counterparty_name,counterparty_card,is_fee,category,category_source,customer_id,review_status,user_note";

export async function pendingCounts(supabase: Supabase) {
  const count = async (kind: "deposit" | "withdrawal") => {
    const { count: total } = await supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind)
      .eq("review_status", "pending");
    return total ?? 0;
  };
  const [deposits, withdrawals] = await Promise.all([count("deposit"), count("withdrawal")]);
  return { deposits, withdrawals };
}
