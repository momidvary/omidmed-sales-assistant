import Link from "next/link";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { createClient } from "@/lib/supabase/server";
import { currentJalaliMonthRange, formatMoney } from "@/lib/accounting/format";
import styles from "./accounting.module.css";

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function AccountingPage() {
  const supabase = await createClient();
  const range = currentJalaliMonthRange();

  const [purchasesResult, expensesResult, payrollResult, materialsResult, productsResult, settingsResult] = await Promise.all([
    supabase.from("purchase_invoice_balances").select("id,total_amount,paid_amount,outstanding_amount,derived_payment_status,invoice_date").gte("invoice_date", range.from).lt("invoice_date", range.toExclusive),
    supabase.from("workshop_expenses").select("id,amount,category,expense_date").gte("expense_date", range.from).lt("expense_date", range.toExclusive),
    supabase.from("payroll_entry_totals").select("id,gross_pay,calculated_net_pay,total_paid_amount,remaining_amount,labor_cost,status").eq("jalali_year", range.year).eq("jalali_month", range.month),
    supabase.from("material_cost_summary").select("id,name,replacement_unit_cost,latest_purchase_date,replacement_price_at,latest_change_percent").eq("is_active", true),
    supabase.from("costing_products").select("id,name,is_active").eq("is_active", true),
    supabase.from("costing_settings").select("stale_price_days").maybeSingle(),
  ]);

  const missingTableError = purchasesResult.error || expensesResult.error || payrollResult.error || materialsResult.error || productsResult.error;
  const purchases = purchasesResult.data ?? [];
  const expenses = expensesResult.data ?? [];
  const payroll = payrollResult.data ?? [];
  const materials = materialsResult.data ?? [];
  const products = productsResult.data ?? [];
  const staleDays = Number(settingsResult.data?.stale_price_days ?? 30);
  const now = range.generatedAtMs;
  const staleMaterials = materials.filter((item) => {
    const date = item.replacement_price_at || item.latest_purchase_date;
    if (!date || !numeric(item.replacement_unit_cost)) return true;
    const age = Math.floor((now - new Date(`${date}T12:00:00+03:30`).getTime()) / 86400000);
    return age > staleDays;
  });

  const purchaseTotal = purchases.reduce((sum, item) => sum + numeric(item.total_amount), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + numeric(item.amount), 0);
  const payrollCost = payroll.reduce((sum, item) => sum + numeric(item.labor_cost), 0);
  const unpaidPurchases = purchases.reduce((sum, item) => sum + numeric(item.outstanding_amount), 0);

  const modules = [
    { href: "/accounting/materials", eyebrow: "ورودی تولید", title: "مواد اولیه و قیمت جایگزینی", text: "آخرین قیمت خرید، میانگین موزون و قیمت روز مواد را نگه دار.", value: `${materials.length.toLocaleString("fa-IR")} ماده` },
    { href: "/accounting/purchases", eyebrow: "خرید", title: "فاکتورهای خرید", text: "فاکتور تأمین‌کننده، اقلام، حمل و فایل اصل فاکتور را ثبت کن.", value: `${purchases.length.toLocaleString("fa-IR")} فاکتور این ماه` },
    { href: "/accounting/expenses", eyebrow: "کارگاه", title: "هزینه‌های جانبی", text: "اجاره، انرژی، چاپ، دوخت، حمل، تعمیرات و تبلیغات را ثبت کن.", value: formatMoney(expenseTotal) },
    { href: "/accounting/payroll", eyebrow: "نیروی انسانی", title: "حقوق و دستمزد", text: "حقوق، اضافه‌کاری، مساعده و هزینه کارفرما را ماهانه کنترل کن.", value: formatMoney(payrollCost) },
    { href: "/accounting/products", eyebrow: "تولید", title: "فرمول ساخت محصولات", text: "مواد مصرفی و هزینه مستقیم هر پد، ملحفه، کیف و پک را تعریف کن.", value: `${products.length.toLocaleString("fa-IR")} محصول` },
    { href: "/accounting/pricing", eyebrow: "تصمیم‌گیری", title: "قیمت‌گذاری ضدتورمی", text: "بهای تاریخی، میانگین و جایگزینی را ببین و قیمت امن فروش بگیر.", value: staleMaterials.length ? `${staleMaterials.length.toLocaleString("fa-IR")} قیمت نیازمند بازبینی` : "قیمت‌ها به‌روز" },
  ];

  return (
    <AppShell active="accounting" title="حسابداری مدیریتی کارگاه" subtitle="کنترل خرید، هزینه، بهای تمام‌شده و قیمت پیشنهادی فروش؛ هلو همچنان مرجع حسابداری رسمی باقی می‌ماند.">
      <AccountingNav active="overview" />
      {missingTableError ? <div className={styles.alert}>اطلاعات حسابداری کامل در دسترس نیست. شناسه خطا: ACCOUNTING_READ_FAILED</div> : null}

      <section className={styles.hero}>
        <div>
          <span>ماه {range.month.toLocaleString("fa-IR")} سال {range.year.toLocaleString("fa-IR")}</span>
          <h2>فروش بیشتر فقط وقتی ارزش دارد که سود و قدرت جایگزینی موجودی حفظ شود</h2>
          <p>در این بخش هزینه واقعی کارگاه را ثبت می‌کنی تا قیمت فروش بر اساس مواد روز، حقوق، سربار، ضایعات و حاشیه سود هدف محاسبه شود.</p>
        </div>
        <strong>{formatMoney(purchaseTotal + expenseTotal + payrollCost)}</strong>
      </section>

      <section className={styles.metrics}>
        <article className={styles.metric}><span>خرید مواد این ماه</span><strong>{formatMoney(purchaseTotal)}</strong><small>{purchases.length.toLocaleString("fa-IR")} فاکتور ثبت‌شده</small></article>
        <article className={styles.metric}><span>هزینه‌های کارگاه</span><strong>{formatMoney(expenseTotal)}</strong><small>غیر از فاکتور مواد و حقوق</small></article>
        <article className={styles.metric}><span>هزینه نیروی انسانی این ماه</span><strong>{formatMoney(payrollCost)}</strong><small>حقوق ناخالص + هزینه کارفرما؛ مستقل از مساعده و زمان پرداخت</small></article>
        <article className={styles.metric}><span>خریدهای تسویه‌نشده</span><strong>{formatMoney(unpaidPurchases)}</strong><small>برای کنترل نقدینگی و سررسیدها</small></article>
      </section>

      {staleMaterials.length ? <div className={styles.warning}>{staleMaterials.length.toLocaleString("fa-IR")} ماده قیمت روز معتبر ندارند یا قیمتشان بیش از {staleDays.toLocaleString("fa-IR")} روز قدیمی است. قبل از قیمت‌گذاری آن‌ها را به‌روزرسانی کن.</div> : null}

      <section className={styles.moduleGrid}>
        {modules.map((item) => <Link href={item.href} className={styles.moduleCard} key={item.href}><span>{item.eyebrow}</span><h3>{item.title}</h3><p>{item.text}</p><strong>{item.value}</strong></Link>)}
      </section>
    </AppShell>
  );
}
