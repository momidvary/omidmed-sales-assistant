"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JalaliDateField from "@/components/jalali-date-field";
import { createClient } from "@/lib/supabase/client";
import { jalaliToGregorian } from "@/lib/jalali";
import styles from "../accounting.module.css";

type Supplier = { id: string; name: string };
type Material = { id: string; name: string; unit: string };
type Line = {
  key: string;
  materialId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  tax: string;
};

const faDigits = "۰۱۲۳۴۵۶۷۸۹";
const arDigits = "٠١٢٣٤٥٦٧٨٩";

function numberValue(value: string) {
  const normalized = value
    .replace(/[۰-۹]/g, (digit) => String(faDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arDigits.indexOf(digit)))
    .replace(/[٬,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isoFromForm(formData: FormData, prefix: string, required = true) {
  const year = numberValue(String(formData.get(`${prefix}_year`) ?? ""));
  const month = numberValue(String(formData.get(`${prefix}_month`) ?? ""));
  const day = numberValue(String(formData.get(`${prefix}_day`) ?? ""));
  if (!year && !month && !day && !required) return null;
  const converted = jalaliToGregorian(year, month, day);
  if (!converted) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${converted.gy}-${pad(converted.gm)}-${pad(converted.gd)}`;
}

function emptyLine(materials: Material[]): Line {
  return {
    key: crypto.randomUUID(),
    materialId: materials[0]?.id ?? "",
    description: "",
    quantity: "1",
    unit: materials[0]?.unit ?? "عدد",
    unitPrice: "",
    discount: "0",
    tax: "0",
  };
}

export default function PurchaseInvoiceForm({
  suppliers,
  materials,
}: {
  suppliers: Supplier[];
  materials: Material[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() => [emptyLine(materials)]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lineSubtotal = lines.reduce((sum, line) => {
    return sum + Math.max(0, numberValue(line.quantity) * numberValue(line.unitPrice) - numberValue(line.discount) + numberValue(line.tax));
  }, 0);

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!suppliers.length || !materials.length) {
      return setMessage("ابتدا حداقل یک تأمین‌کننده و یک ماده ثبت کن.");
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const invoiceDate = isoFromForm(data, "invoice_date", true);
    const dueDate = isoFromForm(data, "due_date", false);
    if (!invoiceDate || dueDate === undefined) return setMessage("تاریخ فاکتور یا سررسید معتبر نیست.");
    if (lines.some((line) => !line.materialId || numberValue(line.quantity) <= 0)) return setMessage("اقلام فاکتور را کامل کن.");

    setBusy(true);
    const items = lines.map((line) => ({
      material_id: line.materialId,
      description: line.description.trim(),
      quantity: numberValue(line.quantity),
      unit: line.unit.trim() || "عدد",
      unit_price: numberValue(line.unitPrice),
      discount_amount: numberValue(line.discount),
      tax_amount: numberValue(line.tax),
    }));

    const { data: invoiceId, error } = await supabase.rpc("create_purchase_invoice", {
      p_supplier_id: String(data.get("supplier_id") ?? ""),
      p_invoice_number: String(data.get("invoice_number") ?? ""),
      p_invoice_date: invoiceDate,
      p_discount_amount: numberValue(String(data.get("discount_amount") ?? "0")),
      p_tax_amount: numberValue(String(data.get("tax_amount") ?? "0")),
      p_shipping_amount: numberValue(String(data.get("shipping_amount") ?? "0")),
      p_other_costs: numberValue(String(data.get("other_costs") ?? "0")),
      p_payment_status: String(data.get("payment_status") ?? "unpaid"),
      p_payment_method: String(data.get("payment_method") ?? "bank_transfer"),
      p_due_date: dueDate,
      p_notes: String(data.get("notes") ?? ""),
      p_items: items,
    });

    if (error || !invoiceId) {
      setBusy(false);
      return setMessage(`ثبت فاکتور انجام نشد: ${error?.message ?? "خطای نامشخص"}`);
    }

    const file = data.get("attachment");
    if (file instanceof File && file.size > 0) {
      if (!["image/png", "image/jpeg", "application/pdf"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        setMessage("فاکتور ثبت شد، اما فایل فقط باید PNG، JPG یا PDF و کمتر از ۱۰ مگابایت باشد.");
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
        if (userId) {
          const path = `${userId}/purchase_invoice/${invoiceId}/${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from("accounting-files").upload(path, file, { contentType: file.type });
          if (!uploadError) {
            await supabase.from("accounting_attachments").insert({
              entity_type: "purchase_invoice",
              entity_id: invoiceId,
              storage_path: path,
              original_name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
          }
        }
      }
    }

    form.reset();
    setLines([emptyLine(materials)]);
    setBusy(false);
    setMessage("فاکتور خرید و اقلام آن با موفقیت ثبت شد.");
    router.refresh();
  }

  const format = new Intl.NumberFormat("fa-IR");

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label>تأمین‌کننده<select name="supplier_id" required>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>شماره فاکتور<input name="invoice_number" placeholder="اختیاری" /></label>
        <label>وضعیت پرداخت<select name="payment_status" defaultValue="unpaid"><option value="unpaid">پرداخت‌نشده</option><option value="partial">بخشی پرداخت شده</option><option value="paid">تسویه‌شده</option></select></label>
        <label>روش پرداخت<select name="payment_method" defaultValue="bank_transfer"><option value="bank_transfer">واریز بانکی</option><option value="cash">نقد</option><option value="card">کارت</option><option value="cheque">چک</option><option value="credit">نسیه</option><option value="other">سایر</option></select></label>
      </div>
      <div className={styles.formGrid2}>
        <JalaliDateField namePrefix="invoice_date" label="تاریخ فاکتور" />
        <JalaliDateField namePrefix="due_date" label="تاریخ سررسید اختیاری" required={false} defaultToday={false} yearsForward={3} />
      </div>

      <div className={styles.materialRows}>
        {lines.map((line) => (
          <div className={styles.materialRow} key={line.key}>
            <label>ماده<select value={line.materialId} onChange={(event) => {
              const material = materials.find((item) => item.id === event.target.value);
              patchLine(line.key, { materialId: event.target.value, unit: material?.unit ?? line.unit });
            }}>{materials.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>مقدار<input value={line.quantity} inputMode="decimal" onChange={(event) => patchLine(line.key, { quantity: event.target.value })} /></label>
            <label>واحد<input value={line.unit} onChange={(event) => patchLine(line.key, { unit: event.target.value })} /></label>
            <label>قیمت واحد<input value={line.unitPrice} inputMode="decimal" onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })} /></label>
            <label>تخفیف ردیف<input value={line.discount} inputMode="decimal" onChange={(event) => patchLine(line.key, { discount: event.target.value })} /></label>
            <button type="button" title="حذف ردیف" onClick={() => setLines((current) => current.length > 1 ? current.filter((item) => item.key !== line.key) : current)}>×</button>
            <label style={{ gridColumn: "1 / -1" }}>توضیح قلم<input value={line.description} onChange={(event) => patchLine(line.key, { description: event.target.value })} placeholder="مثلاً رول ۶۰ گرم عرض ۱۶۰" /></label>
          </div>
        ))}
      </div>
      <div className={styles.actionRow}><button type="button" className={styles.secondaryButton} onClick={() => setLines((current) => [...current, emptyLine(materials)])}>افزودن قلم دیگر</button></div>

      <div className={styles.formGrid}>
        <label>تخفیف کل فاکتور<input name="discount_amount" defaultValue="0" inputMode="decimal" /></label>
        <label>مالیات یا عوارض کل<input name="tax_amount" defaultValue="0" inputMode="decimal" /></label>
        <label>کرایه حمل<input name="shipping_amount" defaultValue="0" inputMode="decimal" /></label>
        <label>سایر هزینه‌های خرید<input name="other_costs" defaultValue="0" inputMode="decimal" /></label>
        <label>تصویر یا PDF فاکتور<input name="attachment" type="file" accept="image/png,image/jpeg,application/pdf" /><small>حداکثر ۱۰ مگابایت</small></label>
      </div>
      <label>یادداشت<textarea name="notes" placeholder="شرایط پرداخت، کیفیت، توضیحات تأمین‌کننده..." /></label>
      <div className={styles.totalBar}><span>جمع اقلام قبل از هزینه‌های کل</span><strong>{format.format(Math.round(lineSubtotal))}</strong></div>
      {message ? <div className={message.includes("موفقیت") ? styles.success : styles.alert}>{message}</div> : null}
      <div className={styles.actionRow}><button className={styles.submitButton} disabled={busy}>{busy ? "در حال ثبت..." : "ثبت فاکتور خرید"}</button></div>
    </form>
  );
}
