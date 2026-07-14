import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { createClient } from "@/lib/supabase/server";
import {
  calculateProductPricing,
  type CostingProduct,
  type CostingSettings,
  type MaterialCost,
  type ProductMaterial,
} from "@/lib/accounting/calculations";
import {
  cleanText,
  currentJalaliMonthRange,
  formatDate,
  formatDecimal,
  formatMoney,
  parseInteger,
  parseMoney,
  parseOptionalMoney,
} from "@/lib/accounting/format";
import { productCategoryLabels } from "@/lib/accounting/constants";
import styles from "../accounting.module.css";

const defaultSettings: CostingSettings = {
  monthly_fixed_overhead: 0,
  overhead_mode: "actual_current_month",
  include_payroll_in_overhead: true,
  planned_monthly_output: 1,
  default_min_margin: 10,
  default_cash_margin: 30,
  default_wholesale_margin: 20,
  default_festival_margin: 15,
  default_credit_monthly_rate: 3,
  inflation_buffer_percent: 10,
  stale_price_days: 30,
  rounding_step: 1000,
};

async function saveSettings(formData: FormData) {
  "use server";
  const monthlyFixedOverhead = parseMoney(formData.get("monthly_fixed_overhead"));
  const overheadMode = cleanText(formData, "overhead_mode", 30) || "actual_current_month";
  const includePayroll = formData.get("include_payroll_in_overhead") === "on";
  const plannedOutput = parseOptionalMoney(formData.get("planned_monthly_output"));
  const minMargin = parseOptionalMoney(formData.get("default_min_margin"));
  const cashMargin = parseOptionalMoney(formData.get("default_cash_margin"));
  const wholesaleMargin = parseOptionalMoney(formData.get("default_wholesale_margin"));
  const festivalMargin = parseOptionalMoney(formData.get("default_festival_margin"));
  const creditRate = parseOptionalMoney(formData.get("default_credit_monthly_rate"));
  const inflationBuffer = parseOptionalMoney(formData.get("inflation_buffer_percent"));
  const staleDays = parseInteger(formData.get("stale_price_days"), 30);
  const roundingStep = parseMoney(formData.get("rounding_step"), 1000);

  const margins = [minMargin, cashMargin, wholesaleMargin, festivalMargin];
  if (
    !new Set(["actual_current_month", "manual"]).has(overheadMode) ||
    plannedOutput == null || plannedOutput <= 0 ||
    margins.some((value) => value == null || value < 0 || value >= 95) ||
    creditRate == null || creditRate < 0 || creditRate > 100 ||
    inflationBuffer == null || inflationBuffer < 0 || inflationBuffer > 300 ||
    staleDays < 1 || staleDays > 3650 || roundingStep <= 0
  ) {
    redirect("/accounting/pricing?error=settings-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const { error } = await supabase.from("costing_settings").upsert({
    owner_id: userData.user.id,
    monthly_fixed_overhead: monthlyFixedOverhead,
    overhead_mode: overheadMode,
    include_payroll_in_overhead: includePayroll,
    planned_monthly_output: plannedOutput,
    default_min_margin: minMargin,
    default_cash_margin: cashMargin,
    default_wholesale_margin: wholesaleMargin,
    default_festival_margin: festivalMargin,
    default_credit_monthly_rate: creditRate,
    inflation_buffer_percent: inflationBuffer,
    stale_price_days: staleDays,
    rounding_step: roundingStep,
  });
  if (error) redirect("/accounting/pricing?error=settings-save");
  revalidatePath("/accounting/pricing");
  revalidatePath("/accounting");
  redirect("/accounting/pricing?saved=settings");
}

