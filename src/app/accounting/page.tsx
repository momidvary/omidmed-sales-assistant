import Link from "next/link";

import AppShell from "@/components/app-shell";
import { BANK_CATEGORIES, bankCategory, CATEGORY_GROUP_LABELS, type CategoryGroup } from "@/lib/bank/categories";
import { createClient } from "@/lib/supabase/server";

import styles from "./accounting.module.css";
import { loadUnsettledInvoices } from "./invoice-data";
import {
  AccountingTabs,
  formatDate,
  formatNumber,
  MissingMigration,
  pendingCounts,
  readAll,
  rialAsToman,
} from "./shared";
import StatementUpload from "./statement-upload";

type MonthRow = {
  kind: "deposit" | "withdrawal";
  amount_rial: number | string;
  category: string | null;
  review_status: string;
};

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("/").map(Number);
  const index = year * 12 + (value - 1) + delta;
  return `${Math.floor(index / 12)}/${String((index % 12) + 1).padStart(2, "0")}`;
}

const monthNames = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function monthLabel(month: string) {
  const [year, value] = month.split("/").map(Number);
  return `${monthNames[value - 1] ?? value} ${new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(year)}`;
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: latest, error: latestError } = await supabase
    .from("bank_transactions")
    .select("jalali_date,balance_rial")
    .order("tx_date", { ascending: false })
    .order("tx_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    return (
      <AppShell active="accounting" title="حسابداری بانکی" subtitle="بر اساس صورت‌حساب بانک رسالت">
        <MissingMigration />
      </AppShell>
    );
  }

  const month = /^\d{4}\/\d{2}$/.test(params.m ?? "")
    ? params.m!
    : latest?.jalali_date?.slice(0, 7) ?? null;

  const [monthRows, counts, imports, unsettled] = await Promise.all([
    month
      ? readAll<MonthRow>((from, to) =>
          supabase
            .from("bank_transactions")
            .select("kind,amount_rial,category,review_status")
            .like("jalali_date", `${month}/%`)
            .neq("review_status", "ignored")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve({ rows: [] as MonthRow[], error: false as const }),
    pendingCounts(supabase),
    supabase
      .from("bank_statement_imports")
      .select("id,from_date,to_date,transaction_count,inserted_count,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    loadUnsettledInvoices(supabase),
  ]);
  const unsettledCount = unsettled?.open.length ?? 0;

  const byCategory = new Map<string, number>();
  let deposits = 0;
  let withdrawals = 0;
  for (const row of monthRows.rows) {
    const amount = Number(row.amount_rial);
    if (row.kind === "deposit") deposits += amount;
    else withdrawals += amount;
    const key = row.category ?? `uncategorized_${row.kind}`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + amount);
  }
  const sumOf = (keys: string[]) => keys.reduce((sum, key) => sum + (byCategory.get(key) ?? 0), 0);
  const groupTotal = (group: CategoryGroup, kind: "deposit" | "withdrawal") =>
    sumOf(BANK_CATEGORIES.filter((c) => c.group === group && c.kind === kind).map((c) => c.key));

  const rowsFor = (kind: "deposit" | "withdrawal") =>
    [...byCategory.entries()]
      .filter(([key]) => (bankCategory(key)?.kind ?? (key.endsWith(kind) ? kind : null)) === kind)
      .sort((a, b) => b[1] - a[1]);

  return (
    <AppShell active="accounting" title="حسابداری بانکی" subtitle="بر اساس صورت‌حساب بانک رسالت">
      <AccountingTabs
        active="overview"
        counts={{ deposits: counts.deposits, withdrawals: counts.withdrawals, invoices: unsettledCount }}
      />

      <StatementUpload />

      {latest ? (
        <>
          <div className={styles.monthBar}>
            <Link href={`/accounting?m=${shiftMonth(month!, -1)}`}>→ ماه قبل</Link>
            <h3>{monthLabel(month!)}</h3>
            <Link href={`/accounting?m=${shiftMonth(month!, 1)}`}>ماه بعد ←</Link>
          </div>

          <section className={styles.metrics}>
            <article>
              <span>کل واریزها</span>
              <strong className={styles.in}>{rialAsToman(deposits)}</strong>
              <small>واریز مشتریان: {rialAsToman(byCategory.get("customer_payment"))}</small>
            </article>
            <article>
              <span>کل برداشت‌ها</span>
              <strong className={styles.out}>{rialAsToman(withdrawals)}</strong>
              <small>هزینه کسب‌وکار: {rialAsToman(groupTotal("business", "withdrawal"))}</small>
            </article>
            <article>
              <span>برداشت شرکا</span>
              <strong>{rialAsToman(groupTotal("partner", "withdrawal"))}</strong>
              <small>
                من: {rialAsToman(byCategory.get("owner_draw"))} · میثم: {rialAsToman(byCategory.get("partner_meysam"))}
              </small>
            </article>
            <article>
              <span>مانده آخرین تراکنش</span>
              <strong>{latest.balance_rial === null ? "—" : rialAsToman(latest.balance_rial)}</strong>
              <small>تا {latest.jalali_date} · مبالغ به تومان</small>
            </article>
          </section>

          {counts.deposits || counts.withdrawals || unsettledCount ? (
            <section className={styles.todo}>
              {counts.deposits ? (
                <Link href="/accounting/deposits">
                  <b>{formatNumber(counts.deposits)}</b> واریز منتظر تعیین مشتری
                </Link>
              ) : null}
              {counts.withdrawals ? (
                <Link href="/accounting/withdrawals">
                  <b>{formatNumber(counts.withdrawals)}</b> برداشت بدون دسته‌بندی
                </Link>
              ) : null}
              {unsettledCount ? (
                <Link href="/accounting/invoices">
                  <b>{formatNumber(unsettledCount)}</b> فاکتور بدون تسویه ثبت‌شده
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className={styles.report}>
            {(["withdrawal", "deposit"] as const).map((kind) => (
              <div key={kind} className={styles.card}>
                <h3>{kind === "withdrawal" ? "برداشت‌ها به تفکیک دسته" : "واریزها به تفکیک دسته"}</h3>
                {rowsFor(kind).length ? (
                  <table className={styles.table}>
                    <tbody>
                      {rowsFor(kind).map(([key, amount]) => {
                        const category = bankCategory(key);
                        return (
                          <tr key={key}>
                            <td>
                              {category?.label ?? "دسته‌بندی نشده"}
                              {category ? <small> · {CATEGORY_GROUP_LABELS[category.group]}</small> : null}
                            </td>
                            <td className={kind === "deposit" ? styles.in : styles.out}>{rialAsToman(amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className={styles.hint}>در این ماه تراکنشی نیست.</p>
                )}
              </div>
            ))}
          </section>

          {imports.data?.length ? (
            <section className={styles.card}>
              <h3>آخرین فایل‌های بارگذاری‌شده</h3>
              <table className={styles.table}>
                <tbody>
                  {imports.data.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.from_date} تا {item.to_date}
                      </td>
                      <td>
                        {formatNumber(item.inserted_count)} جدید از {formatNumber(item.transaction_count)}
                      </td>
                      <td>{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}>
          <h3>هنوز صورت‌حسابی بارگذاری نشده است</h3>
          <p>
            اولین PDF را بارگذاری کنید. بعد از آن واریزها را به مشتری‌ها وصل کنید و برداشت‌ها را دسته‌بندی کنید؛ برنامه
            کارت‌ها و نام‌ها را یاد می‌گیرد و دفعه بعد خودش پیشنهاد می‌دهد.
          </p>
        </div>
      )}
    </AppShell>
  );
}
