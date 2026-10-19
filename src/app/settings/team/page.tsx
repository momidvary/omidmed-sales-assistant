import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTeamContext } from "@/lib/team";

import styles from "./team.module.css";

const messages: Record<string, string> = {
  added: "حساب منشی ساخته شد. با همین ایمیل و رمز وارد برنامه شود.",
  password: "رمز عوض شد.",
  removed: "حساب منشی حذف شد و دیگر نمی‌تواند وارد شود.",
};

const errors: Record<string, string> = {
  invalid: "نام، ایمیل معتبر و رمز حداقل ۸ حرفی را وارد کنید.",
  exists: "این ایمیل قبلاً در برنامه ثبت شده است؛ ایمیل دیگری وارد کنید.",
  config: "کلید SUPABASE_SERVICE_ROLE_KEY در Vercel تعریف نشده است.",
  migration: "ابتدا migration شماره 028 را در Supabase اجرا کنید.",
  notfound: "این عضو پیدا نشد.",
  save: "ذخیره انجام نشد. دوباره تلاش کنید.",
};

function clean(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

/** The owner's own context; team members never reach these actions. */
async function requireOwner() {
  const team = await getTeamContext();
  if (!team || team.role !== "owner") redirect("/");
  return team;
}

/** A member of this owner's team, checked with the owner's own RLS view. */
async function ownMember(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("team_members").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

async function addMember(formData: FormData) {
  "use server";
  const team = await requireOwner();
  const name = clean(formData.get("display_name"), 60);
  const email = clean(formData.get("email"), 120).toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 72) {
    redirect("/settings/team?error=invalid");
  }
  const admin = createAdminClient();
  if (!admin) redirect("/settings/team?error=config");

  // Only a brand-new login can join: an existing account may own data of its own.
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) {
    redirect(`/settings/team?error=${/already|exists|registered/i.test(error?.message ?? "") ? "exists" : "save"}`);
  }

  const { error: memberError } = await admin.from("team_members").insert({
    user_id: created.user.id,
    owner_id: team.ownerId,
    role: "secretary",
    display_name: name,
  });
  if (memberError) {
    // Without the membership the login would see an empty app; remove it.
    await admin.auth.admin.deleteUser(created.user.id);
    redirect(`/settings/team?error=${memberError.code === "42P01" ? "migration" : "save"}`);
  }

  revalidatePath("/settings/team");
  redirect("/settings/team?saved=added");
}

async function changePassword(formData: FormData) {
  "use server";
  await requireOwner();
  const userId = clean(formData.get("user_id"), 40);
  const password = String(formData.get("password") ?? "");
  if (password.length < 8 || password.length > 72) redirect("/settings/team?error=invalid");
  if (!(await ownMember(userId))) redirect("/settings/team?error=notfound");
  const admin = createAdminClient();
  if (!admin) redirect("/settings/team?error=config");
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  redirect(error ? "/settings/team?error=save" : "/settings/team?saved=password");
}

async function removeMember(formData: FormData) {
  "use server";
  await requireOwner();
  const userId = clean(formData.get("user_id"), 40);
  if (!(await ownMember(userId))) redirect("/settings/team?error=notfound");
  const admin = createAdminClient();
  if (!admin) redirect("/settings/team?error=config");
  // Deleting the login also removes the membership; their SMS and follow-ups stay.
  const { error } = await admin.auth.admin.deleteUser(userId);
  revalidatePath("/settings/team");
  redirect(error ? "/settings/team?error=save" : "/settings/team?saved=removed");
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("team_members")
    .select("user_id,display_name,role,created_at")
    .order("created_at");

  const admin = createAdminClient();
  const members = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data } = admin ? await admin.auth.admin.getUserById(row.user_id as string) : { data: null };
      return { ...row, email: data?.user?.email ?? "—", lastSignIn: data?.user?.last_sign_in_at ?? null };
    }),
  );

  return (
    <AppShell active="team" title="تیم" subtitle="حساب منشی و دسترسی‌ها">
      {params.saved && messages[params.saved] ? <div className={styles.success}>{messages[params.saved]}</div> : null}
      {params.error ? <div className={styles.alert}>{errors[params.error] ?? errors.save}</div> : null}
      {error ? <div className={styles.alert}>{errors.migration}</div> : null}

      <section className={styles.card}>
        <h2>منشی به چه چیزهایی دسترسی دارد؟</h2>
        <div className={styles.access}>
          <div>
            <h3>می‌بیند و کار می‌کند</h3>
            <ul>
              <li>امروز و پیامک‌های امروز</li>
              <li>مشتریان، مبلغ خرید و فاکتورها</li>
              <li>ثبت تماس و پیگیری، قیمت‌های باز، قیف فروش</li>
              <li>ارسال پیامک تکی و الگویی</li>
              <li>ساخت پوستر، دستیار و گزارش‌ها</li>
            </ul>
          </div>
          <div>
            <h3>نمی‌بیند</h3>
            <ul>
              <li>حسابداری بانکی و برداشت‌ها</li>
              <li>علامت زدن «تسویه شده» برای فاکتور</li>
              <li>کمپین‌ها و پیامک گروهی کمپین</li>
              <li>اتصال هلو و این صفحه</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h2>اعضای تیم</h2>
        {members.length ? (
          <div className={styles.members}>
            {members.map((member) => (
              <article key={member.user_id as string} className={styles.member}>
                <div>
                  <b>{member.display_name as string}</b>
                  <span dir="ltr">{member.email}</span>
                  <small>
                    {member.lastSignIn
                      ? `آخرین ورود: ${new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(member.lastSignIn))}`
                      : "هنوز وارد نشده"}
                  </small>
                </div>
                <form action={changePassword} className={styles.inline}>
                  <input type="hidden" name="user_id" value={member.user_id as string} />
                  <input name="password" type="password" minLength={8} maxLength={72} placeholder="رمز جدید" required />
                  <button className={styles.secondary}>تغییر رمز</button>
                </form>
                <form action={removeMember}>
                  <input type="hidden" name="user_id" value={member.user_id as string} />
                  <button className={styles.danger}>حذف حساب</button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.hint}>هنوز عضوی اضافه نشده است.</p>
        )}
      </section>

      <section className={styles.card}>
        <h2>افزودن منشی</h2>
        <p className={styles.hint}>
          یک حساب جدید ساخته می‌شود. ایمیل و رمز را به منشی بدهید تا از صفحه ورود وارد شود. هر پیامک و تماسی که ثبت
          کند با نام او ذخیره می‌شود.
        </p>
        <form action={addMember} className={styles.form}>
          <label>
            نام
            <input name="display_name" maxLength={60} required placeholder="مثلاً خانم احمدی" />
          </label>
          <label>
            ایمیل
            <input name="email" type="email" dir="ltr" maxLength={120} required />
          </label>
          <label>
            رمز (حداقل ۸ حرف)
            <input name="password" type="password" dir="ltr" minLength={8} maxLength={72} required />
          </label>
          <button className={styles.primary}>ساخت حساب منشی</button>
        </form>
      </section>
    </AppShell>
  );
}
