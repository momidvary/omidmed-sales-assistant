import Link from "next/link";
import AppShell from "@/components/app-shell";
import SalesImporter from "./sales-importer";
import styles from "./sales-import.module.css";

export default function SalesImportPage() {
  return (
    <AppShell
      active="import"
      title="ورود ریز فروش هلو"
      subtitle="۲٬۱۰۴ سابقه فروش را به پرونده مشتریان فعلی متصل کن."
    >
      <div className={styles.backRow}>
        <Link href="/import">← بازگشت به ورود اطلاعات</Link>
      </div>

      <section className={styles.grid}>
        <article className={styles.guide}>
          <span className={styles.badge}>مرحله دوم ورود اطلاعات</span>
          <h2>سابقه اسناد و فروش‌های قبلی</h2>
          <p>
            این فایل شامل تاریخ فروش، شماره سند، مبلغ و نام مشتری است. برنامه هر
            فروش را با کد مشتری به پرونده صحیح وصل می‌کند.
          </p>
          <ol>
            <li>بانک ۶۹۷ مشتری باید قبلاً وارد شده باشد.</li>
            <li>فایل «ریز فروش هلو آماده ورود» را انتخاب کن.</li>
            <li>پس از نمایش ۲٬۱۰۴ فروش، دکمه ورود را بزن.</li>
            <li>بعد از پایان، یکی از مشتریان را باز و سابقه اسناد را بررسی کن.</li>
          </ol>
          <div className={styles.note}>
            <strong>ورود دوباره امن است</strong>
            <span>
              هر فروش یک شناسه یکتا دارد. اگر همین فایل دوباره وارد شود، ردیف‌های
              قبلی تکراری ثبت نمی‌شوند.
            </span>
          </div>
          <div className={styles.warning}>
            <strong>شماره موجود در گزارش</strong>
            <span>
              فایل هلو «شماره سند» دارد؛ بنابراین ستون شماره فاکتور فعلاً خالی
              می‌ماند و شماره سند در پرونده مشتری نمایش داده می‌شود.
            </span>
          </div>
        </article>

        <SalesImporter />
      </section>
    </AppShell>
  );
}