async function savePriceDecision(formData: FormData) {
  "use server";
  const productId = cleanText(formData, "product_id", 80);
  const intent = cleanText(formData, "intent", 30) || "snapshot";
  const values = {
    historical_cost: parseMoney(formData.get("historical_cost")),
    weighted_average_cost: parseMoney(formData.get("weighted_average_cost")),
    replacement_cost: parseMoney(formData.get("replacement_cost")),
    protected_cost: parseMoney(formData.get("protected_cost")),
    minimum_safe_price: parseMoney(formData.get("minimum_safe_price")),
    cash_price: parseMoney(formData.get("cash_price")),
    wholesale_price: parseMoney(formData.get("wholesale_price")),
    festival_price: parseMoney(formData.get("festival_price")),
    credit_price: parseMoney(formData.get("credit_price")),
  };
  if (!productId || !values.cash_price) redirect("/accounting/pricing?error=snapshot-invalid");

  const supabase = await createClient();
  const { error } = await supabase.from("price_snapshots").insert({
    product_id: productId,
    ...values,
    settings: {
      source: "management_pricing",
      saved_as_current: intent === "apply",
    },
  });
  if (error) redirect("/accounting/pricing?error=snapshot-save");

  if (intent === "apply") {
    const { error: updateError } = await supabase.from("costing_products").update({
      current_cash_price: values.cash_price,
    }).eq("id", productId);
    if (updateError) redirect("/accounting/pricing?error=current-save");
  }

  revalidatePath("/accounting/pricing");
  revalidatePath("/accounting/products");
  redirect(`/accounting/pricing?saved=${intent}`);
}

