import Link from "next/link";
import AppShell from "@/components/app-shell";
import HoloSync from "./holo-sync";
import styles from "./holo-sync.module.css";

export default function HoloSyncPage() {
  return (
    <AppShell
      active="import"
      title="به‌روزرسانی مستقیم از هلو"
      subtitle="فایل‌های اصلی QRP را انتخاب کن؛ برنامه خودش آن‌ها را می‌خواند و فقط اطلاعات لازم را به‌روزرسانی می‌کند."
    >
      <div className={styles.backRow}>
        <Link href="/import">← بازگشت به ورود اطلاعات</Link>
      </div>

      <section className={styles.intro}>
        <span>روش دائمی به‌روزرسانی فروش</span>
        <h2>دیگر نیازی به تبدیل دستی CSV نیست</h2>
        <p>
          دو گزارش کامل را از هلو ذخیره کن: «تیتر فاکتور» و «فاکتور ستونی».
          فایل خام فقط داخل مرورگر خودت خوانده می‌شود و در GitHub ذخیره نخواهد شد.
        </p>
      </section>

      <HoloSync />
    </AppShell>
  );
}
