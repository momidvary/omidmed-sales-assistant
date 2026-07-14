import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { createClient } from "@/lib/supabase/server";
import {
  cleanText,
  formatMoney,
  parseInteger,
  parseMoney,
} from "@/lib/accounting/format";
import { getCurrentJalaliDate } from "@/lib/jalali";
import styles from "../accounting.module.css";

async function addEmployee(formData: FormData) {
  "use server";
  const name = cleanText(formData, "name", 120);
  const roleTitle = cleanText(formData, "role_title", 100);
  const phone = cleanText(formData, "phone", 30);
  const baseSalary = parseMoney(formData.get("monthly_base_salary"));
  const notes = cleanText(formData, "notes", 800);
  if (!name) redirect("/accounting/payroll?error=employee-invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({
    name,
    role_title: roleTitle || null,
    phone: phone || null,
    monthly_base_salary: baseSalary,
    notes: notes || null,
  });
  if (error) redirect(`/accounting/payroll?error=${error.code === "23505" ? "employee-duplicate" : "employee-save"}`);
  revalidatePath("/accounting/payroll");
  redirect("/accounting/payroll?saved=employee");
}

async function addPayroll(formData: FormData) {
  "use server";
  const employeeId = cleanText(formData, "employee_id", 80);
  const year = parseInteger(formData.get("jalali_year"));
  const month = parseInteger(formData.get("jalali_month"));
  const base = parseMoney(formData.get("base_salary"));
  const overtime = parseMoney(formData.get("overtime_amount"));
  const bonus = parseMoney(formData.get("bonus_amount"));
  const allowance = parseMoney(formData.get("allowance_amount"));
  const employer = parseMoney(formData.get("employer_costs"));
  const advance = parseMoney(formData.get("advance_amount"));
  const deductions = parseMoney(formData.get("deductions_amount"));
  const paid = parseMoney(formData.get("paid_amount"));
  const notes = cleanText(formData, "notes", 1000);
  const net = Math.max(0, base + overtime + bonus + allowance - advance - deductions);
  const status = paid <= 0 ? "unpaid" : paid >= net ? "paid" : "partial";

  if (!employeeId || year < 1300 || year > 1700 || month < 1 || month > 12) {
    redirect("/accounting/payroll?error=payroll-invalid");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_entries").upsert({
    employee_id: employeeId,
    jalali_year: year,
    jalali_month: month,
    base_salary: base,
    overtime_amount: overtime,
    bonus_amount: bonus,
    allowance_amount: allowance,
    employer_costs: employer,
    advance_amount: advance,
    deductions_amount: deductions,
    net_pay: net,
    paid_amount: paid,
    status,
    paid_at: paid > 0 ? new Date().toISOString().slice(0, 10) : null,
    notes: notes || null,
  }, { onConflict: "owner_id,employee_id,jalali_year,jalali_month" });
  if (error) redirect("/accounting/payroll?error=payroll-save");
  revalidatePath("/accounting/payroll");
  revalidatePath("/accounting");
  redirect("/accounting/payroll?saved=payroll");
}

type Employee = {
  id: string;
  name: string;
  role_title: string | null;
  monthly_base_salary: number | string;
};

type Payroll = {
  id: string;
  employee_id: string;
  jalali_year: number;
  jalali_month: number;
  base_salary: number | string;
  overtime_amount: number | string;
  bonus_amount: number | string;
  allowance_amount: number | string;
  employer_costs: number | string;
  advance_amount: number | string;
  deductions_amount: number | string;
  net_pay: number | string;
  paid_amount: number | string;
  status: string;
  employee: { name: string; role_title: string | null } | null;
};