type Snapshot = {
  product_id: string;
  snapshot_date: string;
  cash_price: number | string;
  created_at: string;
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const currentRange = currentJalaliMonthRange();
  const [settingsResult, productsResult, componentsResult, materialsResult, snapshotsResult, expenseResult, payrollResult] = await Promise.all([
    supabase.from("costing_settings").select("monthly_fixed_overhead,overhead_mode,include_payroll_in_overhead,planned_monthly_output,default_min_margin,default_cash_margin,default_wholesale_margin,default_festival_margin,default_credit_monthly_rate,inflation_buffer_percent,stale_price_days,rounding_step").maybeSingle(),
    supabase.from("costing_products").select("id,name,sku,category,unit,direct_labor_per_unit,packaging_per_unit,other_variable_per_unit,overhead_per_unit_override,min_margin,cash_margin,wholesale_margin,festival_margin,credit_days,credit_monthly_rate,current_cash_price").eq("is_active", true).order("name"),
    supabase.from("product_materials").select("product_id,material_id,quantity_per_unit,waste_percent").limit(5000),
    supabase.from("material_cost_summary").select("id,name,unit,latest_unit_cost,weighted_avg_unit_cost,replacement_unit_cost,latest_purchase_date,replacement_price_at").eq("is_active", true).limit(5000),
    supabase.from("price_snapshots").select("product_id,snapshot_date,cash_price,created_at").order("created_at", { ascending: false }).limit(1000),
    supabase.from("workshop_expenses").select("amount,cost_behavior").gte("expense_date", currentRange.from).lt("expense_date", currentRange.toExclusive),
    supabase.from("payroll_entries").select("net_pay,employer_costs").eq("jalali_year", currentRange.year).eq("jalali_month", currentRange.month),
  ]);

  const rawSettings = (settingsResult.data ?? defaultSettings) as CostingSettings;
  const currentFixedExpenses = (expenseResult.data ?? []).filter((item) => item.cost_behavior !== "variable").reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const currentPayrollCost = (payrollResult.data ?? []).reduce((sum, item) => sum + Number(item.net_pay ?? 0) + Number(item.employer_costs ?? 0), 0);
  const actualMonthlyOverhead = currentFixedExpenses + (rawSettings.include_payroll_in_overhead === false ? 0 : currentPayrollCost);
  const settings: CostingSettings = {
    ...rawSettings,
    monthly_fixed_overhead: rawSettings.overhead_mode === "manual" ? rawSettings.monthly_fixed_overhead : actualMonthlyOverhead,
  };
  const products = (productsResult.data ?? []) as CostingProduct[];
  const components = (componentsResult.data ?? []) as ProductMaterial[];
  const materials = (materialsResult.data ?? []) as MaterialCost[];
  const snapshots = (snapshotsResult.data ?? []) as Snapshot[];
  const materialMap = new Map(materials.map((item) => [item.id, item]));
  const componentMap = new Map<string, ProductMaterial[]>();
  for (const component of components) componentMap.set(component.product_id, [...(componentMap.get(component.product_id) ?? []), component]);
  const latestSnapshotMap = new Map<string, Snapshot>();
  for (const snapshot of snapshots) if (!latestSnapshotMap.has(snapshot.product_id)) latestSnapshotMap.set(snapshot.product_id, snapshot);

  const calculations = products.map((product) => ({
    product,
    result: calculateProductPricing({
      product,
      components: componentMap.get(product.id) ?? [],
      materialMap,
      settings,
    }),
  }));
  const unsafeCurrentCount = calculations.filter(({ result }) => result.currentCashPrice > 0 && result.currentCashPrice < result.minimumSafePrice).length;
  const missingCostCount = calculations.filter(({ result }) => result.missingMaterials.length).length;
  const averageRecommended = calculations.length ? calculations.reduce((sum, item) => sum + item.result.cashPrice, 0) / calculations.length : 0;

  const databaseError = settingsResult.error || productsResult.error || componentsResult.error || materialsResult.error || expenseResult.error || payrollResult.error;
  const errorMessage = params.error === "settings-invalid" ? "تنظیمات قیمت‌گذاری معتبر نیست. حاشیه‌ها باید کمتر از ۹۵٪ باشند." : params.error?.startsWith("settings") ? "ذخیره تنظیمات انجام نشد." : params.error?.startsWith("snapshot") ? "ثبت تاریخچه قیمت انجام نشد." : params.error === "current-save" ? "تاریخچه ثبت شد، اما قیمت فعلی محصول تغییر نکرد." : null;

  return (
    <AppShell active="accounting" title="قیمت‌گذاری و بهای تمام‌شده" subtitle="پیشنهاد قیمت بر پایه هزینه جایگزینی، سربار، تورم و حاشیه سود هدف محاسبه می‌شود.">
      <AccountingNav active="pricing" />
      {databaseError ? <div className={styles.alert}>ابتدا SQL مرحله ۱۴ را اجرا کن. جزئیات: {databaseError.message}</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {params.saved ? <div className={styles.success}>{params.saved === "settings" ? "تنظیمات قیمت‌گذاری ذخیره شد." : params.saved === "apply" ? "قیمت پیشنهادی در تاریخچه ثبت و به‌عنوان قیمت نقدی فعلی اعمال شد." : "پیشنهاد قیمت در تاریخچه ذخیره شد."}</div> : null}

      <section className={styles.metrics}>
        <article className={styles.metric}><span>محصولات قیمت‌گذاری‌شده</span><strong>{products.length.toLocaleString("fa-IR")}</strong><small>دارای فرمول ساخت</small></article>
        <article className={styles.metric}><span>قیمت فعلی زیر حد امن</span><strong className={unsafeCurrentCount ? styles.negative : styles.positive}>{unsafeCurrentCount.toLocaleString("fa-IR")}</strong><small>نیازمند اصلاح سریع</small></article>
        <article className={styles.metric}><span>محصول با هزینه ناقص</span><strong>{missingCostCount.toLocaleString("fa-IR")}</strong><small>ماده‌ای بدون قیمت جایگزینی دارد</small></article>
        <article className={styles.metric}><span>میانگین قیمت نقدی پیشنهادی</span><strong>{formatMoney(averageRecommended)}</strong><small>فقط یک شاخص کلی؛ تصمیم نهایی محصولی است</small></article>
      </section>

      <article className={`${styles.panel} ${styles.panelWide}`}>
        <header className={styles.panelHeader}><div><h2>تنظیمات عمومی بهای تمام‌شده</h2><p>هزینه ثابت ماهانه روی تعداد واحد تولید برنامه‌ریزی‌شده سرشکن می‌شود. هزینه ثبت‌شده ماه جاری: {formatMoney(actualMonthlyOverhead)}</p></div></header>
        <form action={saveSettings} className={styles.form}>
          <div className={styles.formGrid}>
            <label>منبع سربار<select name="overhead_mode" defaultValue={String(rawSettings.overhead_mode ?? "actual_current_month")}><option value="actual_current_month">خودکار از هزینه‌ها و حقوق ماه جاری</option><option value="manual">عدد دستی</option></select></label>
            <label>سربار ثابت دستی<input name="monthly_fixed_overhead" inputMode="decimal" defaultValue={String(rawSettings.monthly_fixed_overhead)} /></label>
            <label style={{ alignContent: "end" }}><span><input type="checkbox" name="include_payroll_in_overhead" defaultChecked={rawSettings.include_payroll_in_overhead !== false} style={{ width: "auto", minHeight: 0 }} /> حقوق در سربار خودکار لحاظ شود</span></label>
            <label>تعداد واحد تولید برنامه‌ریزی‌شده<input name="planned_monthly_output" inputMode="decimal" defaultValue={String(settings.planned_monthly_output)} /></label>
            <label>حداقل حاشیه امن، درصد<input name="default_min_margin" inputMode="decimal" defaultValue={String(settings.default_min_margin)} /></label>
            <label>حاشیه نقدی هدف، درصد<input name="default_cash_margin" inputMode="decimal" defaultValue={String(settings.default_cash_margin)} /></label>
            <label>حاشیه عمده، درصد<input name="default_wholesale_margin" inputMode="decimal" defaultValue={String(settings.default_wholesale_margin)} /></label>
            <label>حاشیه جشنواره، درصد<input name="default_festival_margin" inputMode="decimal" defaultValue={String(settings.default_festival_margin)} /></label>
            <label>هزینه اعتبار ماهانه، درصد<input name="default_credit_monthly_rate" inputMode="decimal" defaultValue={String(settings.default_credit_monthly_rate)} /></label>
            <label>حاشیه محافظ تورم، درصد<input name="inflation_buffer_percent" inputMode="decimal" defaultValue={String(settings.inflation_buffer_percent)} /></label>
            <label>حداکثر عمر معتبر قیمت ماده، روز<input name="stale_price_days" inputMode="numeric" defaultValue={String(settings.stale_price_days)} /></label>
            <label>گرد کردن قیمت به مضرب<input name="rounding_step" inputMode="decimal" defaultValue={String(settings.rounding_step)} /></label>
          </div>
          <div className={styles.warning}>«حاشیه سود ۳۰٪» یعنی سود ۳۰٪ از قیمت فروش؛ به همین دلیل فرمول قیمت برابر هزینه ÷ ۰٫۷۰ است، نه هزینه × ۱٫۳۰.</div>
          <div className={styles.actionRow}><button className={styles.submitButton}>ذخیره تنظیمات</button></div>
        </form>
      </article>

      <section style={{ marginTop: 17 }}>
        {calculations.length ? calculations.map(({ product, result }) => {
          const latestSnapshot = latestSnapshotMap.get(product.id);
          const isUnsafe = result.currentCashPrice > 0 && result.currentCashPrice < result.minimumSafePrice;
          return (
            <article className={styles.productCard} key={product.id}>
              <div className={styles.productHead}>
                <div><h3>{product.name}</h3><p>{productCategoryLabels[product.category] ?? product.category} · واحد {product.unit}{product.sku ? ` · ${product.sku}` : ""}</p></div>
                <div><span className={styles.badge}>قیمت فعلی: {result.currentCashPrice ? formatMoney(result.currentCashPrice) : "ثبت نشده"}</span>{latestSnapshot ? <small style={{ display: "block", marginTop: 5, color: "#7b8e8a" }}>آخرین ثبت: {formatDate(latestSnapshot.snapshot_date)}</small> : null}</div>
              </div>

              {result.missingMaterials.length ? <div className={styles.alert}>قیمت جایگزینی این مواد کامل نیست: {result.missingMaterials.join("، ")}</div> : null}
              {isUnsafe ? <div className={styles.alert}>قیمت نقدی فعلی از حداقل قیمت امن پایین‌تر است. حاشیه واقعی فعلی حدود {formatDecimal(result.currentMargin)}٪ است.</div> : null}

              <div className={styles.costBreakdown}>
                <div><span>بهای تاریخی</span><strong>{formatMoney(result.historicalCost)}</strong></div>
                <div><span>بهای میانگین موزون</span><strong>{formatMoney(result.weightedAverageCost)}</strong></div>
                <div><span>بهای جایگزینی امروز</span><strong>{formatMoney(result.replacementCost)}</strong></div>
                <div><span>هزینه محافظت‌شده با تورم</span><strong>{formatMoney(result.protectedCost)}</strong></div>
              </div>

              <div className={styles.priceGrid}>
                <div className={`${styles.priceBox} ${styles.priceDanger}`}><span>حداقل قیمت امن</span><strong>{formatMoney(result.minimumSafePrice)}</strong><small>فروش پایین‌تر نیاز به تصمیم آگاهانه دارد</small></div>
                <div className={`${styles.priceBox} ${styles.pricePrimary}`}><span>قیمت نقدی پیشنهادی</span><strong>{formatMoney(result.cashPrice)}</strong><small>حاشیه هدف {formatDecimal(result.margins.cash)}٪</small></div>
                <div className={styles.priceBox}><span>قیمت عمده</span><strong>{formatMoney(result.wholesalePrice)}</strong><small>حاشیه {formatDecimal(result.margins.wholesale)}٪</small></div>
                <div className={styles.priceBox}><span>کف جشنواره</span><strong>{formatMoney(result.festivalPrice)}</strong><small>حاشیه {formatDecimal(result.margins.festival)}٪</small></div>
                <div className={styles.priceBox}><span>فروش اعتباری</span><strong>{formatMoney(result.creditPrice)}</strong><small>{formatDecimal(result.margins.creditDays, 0)} روز با نرخ ماهانه {formatDecimal(result.margins.creditMonthlyRate)}٪</small></div>
              </div>

              <div className={styles.costBreakdown}>
                <div><span>مواد جایگزینی</span><strong>{formatMoney(result.replacementMaterialCost)}</strong></div>
                <div><span>دستمزد مستقیم</span><strong>{formatMoney(result.directLabor)}</strong></div>
                <div><span>بسته‌بندی و متغیر</span><strong>{formatMoney(result.packaging + result.otherVariable)}</strong></div>
                <div><span>سهم سربار واحد</span><strong>{formatMoney(result.overhead)}</strong></div>
              </div>

              <form action={savePriceDecision} className={styles.actionRow}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="historical_cost" value={Math.round(result.historicalCost)} />
                <input type="hidden" name="weighted_average_cost" value={Math.round(result.weightedAverageCost)} />
                <input type="hidden" name="replacement_cost" value={Math.round(result.replacementCost)} />
                <input type="hidden" name="protected_cost" value={Math.round(result.protectedCost)} />
                <input type="hidden" name="minimum_safe_price" value={Math.round(result.minimumSafePrice)} />
                <input type="hidden" name="cash_price" value={Math.round(result.cashPrice)} />
                <input type="hidden" name="wholesale_price" value={Math.round(result.wholesalePrice)} />
                <input type="hidden" name="festival_price" value={Math.round(result.festivalPrice)} />
                <input type="hidden" name="credit_price" value={Math.round(result.creditPrice)} />
                <button className={styles.secondaryButton} name="intent" value="snapshot">فقط ثبت در تاریخچه</button>
                <button className={styles.submitButton} name="intent" value="apply">تأیید و ثبت به‌عنوان قیمت نقدی فعلی</button>
              </form>
            </article>
          );
        }) : <div className={styles.empty}>ابتدا در بخش «فرمول محصولات» حداقل یک محصول تعریف کن.</div>}
      </section>
    </AppShell>
  );
}
