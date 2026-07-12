import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect("/");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.brand}>
          <div className={styles.logo}>اُم</div>
          <div>
            <strong>امیدمِد</strong>
            <span>دستیار فروش شخصی</span>
          </div>
        </div>

        <div className={styles.heading}>
          <span className={styles.badge}>ورود اختصاصی مدیر</span>
          <h1 id="login-title">ورود به دستیار فروش</h1>
          <p>برای مشاهده اطلاعات فروش، ایمیل و رمز عبور خودت را وارد کن.</p>
        </div>

        <LoginForm />

        <p className={styles.securityNote}>
          این برنامه خصوصی است و ثبت‌نام عمومی ندارد.
        </p>
      </section>
    </main>
  );
}
