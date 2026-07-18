import Link from "next/link";
import AppShell from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllCustomers,
  fetchAllFollowups,
  fetchAllInvoices,
  fetchInvoiceItems,
} from "@/lib/reports/data";
import {
  getReportRange,
  REPORT_PERIODS,
  safeReportPeriod,
} from "@/lib/reports/period";
import styles from "./reports.module.css";

const number = new Intl.NumberFormat("fa-IR");

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return number.format(Math.round(value));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value}T12:00:00+03:30`));
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

function compareText(value: number | null) {
  if (value == null) return "برای دوره قبل داده کافی وجود ندارد";
  if (Math.abs(value) < 0.1) return "تقریباً بدون تغییر نسبت به دوره قبل";
  return `${number.format(Math.abs(Math.round(value)))}٪ ${value > 0 ? "رشد" : "کاهش"} نسبت به دوره قبل`;
}

function compareClass(value: number | null) {
  if (value == null || Math.abs(value) < 0.1) return styles.neutral;
  return value > 0 ? styles.positive : styles.negative;
}

function monthKey(value: string) {
  const date = new Date(`${value}T12:00:00+03:30`);
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "short",
    timeZone: "Asia/Tehran",
  }).format(date);
}

const outcomeLabels: Record<string, string> = {
  no_answer: "پاسخ نداد",
  requested_price: "قیمت خواست",
  no_need: "فعلاً نیاز ندارد",
  order_placed: "سفارش داد",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = safeReportPeriod(params.period);
  const range = getReportRange(period);
  const previousRange = {
    from: range.previousFrom,
    to: range.previousTo,
  };
  const supabase = await createClient();

  let errorMessage: string | null = null;
  let invoices = [] as Awaited<ReturnType<typeof fetchAllInvoices>>;
  let previousInvoices = [] as Awaited<ReturnType<typeof fetchAllInvoices>>;
  let customers = [] as Awaited<ReturnType<typeof fetchAllCustomers>>;
  let followups = [] as Awaited<ReturnType<typeof fetchAllFollowups>>;
  let items = [] as Awaited<ReturnType<typeof fetchInvoiceItems>>;

  try {
    [invoices, previousInvoices, customers, followups] = await Promise.all([
      fetchAllInvoices(supabase, range),
      range.previousFrom
        ? fetchAllInvoices(supabase, previousRange)
        : Promise.resolve([]),
      fetchAllCustomers(supabase),
      fetchAllFollowups(supabase, range),
    ]);
    items = await fetchInvoiceItems(
      supabase,
      invoices.map((invoice) => invoice.id),
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "خطا در دریافت گزارش‌ها";
  }

  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const totalSales = invoices.reduce(
    (sum, invoice) => sum + numeric(invoice.total_amount),
    0,
  );
  const previousTotalSales = previousInvoices.reduce(
    (sum, invoice) => sum + numeric(invoice.total_amount),
    0,
  );
  const averageInvoice = invoices.length ? totalSales / invoices.length : 0;
  const activeCustomerIds = new Set(
    invoices.map((invoice) => invoice.customer_id),
  );
  const comparison = range.previousFrom
    ? percentChange(totalSales, previousTotalSales)
    : null;

  const customerTotals = new Map<string, { amount: number; count: number }>();
  for (const invoice of invoices) {
    const current = customerTotals.get(invoice.customer_id) ?? {
      amount: 0,
      count: 0,
    };
    current.amount += numeric(invoice.total_amount);
    current.count += 1;
    customerTotals.set(invoice.customer_id, current);
  }
  const topCustomers = [...customerTotals.entries()]
    .map(([customerId, stats]) => ({
      id: customerId,
      name: customerMap.get(customerId)?.name ?? "مشتری نامشخص",
      ...stats,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const productTotals = new Map<string, { amount: number; quantity: number }>();
  for (const item of items) {
    if (!invoiceMap.has(item.invoice_id)) continue;
    const current = productTotals.get(item.product_name) ?? {
      amount: 0,
      quantity: 0,
    };
    current.amount += numeric(item.line_total);
    current.quantity += numeric(item.quantity);
    productTotals.set(item.product_name, current);
  }
  const topProducts = [...productTotals.entries()]
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const inactiveCustomers = customers
    .filter(
      (customer) =>
        customer.status === "active" &&
        (customer.days_since_last_purchase ?? 0) >= 45,
    )
    .sort((a, b) => {
      const priorityScore = (value: string) =>
        value === "vip" ? 3 : value === "high" ? 2 : value === "normal" ? 1 : 0;
      return (
        priorityScore(b.priority) - priorityScore(a.priority) ||
        (b.days_since_last_purchase ?? 0) - (a.days_since_last_purchase ?? 0)
      );
    })
    .slice(0, 8);

  const followupCounts = new Map<string, number>();
  for (const followup of followups) {
    followupCounts.set(
      followup.outcome,
      (followupCounts.get(followup.outcome) ?? 0) + 1,
    );
  }

  const trend = new Map<string, number>();
  for (const invoice of invoices) {
    const key = monthKey(invoice.invoice_date);
    trend.set(key, (trend.get(key) ?? 0) + numeric(invoice.total_amount));
  }
  const trendRows = [...trend.entries()].reverse().slice(-8);
  const trendMax = Math.max(1, ...trendRows.map(([, amount]) => amount));

  return (
    <AppShell
      active="reports"
      title="گزارش‌های فروش"
      subtitle="تحلیل فاکتورهای معتبر، مشتریان، کالاها و نتیجه پیگیری‌ها"
    >
      <section className={styles.periodBar}>
        <form className={styles.periodForm} action="/reports" method="get">
          <label htmlFor="period">بازه گزارش</label>
          <select id="period" name="period" defaultValue={period}>
            {REPORT_PERIODS.map((item) => (
              <option value={item.key} key={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <button className={styles.applyButton} type="submit">
            نمایش گزارش
          </button>
        </form>
        <div className={styles.rangeText}>
          <strong>{range.label}</strong>
          <br />
          {range.from && range.to
            ? `از ${formatDate(range.from)} تا ${formatDate(range.to)}`
            : "از ابتدای اطلاعات ثبت‌شده تا امروز"}
        </div>
      </section>

      {errorMessage ? (
        <div className={styles.alert}>
          خواندن گزارش با خطا روبه‌رو شد: {errorMessage}
        </div>
      ) : null}

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span>جمع فروش دوره</span>
          <strong>{formatMoney(totalSales)}</strong>
          <small className={compareClass(comparison)}>{compareText(comparison)}</small>
        </article>
        <article className={styles.metric}>
          <span>تعداد فاکتور</span>
          <strong>{number.format(invoices.length)}</strong>
          <small>میانگین هر فاکتور: {formatMoney(averageInvoice)}</small>
        </article>
        <article className={styles.metric}>
          <span>مشتریان خریدار</span>
          <strong>{number.format(activeCustomerIds.size)}</strong>
          <small>مشتریانی که در این بازه حداقل یک فاکتور معتبر داشته‌اند</small>
        </article>
        <article className={styles.metric}>
          <span>پیگیری‌های ثبت‌شده</span>
          <strong>{number.format(followups.length)}</strong>
          <small>
            سفارش حاصل از پیگیری: {number.format(followupCounts.get("order_placed") ?? 0)}
          </small>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>مشتریان پرفروش</h2>
              <p>بیشترین مجموع فاکتور معتبر در بازه انتخاب‌شده</p>
            </div>
            <span className={styles.badge}>{number.format(topCustomers.length)} مشتری</span>
          </header>
          {topCustomers.length ? (
            <div className={styles.rankList}>
              {topCustomers.map((customer, index) => (
                <Link
                  href={`/customers/${customer.id}`}
                  className={styles.rankItem}
                  key={customer.id}
                >
                  <span className={styles.rank}>{number.format(index + 1)}</span>
                  <span>
                    <strong>{customer.name}</strong>
                    <small>{number.format(customer.count)} فاکتور در این بازه</small>
                  </span>
                  <span className={styles.rankValue}>{formatMoney(customer.amount)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>در این بازه فاکتور فروشی ثبت نشده است.</div>
          )}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>کالاهای پرفروش</h2>
              <p>بر اساس اقلام ثبت‌شده در فاکتورهای معتبر</p>
            </div>
            <span className={styles.badge}>{number.format(topProducts.length)} کالا</span>
          </header>
          {topProducts.length ? (
            <div className={styles.rankList}>
              {topProducts.map((product, index) => (
                <div className={styles.rankItem} key={product.name}>
                  <span className={styles.rank}>{number.format(index + 1)}</span>
                  <span>
                    <strong>{product.name}</strong>
                    <small>{number.format(Math.round(product.quantity))} واحد فروش</small>
                  </span>
                  <span className={styles.rankValue}>{formatMoney(product.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              اطلاعات اقلام فاکتور برای این بازه وجود ندارد یا SQL مرحله هشتم اجرا نشده است.
            </div>
          )}
        </article>

        <article className={`${styles.panel} ${styles.panelWide}`}>
          <header className={styles.panelHeader}>
            <div>
              <h2>روند فروش ماهانه</h2>
              <p>جمع فاکتورهای معتبر در هر ماه شمسی داخل بازه گزارش</p>
            </div>
          </header>
          {trendRows.length ? (
            <div className={styles.chart}>
              {trendRows.map(([label, amount]) => (
                <div className={styles.chartRow} key={label}>
                  <span className={styles.chartLabel}>{label}</span>
                  <span className={styles.chartTrack}>
                    <span
                      className={styles.chartBar}
                      style={{ width: `${Math.max(2, (amount / trendMax) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.chartValue}>{formatMoney(amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>برای نمایش نمودار، فاکتور فروش لازم است.</div>
          )}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>نتیجه پیگیری‌ها</h2>
              <p>خلاصه تماس‌ها و پیگیری‌های همین بازه</p>
            </div>
          </header>
          <div className={styles.followupGrid}>
            {["order_placed", "requested_price", "no_answer", "no_need"].map(
              (outcome) => (
                <div className={styles.followupCard} key={outcome}>
                  <span>{outcomeLabels[outcome]}</span>
                  <strong>{number.format(followupCounts.get(outcome) ?? 0)}</strong>
                </div>
              ),
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>مشتریان نیازمند بازگشت</h2>
              <p>مشتریان فعال با حداقل ۴۵ روز فاصله از آخرین خرید</p>
            </div>
            <span className={styles.badge}>{number.format(inactiveCustomers.length)} مورد</span>
          </header>
          {inactiveCustomers.length ? (
            <div className={styles.rankList}>
              {inactiveCustomers.map((customer, index) => (
                <Link
                  href={`/customers/${customer.id}`}
                  className={styles.rankItem}
                  key={customer.id}
                >
                  <span className={styles.rank}>{number.format(index + 1)}</span>
                  <span>
                    <strong>{customer.name}</strong>
                    <small>آخرین خرید: {formatDate(customer.last_purchase_at)}</small>
                  </span>
                  <span className={styles.rankValue}>
                    {number.format(customer.days_since_last_purchase ?? 0)} روز
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>مشتری غیرفعال مهمی پیدا نشد.</div>
          )}
        </article>
      </section>

      <section className={styles.exportPanel}>
        <h2>خروجی Excel و CSV</h2>
        <p>
          فایل‌های Excel با پسوند XLS مستقیماً در Microsoft Excel باز می‌شوند. خروجی‌ها فقط
          با حساب واردشده ساخته می‌شوند و اطلاعاتی داخل GitHub ذخیره نمی‌شود.
        </p>
        <div className={styles.exportGrid}>
          {[
            ["customers", "بانک مشتریان", "نام، موبایل، ارزش تجاری و سابقه خرید"],
            ["sales", "ریز فاکتورهای فروش", "تاریخ، مشتری، فاکتور، سند و مبلغ"],
            ["products", "اقلام فاکتور", "کالا، تعداد، قیمت و مشتری"],
            ["followups", "پیگیری‌ها", "نتیجه تماس، یادداشت و موعد بعدی"],
          ].map(([type, title, description]) => (
            <article className={styles.exportCard} key={type}>
              <h3>{title}</h3>
              <p>{description}</p>
              <div className={styles.exportActions}>
                <a
                  className={styles.downloadPrimary}
                  href={`/api/export?type=${type}&format=xls&period=${period}`}
                >
                  Excel
                </a>
                <a
                  className={styles.downloadSecondary}
                  href={`/api/export?type=${type}&format=csv&period=${period}`}
                >
                  CSV
                </a>
              </div>
            </article>
          ))}
        </div>

        <form className={styles.smsBox} action="/api/export" method="get">
          <h3>خروجی مخصوص پیامک</h3>
          <input type="hidden" name="type" value="sms" />
          <input type="hidden" name="format" value="xls" />
          <input type="hidden" name="period" value={period} />
          <div className={styles.exportFilters}>
            <select name="priority" defaultValue="urgent" aria-label="ارزش تجاری مشتری">
              <option value="">همه ارزش‌های تجاری</option>
              <option value="urgent">ویژه و کلیدی</option>
              <option value="vip">فقط ویژه</option>
              <option value="high">فقط کلیدی</option>
              <option value="normal">فقط مهم</option>
              <option value="low">فقط عادی</option>
            </select>
            <input
              type="number"
              min="0"
              name="inactive_days"
              defaultValue="45"
              placeholder="روز عدم خرید"
              aria-label="حداقل روز عدم خرید"
            />
            <input
              type="text"
              name="product"
              placeholder="نام کالا؛ اختیاری"
              aria-label="نام کالا"
            />
            <button className={styles.applyButton} type="submit">
              دریافت لیست پیامک Excel
            </button>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
