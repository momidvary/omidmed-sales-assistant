import AppShell from "@/components/app-shell";
import CustomerImporter from "./customer-importer";
import styles from "./import.module.css";

export default function ImportPage() {
  return (
    <AppShell
      active="import"
      title="ورود بانک مشتریان"
      subtitle="فایل CSV آماده را انتخاب کن؛ اطلاعات مستقیماً در Supabase شخصی تو ذخیره می‌شود."
    >
      <section className={styles.grid}>
        <article className={styles.guide}>
          <span className={styles.badge}>فقط یک بار برای شروع</span>
          <h2>فایل آماده بانک مشتریان</h2>
          <p>در این مرحله فقط اطلاعات خلاصه مشتریان وارد می‌شود: نام، موبایل، آدرس، آخرین خرید، تعداد خرید و جمع فروش.</p>
          <ol>
            <li>فایل «بانک مشتریان آماده ورود» را از گفت‌وگو دانلود کن.</li>
            <li>در کادر روبه‌رو همان فایل CSV را انتخاب کن.</li>
            <li>پس از نمایش تعداد مشتریان، دکمه ورود را بزن.</li>
          </ol>
          <div className={styles.security}><strong>امنیت اطلاعات</strong><span>فایل مشتریان در GitHub ذخیره نمی‌شود و فقط از مرورگر تو به Supabase ارسال می‌شود.</span></div>
        </article>
        <CustomerImporter />
      </section>
    </AppShell>
  );
}
