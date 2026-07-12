import Link from "next/link";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

const number = new Intl.NumberFormat("fa-IR");

function money(value: number) {
  return number.format(Math.round(value));
}

export default async function Home() {
  const supabase = await createClient();

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id,name,phone,priority,imported_total_sales,imported_last_purchase_at")
    .order("imported_total_sales", { ascending: false })
    .limit(1000);

  const rows = customers ?? [];
  const totalSales = rows.reduce(
    (sum, customer) => sum + Number(customer.imported_total_sales ?? 0),
    0,
  );
  const highPriority = rows.filter((customer) => customer.priority === "high").length;
  const withoutPhone = rows.filter((customer) => !customer.phone).length;
  const topCustomers = rows.slice(0, 5);

  return (
    <AppShell
      active="home"
      title="سلام محمد، امروز چه چیزی را پیگیری کنیم؟"
      subtitle={error ? "خواندن اطلاعات با خطا روبه‌رو شد." : undefined}
    >
      <section className="hero-card">
        <div>
          <span className="pill">مرحله سوم پروژه</span>
          <h2>{rows.length ? "بانک مشتریان به دستیار وصل شده است" : "بانک مشتریان آماده ورود است"}</h2>
          <p>
            {rows.length
              ? "از اینجا می‌توانی تعداد مشتری‌ها، مشتریان مهم و جمع فروش ثبت‌شده را ببینی. مرحله بعد، ثبت تماس و پیگیری خواهد بود."
              : "فایل آماده مشتریان را از صفحه ورود اطلاعات انتخاب کن. فایل روی GitHub قرار نمی‌گیرد و مستقیماً در Supabase شخصی تو ذخیره می‌شود."}
          </p>
        </div>
        <Link className="primary-button" href={rows.length ? "/customers" : "/import"}>
          <Icon name={rows.length ? "users" : "upload"} size={19} />
          {rows.length ? "مشاهده مشتریان" : "ورود بانک مشتریان"}
        </Link>
      </section>

      <section className="stats-grid" aria-label="آمار فروش">
        <article className="stat-card">
          <div className="stat-icon"><Icon name="users" /></div>
          <div><span>مشتریان ثبت‌شده</span><strong>{number.format(rows.length)}</strong><p>بانک شخصی فروش امیدمِد</p></div>
        </article>
        <article className="stat-card">
          <div className="stat-icon"><Icon name="phone" /></div>
          <div><span>اولویت بالا</span><strong>{number.format(highPriority)}</strong><p>برای پیگیری بعدی مناسب‌اند</p></div>
        </article>
        <article className="stat-card">
          <div className="stat-icon"><Icon name="calendar" /></div>
          <div><span>شماره ثبت‌نشده</span><strong>{number.format(withoutPhone)}</strong><p>نیازمند تکمیل اطلاعات تماس</p></div>
        </article>
        <article className="stat-card">
          <div className="stat-icon"><Icon name="chart" /></div>
          <div><span>جمع فروش ثبت‌شده</span><strong className="compact-value">{rows.length ? money(totalSales) : "—"}</strong><p>در واحد ثبت‌شده هلو</p></div>
        </article>
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="section-kicker">بانک فروش</span><h3>مشتریان برتر</h3></div>
            <Link className="text-link" href="/customers">مشاهده همه</Link>
          </div>
          {topCustomers.length ? (
            <div className="mini-customer-list">
              {topCustomers.map((customer, index) => (
                <div className="mini-customer" key={customer.id}>
                  <span className="rank">{number.format(index + 1)}</span>
                  <div><strong>{customer.name}</strong><small>{customer.phone || "شماره ثبت نشده"}</small></div>
                  <b>{money(Number(customer.imported_total_sales ?? 0))}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><Icon name="users" size={30} /></div>
              <h4>هنوز مشتری وارد نشده است</h4>
              <p>از صفحه ورود اطلاعات، فایل آماده بانک مشتریان را انتخاب کن.</p>
            </div>
          )}
        </article>

        <article className="panel assistant-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">گام بعدی</span><h3>ثبت تماس و پیگیری</h3></div>
            <div className="ai-badge"><Icon name="followup" size={18} /> بعداً</div>
          </div>
          <div className="roadmap-list">
            <div className="roadmap-item done"><Icon name="check" size={18}/><span>ورود امن شخصی</span></div>
            <div className="roadmap-item done"><Icon name="check" size={18}/><span>پایگاه‌داده مشتریان</span></div>
            <div className={`roadmap-item ${rows.length ? "done" : "current"}`}><Icon name={rows.length ? "check" : "upload"} size={18}/><span>ورود بانک مشتریان</span></div>
            <div className="roadmap-item"><Icon name="followup" size={18}/><span>ثبت نتیجه تماس و پیگیری بعدی</span></div>
            <div className="roadmap-item"><Icon name="assistant" size={18}/><span>پیشنهاد هوشمند مشتری مناسب تماس</span></div>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
