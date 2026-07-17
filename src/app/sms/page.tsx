import AppShell from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import SmsCenter from "./sms-center";
import styles from "./sms.module.css";

const numberFormatter = new Intl.NumberFormat("fa-IR");

type SmsLogRow = {
  id: string;
  customer_id: string | null;
  source: string | null;
  mode: string | null;
  recipient: string;
  message_text: string;
  provider_rec_id: string | null;
  request_success: boolean;
  provider_status: string | null;
  delivery_status: string | null;
  sent_at: string | null;
  created_at: string;
};

type CustomerNameRow = {
  id: string;
  name: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(date);
}

export default async function SmsPage() {
  const supabase = await createClient();

  const { data: logs, error } = await supabase
    .from("sms_messages")
    .select(
      "id,customer_id,source,mode,recipient,message_text,provider_rec_id,request_success,provider_status,delivery_status,sent_at,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (logs ?? []) as SmsLogRow[];

  const customerIds = Array.from(
    new Set(
      rows
        .map((row) => row.customer_id)
        .filter((customerId): customerId is string => Boolean(customerId)),
    ),
  );

  const { data: customerRows } = customerIds.length
    ? await supabase.from("customers").select("id,name").in("id", customerIds)
    : { data: [] as CustomerNameRow[] };

  const customers = (customerRows ?? []) as CustomerNameRow[];
  const customerMap = new Map(
    customers.map((customer) => [customer.id, customer.name]),
  );

  const configured = Boolean(
    process.env.MELIPAYAMAK_API_TOKEN?.trim() &&
    process.env.MELIPAYAMAK_SENDER?.trim(),
  );

  const successCount = rows.filter(
    (row) => row.request_success === true,
  ).length;
  const failedCount = rows.filter(
    (row) => row.request_success === false,
  ).length;

  return (
    <AppShell
      active="sms"
      title="مرکز پیامک"
      subtitle="ارسال تکی، کمپین شخصی‌سازی‌شده و سابقه پیامک‌های ملی پیامک"
    >
      <section className={styles.hero}>
        <div>
          <span>اتصال ملی پیامک</span>
          <h2>
            {configured ? "اتصال آماده ارسال است" : "تنظیمات پیامک کامل نیست"}
          </h2>
          <p>
            توکن فقط در سرور نگهداری می‌شود و در مرورگر یا GitHub نمایش داده
            نمی‌شود.
          </p>
        </div>

        <b className={configured ? styles.ready : styles.notReady}>
          {configured ? "آماده" : "نیازمند تنظیم"}
        </b>
      </section>

      <section className={styles.metrics}>
        <article>
          <span>ارسال‌های اخیر</span>
          <strong>{numberFormatter.format(rows.length)}</strong>
        </article>
        <article>
          <span>پذیرفته‌شده</span>
          <strong>{numberFormatter.format(successCount)}</strong>
        </article>
        <article>
          <span>ناموفق</span>
          <strong>{numberFormatter.format(failedCount)}</strong>
        </article>
      </section>

      <section className={styles.layout}>
        <article className={styles.sendCard}>
          <h3>ارسال تکی یا تست اتصال</h3>
          <p>
            شماره و متن را وارد کن؛ ارسال واقعی فقط بعد از فشردن دکمه تأیید
            انجام می‌شود.
          </p>
          <SmsCenter />
        </article>

        <article className={styles.helpCard}>
          <h3>روش‌های فعال برنامه</h3>
          <div>
            <b>پرونده مشتری</b>
            <span>پیام پیگیری، تسویه یا آماده‌شدن سفارش</span>
          </div>
          <div>
            <b>کمپین فروش</b>
            <span>ارسال متن متفاوت و شخصی‌سازی‌شده برای هر مشتری</span>
          </div>
          <div>
            <b>قیمت‌های باز</b>
            <span>پیگیری مشتریانی که قیمت گرفته‌اند اما سفارش نداده‌اند</span>
          </div>
        </article>
      </section>

      <section className={styles.history}>
        <header>
          <h3>سابقه پیامک‌ها</h3>
          <span>۶۰ ارسال آخر</span>
        </header>

        {error ? (
          <div className={styles.alert}>
            ابتدا SQL مرحله پیامک را اجرا کن. جزئیات: {error.message}
          </div>
        ) : rows.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>مشتری/شماره</th>
                  <th>متن</th>
                  <th>منبع</th>
                  <th>وضعیت</th>
                  <th>شناسه</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const customerName = row.customer_id
                    ? customerMap.get(row.customer_id)
                    : null;

                  return (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.sent_at || row.created_at)}</td>
                      <td>
                        <b>{customerName || "ارسال دستی"}</b>
                        <small dir="ltr">{row.recipient}</small>
                      </td>
                      <td className={styles.message}>{row.message_text}</td>
                      <td>{row.source || "—"}</td>
                      <td>
                        <span
                          className={
                            row.request_success
                              ? styles.accepted
                              : styles.failed
                          }
                        >
                          {row.request_success ? "پذیرفته شد" : "ناموفق"}
                        </span>
                      </td>
                      <td dir="ltr">{row.provider_rec_id || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            هنوز پیامکی از داخل برنامه ارسال نشده است.
          </div>
        )}
      </section>
    </AppShell>
  );
}
