import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import JalaliDateField from "@/components/jalali-date-field";
import { createClient } from "@/lib/supabase/server";
import {
  allowedMaterialCategories,
  materialCategoryLabels,
} from "@/lib/accounting/constants";
import {
  cleanText,
  formatDate,
  formatDecimal,
  formatMoney,
  parseJalaliFormDate,
  parseOptionalMoney,
} from "@/lib/accounting/format";
import styles from "../accounting.module.css";

async function addMaterial(formData: FormData) {
  "use server";
  const name = cleanText(formData, "name", 140);
  const code = cleanText(formData, "code", 50);
  const category = cleanText(formData, "category", 30) || "raw_material";
  const unit = cleanText(formData, "unit", 30) || "عدد";
  const replacementCost = parseOptionalMoney(formData.get("replacement_cost"));
  const replacementDate = parseJalaliFormDate(formData, "replacement_date", false);
  const notes = cleanText(formData, "notes", 1000);

  if (!name || !allowedMaterialCategories.has(category) || replacementDate === undefined) {
    redirect("/accounting/materials?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert({
    name,
    code: code || null,
    category,
    unit,
    manual_replacement_unit_cost: replacementCost,
    replacement_price_at: replacementCost ? replacementDate : null,
    notes: notes || null,
  });
  if (error) redirect(`/accounting/materials?error=${error.code === "23505" ? "duplicate" : "save"}`);
  revalidatePath("/accounting/materials");
  revalidatePath("/accounting/pricing");
  redirect("/accounting/materials?saved=material");
}

async function updateReplacement(formData: FormData) {
  "use server";
  const id = cleanText(formData, "material_id", 80);
  const cost = parseOptionalMoney(formData.get("replacement_cost"));
  const date = parseJalaliFormDate(formData, "replacement_date", true);
  if (!id || cost == null || !date) redirect("/accounting/materials?error=invalid-price");

  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({
    manual_replacement_unit_cost: cost,
    replacement_price_at: date,
  }).eq("id", id);
  if (error) redirect("/accounting/materials?error=save");
  revalidatePath("/accounting/materials");
  revalidatePath("/accounting/pricing");
  redirect("/accounting/materials?saved=price");
}

