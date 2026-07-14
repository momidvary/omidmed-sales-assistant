"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "../accounting.module.css";

type Material = { id: string; name: string; unit: string };
type ComponentLine = {
  key: string;
  materialId: string;
  quantity: string;
  wastePercent: string;
  notes: string;
};

const faDigits = "۰۱۲۳۴۵۶۷۸۹";
const arDigits = "٠١٢٣٤٥٦٧٨٩";
function numeric(value: string) {
  const normalized = value
    .replace(/[۰-۹]/g, (digit) => String(faDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arDigits.indexOf(digit)))
    .replace(/[٬,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed ? numeric(trimmed) : null;
}

function emptyLine(materials: Material[]): ComponentLine {
  return {
    key: crypto.randomUUID(),
    materialId: materials[0]?.id ?? "",
    quantity: "1",
    wastePercent: "0",
    notes: "",
  };
}

export default function ProductForm({ materials }: { materials: Material[] }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [components, setComponents] = useState<ComponentLine[]>(() => [emptyLine(materials)]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function patchLine(key: string, patch: Partial<ComponentLine>) {
    setComponents((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!materials.length) return setMessage("ابتدا مواد اولیه را تعریف کن.");
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name || components.some((item) => !item.materialId || numeric(item.quantity) <= 0)) {
      return setMessage("نام محصول و مقدار مواد را کامل کن.");
    }

    setBusy(true);
    const { error } = await supabase.rpc("create_costing_product", {
      p_name: name,
      p_sku: String(data.get("sku") ?? ""),
      p_category: String(data.get("category") ?? "other"),
      p_unit: String(data.get("unit") ?? "عدد"),
      p_direct_labor: numeric(String(data.get("direct_labor") ?? "0")),
      p_packaging: numeric(String(data.get("packaging") ?? "0")),
      p_other_variable: numeric(String(data.get("other_variable") ?? "0")),
      p_overhead_override: optional(String(data.get("overhead_override") ?? "")),
      p_min_margin: optional(String(data.get("min_margin") ?? "")),
      p_cash_margin: optional(String(data.get("cash_margin") ?? "")),
      p_wholesale_margin: optional(String(data.get("wholesale_margin") ?? "")),
      p_festival_margin: optional(String(data.get("festival_margin") ?? "")),
      p_credit_days: numeric(String(data.get("credit_days") ?? "30")),
      p_credit_monthly_rate: optional(String(data.get("credit_monthly_rate") ?? "")),
      p_current_cash_price: optional(String(data.get("current_cash_price") ?? "")),
      p_notes: String(data.get("notes") ?? ""),
      p_components: components.map((item) => ({
        material_id: item.materialId,
        quantity_per_unit: numeric(item.quantity),
        waste_percent: numeric(item.wastePercent),
        notes: item.notes.trim(),
      })),
    });

    if (error) {
      setBusy(false);
      return setMessage(`ثبت محصول انجام نشد: ${error.message}`);
    }
    form.reset();
    setComponents([emptyLine(materials)]);
    setBusy(false);
    setMessage("فرمول محصول با موفقیت ثبت شد.");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label>نام محصول<input name="name" required placeholder="مثلاً پد فرانسوی یکرو چرم" /></label>
        <label>کد محصول<input name="sku" dir="ltr" placeholder="اختیاری" /></label>
        <label>گروه<select name="category" defaultValue="pad"><option value="pad">پد</option><option value="sheet">ملحفه</option><option value="bag">کیف</option><option value="pack">پک کامل</option><option value="strap">استرپ</option><option value="other">سایر</option></select></label>
        <label>واحد فروش<input name="unit" defaultValue="جفت" /></label>
        <label>دستمزد مستقیم هر واحد<input name="direct_labor" inputMode="decimal" defaultValue="0" /></label>
        <label>بسته‌بندی هر واحد<input name="packaging" inputMode="decimal" defaultValue="0" /></label>
        <label>سایر هزینه متغیر هر واحد<input name="other_variable" inputMode="decimal" defaultValue="0" /></label>
        <label>سربار ثابت خاص هر واحد<input name="overhead_override" inputMode="decimal" placeholder="خالی = سهم عمومی کارگاه" /></label>
        <label>قیمت نقدی فعلی<input name="current_cash_price" inputMode="decimal" placeholder="برای مقایسه" /></label>
      </div>

      <header className={styles.panelHeader}><div><h3>مواد مصرفی یک واحد محصول</h3><p>مقدار واقعی مصرف را بنویس؛ ضایعات نیز جدا اضافه می‌شود.</p></div></header>
      <div className={styles.materialRows}>
        {components.map((line) => {
          const material = materials.find((item) => item.id === line.materialId);
          return (
            <div className={styles.materialRow} key={line.key}>
              <label>ماده<select value={line.materialId} onChange={(event) => patchLine(line.key, { materialId: event.target.value })}>{materials.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>مقدار مصرف<input value={line.quantity} inputMode="decimal" onChange={(event) => patchLine(line.key, { quantity: event.target.value })} /><small>واحد: {material?.unit ?? "—"}</small></label>
              <label>ضایعات درصد<input value={line.wastePercent} inputMode="decimal" onChange={(event) => patchLine(line.key, { wastePercent: event.target.value })} /></label>
              <label style={{ gridColumn: "span 2" }}>توضیح<input value={line.notes} onChange={(event) => patchLine(line.key, { notes: event.target.value })} /></label>
              <button type="button" title="حذف" onClick={() => setComponents((current) => current.length > 1 ? current.filter((item) => item.key !== line.key) : current)}>×</button>
            </div>
          );
        })}
      </div>
      <div className={styles.actionRow}><button type="button" className={styles.secondaryButton} onClick={() => setComponents((current) => [...current, emptyLine(materials)])}>افزودن ماده دیگر</button></div>

      <header className={styles.panelHeader}><div><h3>حاشیه سود اختصاصی</h3><p>خالی بگذاری، تنظیمات عمومی قیمت‌گذاری استفاده می‌شود. این درصدها «حاشیه سود از قیمت فروش» هستند، نه درصد اضافه روی هزینه.</p></div></header>
      <div className={styles.formGrid}>
        <label>حداقل حاشیه امن<input name="min_margin" inputMode="decimal" placeholder="پیش‌فرض عمومی" /></label>
        <label>حاشیه فروش نقدی<input name="cash_margin" inputMode="decimal" placeholder="پیش‌فرض عمومی" /></label>
        <label>حاشیه عمده<input name="wholesale_margin" inputMode="decimal" placeholder="پیش‌فرض عمومی" /></label>
        <label>حاشیه جشنواره<input name="festival_margin" inputMode="decimal" placeholder="پیش‌فرض عمومی" /></label>
        <label>مهلت فروش اعتباری، روز<input name="credit_days" inputMode="numeric" defaultValue="30" /></label>
        <label>نرخ ماهانه اعتبار<input name="credit_monthly_rate" inputMode="decimal" placeholder="پیش‌فرض عمومی" /></label>
      </div>
      <label>یادداشت<textarea name="notes" placeholder="مشخصات کیفیت، سایز، مدل یا نکته تولید" /></label>
      {message ? <div className={message.includes("موفقیت") ? styles.success : styles.alert}>{message}</div> : null}
      <div className={styles.actionRow}><button className={styles.submitButton} disabled={busy}>{busy ? "در حال ثبت..." : "ثبت فرمول محصول"}</button></div>
    </form>
  );
}
