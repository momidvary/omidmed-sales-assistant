import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import AccountingAttachmentUploader, { type AccountingAttachment } from "@/components/accounting-attachment-uploader";
import JalaliDateField from "@/components/jalali-date-field";
import { createClient } from "@/lib/supabase/server";
import {
  allowedCostBehaviors,
  allowedExpenseCategories,
  allowedPaymentMethods,
  costBehaviorLabels,
  expenseCategoryLabels,
  paymentMethodLabels,
} from "@/lib/accounting/constants";
import {
  cleanText,
  formatDate,
  formatMoney,
  parseJalaliFormDate,
  parseMoney,
} from "@/lib/accounting/format";
import styles from "../accounting.module.css";

async function addExpense(formData: FormData) {
  "use server";
  const date = parseJalaliFormDate(formData, "expense_date", true);
  const category = cleanText(formData, "category", 30);
  const behavior = cleanText(formData, "cost_behavior", 20);
  const amount = parseMoney(formData.get("amount"));
  const payee = cleanText(formData, "payee", 140);
  const method = cleanText(formData, "payment_method", 30);
  const description = cleanText(formData, "description", 1200);
  const recurring = formData.get("is_recurring") === "on";

  if (!date || !amount || !allowedExpenseCategories.has(category) || !allowedCostBehaviors.has(behavior) || !allowedPaymentMethods.has(method)) {
    redirect("/accounting/expenses?error=invalid");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("workshop_expenses").insert({
    expense_date: date,
    category,
    cost_behavior: behavior,
    amount,
    payee: payee || null,
    payment_method: method,
    description: description || null,
    is_recurring: recurring,
  });
  if (error) redirect("/accounting/expenses?error=save");
  revalidatePath("/accounting/expenses");
  revalidatePath("/accounting");
  redirect("/accounting/expenses?saved=1");
}

type Expense = {
  id: string;
  expense_date: string;
  category: string;
  cost_behavior: string;
  amount: number | string;
  payee: string | null;
  payment_method: string;
  description: string | null;
  is_recurring: boolean;
};

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [expenseResult, attachmentResult] = await Promise.all([
    supabase.from("workshop_expenses").select("id,expense_date,category,cost_behavior,amount,payee,payment_method,description,is_recurring").order("expense_date", { ascending: false }).limit(100),
    supabase.from("accounting_attachments").select("id,entity_type,entity_id,storage_path,original_name,mime_type,size_bytes,created_at").eq("entity_type", "expense").order("created_at", { ascending: false }).limit(300),
  ]);
  const expenses = (expenseResult.data ?? []) as Expense[];
  const attachments = (attachmentResult.data ?? []) as AccountingAttachment[];
  const attachmentMap = new Map<string, AccountingAttachment[]>();
  for (const file of attachments) attachmentMap.set(file.entity_id, [...(attachmentMap.get(file.entity_id) ?? []), file]);
  const total = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixed = expenses.filter((item) => item.cost_behavior === "fixed").reduce((sum, item) => sum + Number(item.amount), 0);
  const variable = expenses.filter((item) => item.cost_behavior === "variable").reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <AppShell active="accounting" title="هزینه‌های کارگاه" subtitle="هزینه‌هایی را ثبت کن که در فاکتور مواد یا حقوق ماهانه نیستند.">
      <AccountingNav active="expenses" />
      {expenseResult.error ? <div className={styles.alert}>ابتدا SQL مرحله ۱۴ را اجرا کن. جزئیات: {expenseResult.error.message}</div> : null}
      {params.error ? <div className={styles.alert}>{params.error === "invalid" ? "تاریخ، مبلغ یا دسته هزینه معتبر نیست." : "ثبت هزینه انجام نشد."}</div> : null}
      {params.saved ? <div className={styles.success}>هزینه با موفقیت ثبت شد.</div> : null}

      <section className={styles.metrics}>
        <article className={styles.metric}><span>جمع ۱۰۰ هزینه اخیر</span><strong>{formatMoney(total)}</strong><small>برای گزارش دقیق‌تر از بازه‌های داشبورد استفاده می‌شود.</small></article>
        <article className={styles.metric}><span>هزینه ثابت</span><strong>{formatMoney(fixed)}</strong><small>مثل اجاره، نرم‌افزار و بخشی از حقوق</small></article>
        <article className={styles.metric}><span>هزینه متغیر</span><strong>{formatMoney(variable)}</strong><small>مثل چاپ، دوخت، بسته‌بندی و حمل</small></article>
        <article className={styles.metric}><span>هزینه‌های ثبت‌شده</span><strong>{expenses.length.toLocaleString("fa-IR")}</strong><small>آخرین رکوردها</small></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>ثبت هزینه جدید</h2><p>هزینه مستقیم تولید را از هزینه سربار جدا انتخاب کن.</p></div></header>
          <form action={addExpense} className={styles.form}>
            <JalaliDateField namePrefix="expense_date" label="تاریخ هزینه" />
            <div className={styles.formGrid2}>
              <label>دسته هزینه<select name="category" defaultValue="utilities">{Object.entries(expenseCategoryLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label>رفتار هزینه<select name="cost_behavior" defaultValue="fixed">{Object.entries(costBehaviorLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label>مبلغ<input name="amount" inputMode="decimal" required /></label>
              <label>دریافت‌کننده / طرف حساب<input name="payee" placeholder="مثلاً خیاط، چاپخانه یا مالک" /></label>
              <label>روش پرداخت<select name="payment_method" defaultValue="bank_transfer">{Object.entries(paymentMethodLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label style={{ alignContent: "end" }}><span><input type="checkbox" name="is_recurring" style={{ width: "auto", minHeight: 0 }} /> هزینه تکرارشونده ماهانه</span></label>
            </div>
            <label>توضیحات<textarea name="description" placeholder="جزئیات هزینه یا علت پرداخت" /></label>
            <div className={styles.actionRow}><button className={styles.submitButton}>ثبت هزینه</button></div>
          </form>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>قاعده ثبت هزینه</h2><p>برای جلوگیری از دوباره‌شماری، هر هزینه را فقط در یک محل ثبت کن.</p></div></header>
          <div className={styles.list}>
            <div className={styles.listItem}><div><strong>مواد و حمل خرید</strong><small>داخل فاکتور خرید ثبت شود، نه در هزینه‌های کارگاه.</small></div></div>
            <div className={styles.listItem}><div><strong>حقوق هر نیرو</strong><small>در بخش حقوق ثبت شود؛ فقط دستمزد پیمانکاری موردی اینجا ثبت شود.</small></div></div>
            <div className={styles.listItem}><div><strong>اجاره و هزینه عمومی</strong><small>به‌عنوان هزینه ثابت ثبت می‌شود و در سربار واحد سرشکن خواهد شد.</small></div></div>
          </div>
        </article>
      </section>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>آخرین هزینه‌ها</h2><p>رسید یا تصویر پرداخت را کنار هر ردیف بارگذاری کن.</p></div></header>
        {expenses.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>تاریخ</th><th>دسته</th><th>طرف حساب</th><th>مبلغ</th><th>نوع / روش</th><th>توضیح</th><th>رسید</th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td>{formatDate(expense.expense_date)}</td><td><strong>{expenseCategoryLabels[expense.category] ?? expense.category}</strong><small>{expense.is_recurring ? "تکرارشونده" : "موردی"}</small></td><td>{expense.payee || "—"}</td><td className={styles.numberCell}><strong>{formatMoney(expense.amount)}</strong></td><td>{costBehaviorLabels[expense.cost_behavior]}<small>{paymentMethodLabels[expense.payment_method]}</small></td><td>{expense.description || "—"}</td><td><AccountingAttachmentUploader entityType="expense" entityId={expense.id} initialFiles={attachmentMap.get(expense.id) ?? []} /></td></tr>)}</tbody></table></div> : <div className={styles.empty}>هنوز هزینه‌ای ثبت نشده است.</div>}
      </article>
    </AppShell>
  );
}
