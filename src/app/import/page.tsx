import Link from "next/link";
import AppShell from "@/components/app-shell";
import CustomerImporter from "./customer-importer";
import styles from "./import.module.css";

export default function ImportPage() {
  return (
    <AppShell
      active="import"
      title="ورود اطلاعات هلو"
      subtitle="بانک مشتریان، ریز فروش و جزئیات کامل فاکتورهای هلو را وارد کن."
    >
      <section className={styles.stepCards}>
        <article className={`${styles.stepCard} ${styles.doneCard}`}>
          <span>مرحله ۱</span>
          <strong>بانک مشتریان</strong>
          <p>نام، موبایل، آدرس و خلاصه خرید ۶۹۷ مشتری</p>
          <em>قبلاً انجام شده</em>
        </article>
        <Link className={`${styles.stepCard} ${styles.doneCard}`} href="/import/sales">
          <span>مرحله ۲</span>
          <strong>ریز فروش و شماره اسناد</strong>
          <p>ورود ۲٬۱۰۴ فروش و اتصال آن‌ها به پرونده مشتریان</p>
          <em>انجام و بررسی مرحله ←</em>
        </Link>
        <Link className={`${styles.stepCard} ${styles.nextCard}`} href="/import/invoices">
          <span>مرحله ۳</span>
          <strong>فاکتورها و محصولات</strong>
          <p>ورود ۲٬۱۰۵ فاکتور و ۹٬۲۸۱ ردیف کالای خریداری‌شده</p>
          <em>شروع ورود جزئیات فاکتورها ←</em>
        </Link>
      </section>

      <section className={styles.grid}>
        <article className={styles.guide}>
          <span className={styles.badge}>بانک اصلی مشتریان</span>
          <h2>ورود یا به‌روزرسانی مشتری‌ها</h2>
          <p>
            این بخش اطلاعات خلاصه مشتریان را وارد می‌کند: نام، موبایل، آدرس،
            آخرین خرید، تعداد خرید و جمع فروش.
          </p>
          <ol>
            <li>فایل «بانک مشتریان آماده ورود» را انتخاب کن.</li>
            <li>پس از نمایش تعداد مشتریان، دکمه ورود را بزن.</li>
            <li>برای سابقه اسناد از مرحله دوم استفاده کن.</li>
            <li>برای دیدن کالاهای هر فاکتور، مرحله سوم را انجام بده.</li>
          </ol>
          <div className={styles.security}>
            <strong>امنیت اطلاعات</strong>
            <span>
              فایل مشتریان در GitHub ذخیره نمی‌شود و فقط از مرورگر تو به Supabase
              ارسال می‌شود.
            </span>
          </div>
        </article>
        <CustomerImporter />
      </section>
    </AppShell>
  );
}