const monthNames = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const params = await searchParams;
  const current = getCurrentJalaliDate();
  const supabase = await createClient();
  const [employeeResult, payrollResult] = await Promise.all([
    supabase.from("employees").select("id,name,role_title,monthly_base_salary").eq("is_active", true).order("name"),
    supabase.from("payroll_entries").select("id,employee_id,jalali_year,jalali_month,base_salary,overtime_amount,bonus_amount,allowance_amount,employer_costs,advance_amount,deductions_amount,net_pay,paid_amount,status,employee:employees(name,role_title)").order("jalali_year", { ascending: false }).order("jalali_month", { ascending: false }).limit(100),
  ]);
  const employees = (employeeResult.data ?? []) as Employee[];
  const payroll = (payrollResult.data ?? []) as unknown as Payroll[];
  const currentRows = payroll.filter((row) => row.jalali_year === current.year && row.jalali_month === current.month);
  const currentNet = currentRows.reduce((sum, row) => sum + Number(row.net_pay), 0);
  const currentEmployer = currentRows.reduce((sum, row) => sum + Number(row.employer_costs), 0);
  const currentPaid = currentRows.reduce((sum, row) => sum + Number(row.paid_amount), 0);

  const errorMessage = params.error === "employee-invalid" ? "نام نیرو الزامی است." : params.error === "employee-duplicate" ? "این نیرو قبلاً ثبت شده است." : params.error === "payroll-invalid" ? "دوره و نیرو را کامل انتخاب کن." : params.error ? "ذخیره اطلاعات حقوق انجام نشد." : null;

  return (
    <AppShell active="accounting" title="حقوق و دستمزد" subtitle="هزینه واقعی نیروی انسانی را از مبلغ پرداختی و مساعده جدا نگه دار.">
      <AccountingNav active="payroll" />
      {(employeeResult.error || payrollResult.error) ? <div className={styles.alert}>ابتدا SQL مرحله ۱۴ را اجرا کن.</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {params.saved ? <div className={styles.success}>اطلاعات با موفقیت ذخیره شد.</div> : null}

      <section className={styles.metrics}>
        <article className={styles.metric}><span>خالص حقوق این ماه</span><strong>{formatMoney(currentNet)}</strong><small>{currentRows.length.toLocaleString("fa-IR")} نیروی ثبت‌شده</small></article>
        <article className={styles.metric}><span>هزینه کارفرما</span><strong>{formatMoney(currentEmployer)}</strong><small>بیمه، مزایا و هزینه‌های خارج از خالص پرداختی</small></article>
        <article className={styles.metric}><span>پرداخت‌شده این ماه</span><strong>{formatMoney(currentPaid)}</strong><small>مبلغ واقعی پرداختی ثبت‌شده</small></article>
        <article className={styles.metric}><span>مانده حقوق</span><strong>{formatMoney(Math.max(0, currentNet - currentPaid))}</strong><small>برای کنترل نقدینگی پایان ماه</small></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>ثبت نیروی کارگاه</h2><p>حقوق پایه فقط مقدار پیش‌فرض فرم ماهانه است.</p></div></header>
          <form action={addEmployee} className={styles.form}>
            <div className={styles.formGrid2}>
              <label>نام و نام خانوادگی<input name="name" required /></label>
              <label>سمت<input name="role_title" placeholder="تولید، چاپ، فروش..." /></label>
              <label>شماره تماس<input name="phone" dir="ltr" /></label>
              <label>حقوق پایه ماهانه<input name="monthly_base_salary" inputMode="decimal" defaultValue="0" /></label>
            </div>
            <label>یادداشت<textarea name="notes" /></label>
            <div className={styles.actionRow}><button className={styles.submitButton}>ثبت نیرو</button></div>
          </form>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>ثبت یا اصلاح حقوق ماهانه</h2><p>ثبت دوباره همان نیرو و همان ماه، رکورد را به‌روزرسانی می‌کند.</p></div></header>
          {employees.length ? <form action={addPayroll} className={styles.form}>
            <div className={styles.formGrid2}>
              <label>نیرو<select name="employee_id" required>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} {employee.role_title ? `— ${employee.role_title}` : ""}</option>)}</select></label>
              <label>سال<select name="jalali_year" defaultValue={current.year}>{Array.from({ length: 4 }, (_, index) => current.year - 2 + index).reverse().map((year) => <option value={year} key={year}>{year.toLocaleString("fa-IR", { useGrouping: false })}</option>)}</select></label>
              <label>ماه<select name="jalali_month" defaultValue={current.month}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
              <label>حقوق پایه<input name="base_salary" inputMode="decimal" defaultValue={String(employees[0]?.monthly_base_salary ?? 0)} /></label>
              <label>اضافه‌کاری<input name="overtime_amount" inputMode="decimal" defaultValue="0" /></label>
              <label>پاداش<input name="bonus_amount" inputMode="decimal" defaultValue="0" /></label>
              <label>مزایا<input name="allowance_amount" inputMode="decimal" defaultValue="0" /></label>
              <label>هزینه کارفرما<input name="employer_costs" inputMode="decimal" defaultValue="0" /></label>
              <label>مساعده<input name="advance_amount" inputMode="decimal" defaultValue="0" /></label>
              <label>کسورات<input name="deductions_amount" inputMode="decimal" defaultValue="0" /></label>
              <label>مبلغ پرداخت‌شده<input name="paid_amount" inputMode="decimal" defaultValue="0" /></label>
            </div>
            <label>یادداشت<textarea name="notes" /></label>
            <div className={styles.actionRow}><button className={styles.submitButton}>ذخیره حقوق ماه</button></div>
          </form> : <div className={styles.empty}>ابتدا یک نیرو ثبت کن.</div>}
        </article>
      </section>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>سوابق حقوق</h2><p>خالص حقوق با کسر مساعده و کسورات محاسبه می‌شود.</p></div></header>
        {payroll.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>نیرو</th><th>دوره</th><th>پایه</th><th>اضافه و مزایا</th><th>مساعده و کسورات</th><th>خالص</th><th>پرداخت‌شده</th><th>وضعیت</th></tr></thead><tbody>{payroll.map((row) => <tr key={row.id}><td><strong>{row.employee?.name ?? "نامشخص"}</strong><small>{row.employee?.role_title || ""}</small></td><td>{monthNames[row.jalali_month - 1]} {row.jalali_year.toLocaleString("fa-IR", { useGrouping: false })}</td><td className={styles.numberCell}>{formatMoney(row.base_salary)}</td><td className={styles.numberCell}>{formatMoney(Number(row.overtime_amount) + Number(row.bonus_amount) + Number(row.allowance_amount))}<small>هزینه کارفرما: {formatMoney(row.employer_costs)}</small></td><td className={styles.numberCell}>{formatMoney(Number(row.advance_amount) + Number(row.deductions_amount))}</td><td className={styles.numberCell}><strong>{formatMoney(row.net_pay)}</strong></td><td className={styles.numberCell}>{formatMoney(row.paid_amount)}</td><td><span className={styles.status}>{row.status === "paid" ? "تسویه" : row.status === "partial" ? "ناقص" : "پرداخت نشده"}</span></td></tr>)}</tbody></table></div> : <div className={styles.empty}>هنوز حقوقی ثبت نشده است.</div>}
      </article>
    </AppShell>
  );
}
