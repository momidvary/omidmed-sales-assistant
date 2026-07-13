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
      <section className={styles.primarySync}>
        <div>
          <span>روش پیشنهادی برای به‌روزرسانی‌های بعدی</span>
          <h2>فایل‌های QRP هلو را مستقیم وارد کن</h2>
          <p>
            دیگر لازم نیست فایل‌ها را به CSV تبدیل کنی. برنامه گزارش «تیتر
            فاکتور» و «فاکتور ستونی» را مستقیم می‌خواند، تغییرات را نشان می‌دهد
            و فقط اطلاعات لازم را به‌روزرسانی می‌کند.
          </p>
        </div>
        <Link href="/import/holo">به‌روزرسانی مستقیم از هلو ←</Link>
      </section>

      <section className={styles.stepCards}>
        <article className={`${styles.stepCard} ${styles.doneCard}`}>
          <span>راه‌اندازی اولیه</span>
          <strong>بانک مشتریان</strong>
          <p>نام، موبایل، آدرس و خلاصه خرید مشتریان</p>
          <em>قبلاً انجام شده</em>
        </article>
        <Link className={`${styles.stepCard} ${styles.doneCard}`} href="/import/sales">
          <span>روش قدیمی CSV</span>
          <strong>ریز فروش و شماره اسناد</strong>
          <p>ورود فایل تبدیل‌شده فروش برای بررسی یا بازیابی اطلاعات</p>
          <em>مشاهده ابزار قدیمی ←</em>
        </Link>
        <Link className={`${styles.stepCard} ${styles.doneCard}`} href="/import/invoices">
          <span>روش قدیمی CSV</span>
          <strong>فاکتورها و محصولات</strong>
          <p>ورود فایل‌های تبدیل‌شده تیتر و اقلام فاکتورها</p>
          <em>مشاهده ابزار قدیمی ←</em>
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
