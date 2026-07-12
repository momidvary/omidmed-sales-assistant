import Link from "next/link";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import styles from "./customers.module.css";

const number = new Intl.NumberFormat("fa-IR");

function formatMoney(value: number | string | null) {
  return number.format(Math.round(Number(value ?? 0)));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR").format(new Date(`${value}T12:00:00`));
}

const priorityLabel: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const search = q.trim().slice(0, 80);
  const supabase = await createClient();

  let query = supabase
    .from("customer_sales_summary")
    .select("id,name,phone,address,priority,last_purchase_at,purchase_count,total_sales,days_since_last_purchase", { count: "exact" })
    .order("total_sales", { ascending: false })
    .limit(200);

  if (search) {
    const digits = search.replace(/\D/g, "");
    query = digits.length >= 4
      ? query.ilike("normalized_phone", `%${digits}%`)
      : query.ilike("name", `%${search.replace(/[%_]/g, "")}%`);
  }

  const { data, count, error } = await query;
  const customers = data ?? [];

  return (
    <AppShell
      active="customers"
      title="بانک مشتریان"
      subtitle="مشتری‌ها را جست‌وجو کن و سابقه کلی خریدشان را ببین."
    >
      <section className={styles.toolbar}>
        <form className={styles.search} method="get">
          <Icon name="search" size={19} />
          <input name="q" defaultValue={search} placeholder="نام مشتری یا شماره موبایل..." />
          <button type="submit">جست‌وجو</button>
          {search ? <Link href="/customers">پاک‌کردن</Link> : null}
        </form>
        <Link className={styles.importButton} href="/import">
          <Icon name="upload" size={18} /> ورود اطلاعات
        </Link>
      </section>

      <section className={styles.summary}>
        <div><span>تعداد نتیجه</span><strong>{number.format(count ?? customers.length)}</strong></div>
        <p>برای حفظ سرعت، در هر بار حداکثر ۲۰۰ مشتری نمایش داده می‌شود.</p>
      </section>

      <section className={styles.tableCard}>
        {error ? <div className={styles.error}>خطا در خواندن مشتریان: {error.message}</div> : null}
        {!error && customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Icon name="users" size={30} /></div>
            <h4>{search ? "مشتری پیدا نشد" : "بانک مشتریان خالی است"}</h4>
            <p>{search ? "عبارت دیگری را جست‌وجو کن." : "ابتدا فایل آماده مشتریان را وارد کن."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>مشتری</th><th>موبایل</th><th>آخرین خرید</th><th>تعداد خرید</th><th>جمع فروش</th><th>اولویت</th></tr></thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.name}</strong><small>{customer.address || "آدرس ثبت نشده"}</small></td>
                    <td dir="ltr">{customer.phone || "—"}</td>
                    <td><span>{formatDate(customer.last_purchase_at)}</span><small>{customer.days_since_last_purchase == null ? "" : `${number.format(customer.days_since_last_purchase)} روز قبل`}</small></td>
                    <td>{number.format(customer.purchase_count ?? 0)}</td>
                    <td>{formatMoney(customer.total_sales)}</td>
                    <td><span className={`${styles.priority} ${styles[customer.priority]}`}>{priorityLabel[customer.priority] ?? customer.priority}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
