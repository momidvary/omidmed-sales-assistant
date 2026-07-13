import Link from "next/link";
import AppShell from "@/components/app-shell";
import InvoiceImporter from "./invoice-importer";
import InvoiceItemsImporter from "./invoice-items-importer";
import styles from "./invoice-import.module.css";

export default function InvoiceImportPage() {
  return (
    <AppShell
      active="import"
      title="ورود فاکتورها و اقلام هلو"
      subtitle="تیتر ۲٬۱۰۵ فاکتور و ۹٬۲۸۱ ردیف کالا را به پرونده مشتریان وصل کن."
    >
      <div className={styles.backRow}>
        <Link href="/import">← بازگشت به ورود اطلاعات</Link>
      </div>

      <section className={styles.intro}>
        <span>مرحله سوم ورود اطلاعات</span>
        <h2>ابتدا تیتر فاکتورها، سپس اقلام هر فاکتور</h2>
        <p>
          این دو فایل از گزارش‌های QRP هلو استخراج شده‌اند. ورود دوباره آن‌ها امن
          است و ردیف تکراری ایجاد نمی‌کند.
        </p>
      </section>

      <section className={styles.twoStepGrid}>
        <article className={styles.stepPanel}>
          <div className={styles.stepTitle}>
            <b>۱</b>
            <div>
              <h3>تیتر فاکتورها</h3>
              <p>شماره فاکتور، شماره سند، تاریخ، مبلغ و وضعیت تسویه</p>
            </div>
          </div>
          <InvoiceImporter />
        </article>

        <article className={styles.stepPanel}>
          <div className={styles.stepTitle}>
            <b>۲</b>
            <div>
              <h3>اقلام فاکتورها</h3>
              <p>نام کالا، تعداد، قیمت واحد، جمع ردیف و توضیحات</p>
            </div>
          </div>
          <InvoiceItemsImporter />
        </article>
      </section>

      <section className={styles.notice}>
        <strong>ترتیب مهم است</strong>
        <p>
          اول فایل «فاکتورهای هلو آماده ورود» را کامل وارد کن. بعد فایل «اقلام
          فاکتورهای هلو آماده ورود» را انتخاب کن؛ چون هر ردیف کالا باید به شماره
          فاکتور موجود وصل شود.
        </p>
      </section>
    </AppShell>
  );
}