type MaterialRow = {
  id: string;
  name: string;
  code: string | null;
  category: string;
  unit: string;
  latest_unit_cost: number | string | null;
  weighted_avg_unit_cost: number | string | null;
  replacement_unit_cost: number | string | null;
  latest_purchase_date: string | null;
  replacement_price_at: string | null;
  purchase_count: number | string | null;
  latest_change_percent: number | string | null;
};

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.from("material_cost_summary").select("id,name,code,category,unit,latest_unit_cost,weighted_avg_unit_cost,replacement_unit_cost,latest_purchase_date,replacement_price_at,purchase_count,latest_change_percent").eq("is_active", true).order("name"),
    supabase.from("costing_settings").select("stale_price_days").maybeSingle(),
  ]);
  const rows = (data ?? []) as MaterialRow[];
  const staleDays = Number(settings?.stale_price_days ?? 30);
  const now = Date.now();
  const staleCount = rows.filter((row) => {
    const date = row.replacement_price_at || row.latest_purchase_date;
    if (!date || !Number(row.replacement_unit_cost ?? 0)) return true;
    return (now - new Date(`${date}T12:00:00+03:30`).getTime()) / 86400000 > staleDays;
  }).length;

  const message = params.error === "invalid" ? "اطلاعات ماده یا تاریخ معتبر نیست." : params.error === "duplicate" ? "این نام یا کد قبلاً ثبت شده است." : params.error === "invalid-price" ? "قیمت و تاریخ جایگزینی را کامل وارد کن." : params.error ? "ذخیره اطلاعات انجام نشد." : null;

  return (
    <AppShell active="accounting" title="مواد اولیه و قیمت خرید" subtitle="آخرین خرید، میانگین موزون و هزینه جایگزینی امروز را برای هر ماده نگه دار.">
      <AccountingNav active="materials" />
      {error ? <div className={styles.alert}>خواندن مواد با خطا روبه‌رو شد: {error.message}</div> : null}
      {message ? <div className={styles.alert}>{message}</div> : null}
      {params.saved ? <div className={styles.success}>اطلاعات با موفقیت ذخیره شد.</div> : null}
      {staleCount ? <div className={styles.warning}>{staleCount.toLocaleString("fa-IR")} ماده قیمت جایگزینی معتبر ندارند یا قیمت آن‌ها قدیمی است.</div> : null}

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>تعریف ماده یا خدمت تولیدی</h2><p>پارچه، رول ملحفه، کیف خام، دوخت، چاپ و بسته‌بندی را می‌توانی جدا ثبت کنی.</p></div></header>
          <form action={addMaterial} className={styles.form}>
            <div className={styles.formGrid2}>
              <label>نام ماده<input name="name" required placeholder="مثلاً پارچه پد فرانسوی" /></label>
              <label>کد اختیاری<input name="code" placeholder="مثلاً PAD-FR-FABRIC" dir="ltr" /></label>
              <label>گروه<select name="category" defaultValue="raw_material">{Object.entries(materialCategoryLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label>واحد<input name="unit" defaultValue="متر" placeholder="متر، کیلو، عدد، جفت..." /></label>
              <label>قیمت جایگزینی فعلی<input name="replacement_cost" inputMode="decimal" placeholder="اختیاری" /></label>
            </div>
            <JalaliDateField namePrefix="replacement_date" label="تاریخ قیمت جایگزینی" required={false} />
            <label>یادداشت<textarea name="notes" placeholder="تأمین‌کننده، کیفیت، عرض رول یا نکته مهم" /></label>
            <div className={styles.actionRow}><button className={styles.submitButton}>ثبت ماده</button></div>
          </form>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>منطق سه قیمت</h2><p>هر عدد برای یک تصمیم متفاوت استفاده می‌شود.</p></div></header>
          <div className={styles.list}>
            <div className={styles.listItem}><div><strong>آخرین قیمت واقعی خرید</strong><small>مبلغ مؤثر آخرین فاکتور، با سهم حمل و هزینه‌های جانبی.</small></div></div>
            <div className={styles.listItem}><div><strong>میانگین موزون خرید</strong><small>هزینه متوسط کل خریدهای ثبت‌شده با وزن مقدار خرید.</small></div></div>
            <div className={styles.listItem}><div><strong>قیمت جایگزینی امروز</strong><small>قیمتی که برای خرید دوباره ماده باید بپردازی؛ مبنای اصلی قیمت‌گذاری تورمی.</small></div></div>
          </div>
        </article>
      </section>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>بانک مواد و روند قیمت</h2><p>{rows.length.toLocaleString("fa-IR")} مورد ثبت شده است.</p></div></header>
        {rows.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ماده</th><th>آخرین خرید</th><th>میانگین موزون</th><th>جایگزینی امروز</th><th>تغییر خرید اخیر</th><th>به‌روزرسانی قیمت</th></tr></thead><tbody>{rows.map((row) => {
          const change = row.latest_change_percent == null ? null : Number(row.latest_change_percent);
          return <tr key={row.id}><td><strong>{row.name}</strong><small>{materialCategoryLabels[row.category] ?? row.category} · واحد {row.unit}{row.code ? ` · ${row.code}` : ""}</small></td><td className={styles.numberCell}>{formatMoney(row.latest_unit_cost)}<small>{formatDate(row.latest_purchase_date)} · {formatDecimal(row.purchase_count, 0)} خرید</small></td><td className={styles.numberCell}>{formatMoney(row.weighted_avg_unit_cost)}</td><td className={styles.numberCell}><strong>{formatMoney(row.replacement_unit_cost)}</strong><small>{formatDate(row.replacement_price_at || row.latest_purchase_date)}</small></td><td className={`${styles.numberCell} ${change == null ? styles.neutral : change > 0 ? styles.negative : styles.positive}`}>{change == null ? "—" : `${formatDecimal(Math.abs(change))}٪ ${change > 0 ? "افزایش" : "کاهش"}`}</td><td><form action={updateReplacement} className={styles.inlineForm}><input type="hidden" name="material_id" value={row.id} /><input name="replacement_cost" inputMode="decimal" placeholder="قیمت جدید" required /><JalaliDateField namePrefix="replacement_date" label="تاریخ" /><button className={styles.secondaryButton}>ثبت قیمت روز</button></form></td></tr>;
        })}</tbody></table></div> : <div className={styles.empty}>هنوز ماده‌ای ثبت نشده است.</div>}
      </article>
    </AppShell>
  );
}
