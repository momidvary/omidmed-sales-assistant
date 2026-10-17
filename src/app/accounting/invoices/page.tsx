import Link from "next/link";

import AppShell from "@/components/app-shell";
import PatternSmsButtons from "@/components/sms/pattern-sms-buttons";
import { configuredPatterns } from "@/lib/sms/patterns";
import { createClient } from "@/lib/supabase/server";

import { reopenInvoice, settleInvoiceManually } from "../actions";
import styles from "../accounting.module.css";
import { customersByIds, loadUnsettledInvoices } from "../invoice-data";
import { AccountingTabs, formatDate, formatNumber, MissingMigration, Notice, pendingCounts } from "../shared";

const PAGE_SIZE = 40;
const DAY_MS = 86_400_000;

export default async function UnsettledInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const returnTo = page > 1 ? `/accounting/invoices?page=${page}` : "/accounting/invoices";
  const supabase = await createClient();

  const [unsettled, counts, recent] = await Promise.all([
    loadUnsettledInvoices(supabase),
    pendingCounts(supabase),
    supabase
      .from("invoices")
      .select("id,customer_id,invoice_number,total_amount,settled_at,settled_source,settled_note")
      .not("settled_at", "is", null)
      .order("settled_at", { ascending: false })
      .limit(20),
  ]);

  if (recent.error) {
    return (
      <AppShell active="accounting" title="فاکتورهای تسویه‌نشده" subtitle="حسابداری بانکی">
        <MissingMigration />
      </AppShell>
    );
  }

  const paymentPattern = configuredPatterns()
    .filter((pattern) => pattern.key === "payment")
    .map(({ key, button, description, text, variables }) => ({ key, button, description, text, variables }));
  const open = unsettled?.open ?? [];
  const pages = Math.max(1, Math.ceil(open.length / PAGE_SIZE));
  const visible = open.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const recentCustomers = await customersByIds(
    supabase,
    [...new Set((recent.data ?? []).map((row) => row.customer_id as string))],
  );
  const now = Date.now();

  return (
    <AppShell active="accounting" title="فاکتورهای تسویه‌نشده" subtitle="فاکتورهایی که پرداختشان در بانک پیدا نشده">
      <AccountingTabs
        active="invoices"
        counts={{ deposits: counts.deposits, withdrawals: counts.withdrawals, invoices: open.length }}
      />
      <Notice saved={params.saved} error={params.error} />

      {!unsettled ? (
        <div className={styles.empty}>
          <h3>اول یک صورت‌حساب بانکی بارگذاری کنید</h3>
          <p>تا وقتی اطلاعات بانک نباشد نمی‌شود فهمید کدام فاکتور واقعاً پرداخت نشده است.</p>
        </div>
      ) : (
        <>
          <div className={styles.hint}>
            <p>
              فقط فاکتورهای از {formatDate(unsettled.since)} (اولین روز صورت‌حساب‌های بارگذاری‌شده) به بعد که هیچ نشانه‌ای
              از پرداخت ندارند اینجا هستند. قبل از فرستادن پیامک «تسویه حساب» مطمئن شوید پرداخت نقدی یا از حساب دیگری
              انجام نشده؛ اگر انجام شده «تسویه شده» را بزنید.
            </p>
            <p>
              کنار گذاشته شده: {formatNumber(unsettled.excluded.paid_in_holoo)} فاکتور با پرداخت ثبت‌شده در هلو،{" "}
              {formatNumber(unsettled.excluded.customer_clear)} فاکتور مشتریانی که در هلو بدهکار نیستند، و{" "}
              {formatNumber(unsettled.olderCount)} فاکتور قدیمی‌تر از اطلاعات بانک.
            </p>
          </div>

          {!open.length ? (
            <div className={styles.empty}>
              <h3>فاکتور تسویه‌نشده‌ای پیدا نشد</h3>
            </div>
          ) : null}

          <div className={styles.list}>
            {visible.map((invoice) => {
              const days = Math.max(0, Math.floor((now - Date.parse(invoice.invoice_date)) / DAY_MS));
              return (
                <article key={invoice.id} className={styles.card}>
                  <div className={styles.txHead}>
                    <div>
                      <strong>{formatNumber(invoice.total_amount)} تومان</strong>
                      {invoice.paid_amount ? (
                        <span>
                          واریز شده {formatNumber(invoice.paid_amount)} · مانده{" "}
                          {formatNumber(Number(invoice.total_amount) - invoice.paid_amount)}
                        </span>
                      ) : null}
                      <span>
                        فاکتور {invoice.invoice_number} · {formatDate(invoice.invoice_date)} ·{" "}
                        {days ? `${formatNumber(days)} روز پیش` : "امروز"}
                      </span>
                    </div>
                    <div>
                      {invoice.customer ? (
                        <Link href={`/customers/${invoice.customer_id}`}>
                          <b>{invoice.customer.name}</b>
                        </Link>
                      ) : (
                        <b>مشتری نامشخص</b>
                      )}
                      {invoice.customer?.phone ? <span dir="ltr">{invoice.customer.phone}</span> : null}
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <form action={settleInvoiceManually} className={styles.inlineForm}>
                      <input type="hidden" name="invoice_id" value={invoice.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input name="note" placeholder="مثلاً نقدی، کارت‌خوان، حساب دیگر" maxLength={300} />
                      <button className={styles.secondary}>تسویه شده</button>
                    </form>
                    {invoice.customer ? (
                      <PatternSmsButtons
                        customerId={invoice.customer_id}
                        customerName={invoice.customer.name}
                        phone={invoice.customer.phone}
                        invoices={[
                          {
                            number: invoice.invoice_number,
                            amount: formatNumber(invoice.total_amount),
                            items: "",
                          },
                        ]}
                        patterns={paymentPattern}
                      />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          {pages > 1 ? (
            <nav className={styles.pagination}>
              <Link href={`/accounting/invoices?page=${page - 1}`} aria-disabled={page <= 1}>
                → قبلی
              </Link>
              <span>
                صفحه {formatNumber(page)} از {formatNumber(pages)}
              </span>
              <Link href={`/accounting/invoices?page=${page + 1}`} aria-disabled={page >= pages}>
                بعدی ←
              </Link>
            </nav>
          ) : null}
        </>
      )}

      {recent.data?.length ? (
        <section className={styles.card}>
          <h3>آخرین فاکتورهای تسویه‌شده</h3>
          <table className={styles.table}>
            <tbody>
              {recent.data.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    فاکتور {invoice.invoice_number}
                    <small> · {recentCustomers.get(invoice.customer_id as string)?.name ?? "—"}</small>
                  </td>
                  <td>{formatNumber(invoice.total_amount)}</td>
                  <td>
                    {invoice.settled_source === "bank" ? "واریز بانکی" : invoice.settled_note ?? "دستی"}
                    <small> · {formatDate(invoice.settled_at)}</small>
                  </td>
                  <td>
                    {invoice.settled_source === "manual" ? (
                      <form action={reopenInvoice}>
                        <input type="hidden" name="invoice_id" value={invoice.id} />
                        <input type="hidden" name="return_to" value={returnTo} />
                        <button className={styles.ghost}>باز کردن</button>
                      </form>
                    ) : (
                      <Link href="/accounting/deposits?view=confirmed">از بخش واریزها</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </AppShell>
  );
}
