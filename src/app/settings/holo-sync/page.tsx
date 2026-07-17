import Link from "next/link";

import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

import styles from "./holo-sync.module.css";

const number = new Intl.NumberFormat("fa-IR");

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(
  value: number | string | null | undefined,
) {
  return number.format(Math.round(numeric(value)));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(date);
}

const statusLabels: Record<string, string> = {
  running: "در حال اجرا",
  completed: "موفق",
  failed: "ناموفق",
};

const modeLabels: Record<string, string> = {
  initial: "همگام‌سازی اولیه",
  incremental: "افزایشی",
  weekly_full: "بازبینی هفتگی",
  manual_full: "کامل دستی",
};

export default async function HoloSyncStatusPage() {
  const supabase = await createClient();

  const [
    runsResult,
    syncedCustomersResult,
    syncedInvoicesResult,
    debtorResult,
    creditorResult,
  ] = await Promise.all([
    supabase
      .from("holo_sync_runs")
      .select(
        "id,agent_run_id,mode,status,source_server,source_database,started_at,completed_at,customer_count,invoice_count,item_count,batch_count,error_message",
      )
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .not("holo_last_synced_at", "is", null),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("source", "holo_agent"),
    supabase
      .from("customers")
      .select("holo_balance_amount")
      .eq("holo_balance_status", "debtor")
      .gt("holo_balance_amount", 0),
    supabase
      .from("customers")
      .select("holo_balance_amount")
      .eq("holo_balance_status", "creditor")
      .gt("holo_balance_amount", 0),
  ]);

  const runs = runsResult.data ?? [];
  const lastRun = runs[0] ?? null;

  const debtorTotal = (debtorResult.data ?? []).reduce(
    (sum, row) =>
      sum + numeric(row.holo_balance_amount),
    0,
  );

  const creditorTotal = (creditorResult.data ?? []).reduce(
    (sum, row) =>
      sum + numeric(row.holo_balance_amount),
    0,
  );

  return (
    <AppShell
      active="holo-sync"
      title="اتصال خودکار هلو"
      subtitle="وضعیت انتقال فقط‌خواندنی اطلاعات از SQL هلو به دستیار فروش"
    >
      <div className={styles.topLinks}>
        <Link href="/">
          ← بازگشت به مرکز فروش
        </Link>

        <Link href="/import/holo">
          ورود دستی و فایل‌های قبلی
        </Link>
      </div>

      {runsResult.error ? (
        <div className={styles.error}>
          گزارش همگام‌سازی خوانده نشد:{" "}
          {runsResult.error.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div className={styles.heroIcon}>
          <Icon name="upload" size={28} />
        </div>

        <div>
          <span>Holoo SQL Sync Agent</span>
          <h2>
            {lastRun?.status === "completed"
              ? "آخرین اتصال با موفقیت انجام شده است"
              : lastRun?.status === "running"
                ? "همگام‌سازی در حال اجرا است"
                : lastRun?.status === "failed"
                  ? "آخرین همگام‌سازی ناموفق بوده است"
                  : "هنوز اجرای خودکاری ثبت نشده است"}
          </h2>

          <p>
            مسیر اتصال: هلو روی کامپیوتر فروش ← SQL Server
            فقط‌خواندنی ← گیرنده امن برنامه ← Supabase
          </p>
        </div>

        {lastRun ? (
          <div
            className={`${styles.lastStatus} ${
              styles[lastRun.status]
            }`}
          >
            {statusLabels[lastRun.status] ??
              lastRun.status}
          </div>
        ) : null}
      </section>

      <section className={styles.metrics}>
        <article>
          <span>مشتریان متصل‌شده</span>
          <strong>
            {number.format(
              syncedCustomersResult.count ?? 0,
            )}
          </strong>
          <small>پرونده دارای شناسه هلو</small>
        </article>

        <article>
          <span>فاکتورهای خودکار</span>
          <strong>
            {number.format(
              syncedInvoicesResult.count ?? 0,
            )}
          </strong>
          <small>فاکتور فروش دریافت‌شده از SQL</small>
        </article>

        <article>
          <span>مطالبات مشتریان</span>
          <strong>{formatMoney(debtorTotal)}</strong>
          <small>تومان</small>
        </article>

        <article>
          <span>مانده بستانکاران</span>
          <strong>{formatMoney(creditorTotal)}</strong>
          <small>تومان</small>
        </article>
      </section>

      <section className={styles.infoGrid}>
        <article className={styles.infoCard}>
          <h3>آخرین اجرای ثبت‌شده</h3>

          {lastRun ? (
            <dl>
              <div>
                <dt>شروع</dt>
                <dd>
                  {formatDateTime(lastRun.started_at)}
                </dd>
              </div>

              <div>
                <dt>پایان</dt>
                <dd>
                  {formatDateTime(lastRun.completed_at)}
                </dd>
              </div>

              <div>
                <dt>نوع اجرا</dt>
                <dd>
                  {modeLabels[lastRun.mode] ??
                    lastRun.mode}
                </dd>
              </div>

              <div>
                <dt>منبع</dt>
                <dd dir="ltr">
                  {lastRun.source_server || "—"} /{" "}
                  {lastRun.source_database || "—"}
                </dd>
              </div>

              <div>
                <dt>مشتری</dt>
                <dd>
                  {number.format(
                    lastRun.customer_count ?? 0,
                  )}
                </dd>
              </div>

              <div>
                <dt>فاکتور</dt>
                <dd>
                  {number.format(
                    lastRun.invoice_count ?? 0,
                  )}
                </dd>
              </div>

              <div>
                <dt>اقلام</dt>
                <dd>
                  {number.format(lastRun.item_count ?? 0)}
                </dd>
              </div>

              <div>
                <dt>بچ ارسالی</dt>
                <dd>
                  {number.format(lastRun.batch_count ?? 0)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.empty}>
              بعد از اجرای Agent، وضعیت اینجا نمایش داده
              می‌شود.
            </p>
          )}

          {lastRun?.error_message ? (
            <div className={styles.runError}>
              {lastRun.error_message}
            </div>
          ) : null}
        </article>

        <article className={styles.infoCard}>
          <h3>قواعد اتصال فعلی</h3>

          <ul>
            <li>
              فقط فاکتورهای نوع <b>F</b> به‌عنوان فروش
              وارد می‌شوند.
            </li>
            <li>
              مبلغ‌های هلو بدون تبدیل و با واحد تومان
              ذخیره می‌شوند.
            </li>
            <li>
              مانده نوع <b>1</b> بدهکار و نوع <b>-1</b>{" "}
              بستانکار است.
            </li>
            <li>
              اطلاعات از SQL خوانده می‌شود و هیچ دستور
              نوشتنی برای هلو اجرا نمی‌شود.
            </li>
            <li>
              هر هفته یک بازبینی کامل و بین آن‌ها
              همگام‌سازی افزایشی انجام می‌شود.
            </li>
          </ul>
        </article>
      </section>

      <section className={styles.history}>
        <header>
          <div>
            <h3>سابقه اجراها</h3>
            <p>۲۰ اجرای اخیر Agent</p>
          </div>
        </header>

        {runs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>زمان شروع</th>
                  <th>وضعیت</th>
                  <th>نوع</th>
                  <th>مشتری</th>
                  <th>فاکتور</th>
                  <th>اقلام</th>
                  <th>بچ</th>
                </tr>
              </thead>

              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      {formatDateTime(run.started_at)}
                    </td>
                    <td>
                      <span
                        className={`${styles.tableStatus} ${
                          styles[run.status]
                        }`}
                      >
                        {statusLabels[run.status] ??
                          run.status}
                      </span>
                    </td>
                    <td>
                      {modeLabels[run.mode] ?? run.mode}
                    </td>
                    <td>
                      {number.format(
                        run.customer_count ?? 0,
                      )}
                    </td>
                    <td>
                      {number.format(
                        run.invoice_count ?? 0,
                      )}
                    </td>
                    <td>
                      {number.format(
                        run.item_count ?? 0,
                      )}
                    </td>
                    <td>
                      {number.format(
                        run.batch_count ?? 0,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            هنوز سابقه‌ای ثبت نشده است.
          </div>
        )}
      </section>
    </AppShell>
  );
}
