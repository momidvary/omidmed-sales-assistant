/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { jalaliToGregorian } from "@/lib/jalali";
import type { AIInvoiceExtraction } from "@/lib/accounting/invoice-ai";
import { normalizeMatchText } from "@/lib/accounting/invoice-ai";
import styles from "./invoice-ai-scanner.module.css";

type Supplier = { id: string; name: string };
type Material = { id: string; name: string; unit: string };

type DraftItem = {
  key: string;
  materialId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  tax: string;
  extractedTotal: string;
  confidence: number;
  warning: string;
};

type Draft = {
  supplierId: string;
  supplierRaw: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  documentType: AIInvoiceExtraction["document_type"];
  originalCurrency: AIInvoiceExtraction["original_currency"];
  paymentStatus: string;
  paymentMethod: string;
  discount: string;
  tax: string;
  shipping: string;
  otherCosts: string;
  extractedSubtotal: string;
  extractedTotal: string;
  notes: string;
  overallConfidence: number;
  warnings: string[];
  items: DraftItem[];
};

const faDigits = "۰۱۲۳۴۵۶۷۸۹";
const arDigits = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(faDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arDigits.indexOf(digit)))
    .replace(/[٬,\s]/g, "");
}

function numeric(value: string) {
  const parsed = Number(normalizeDigits(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function roundText(value: number | null | undefined) {
  return String(Math.max(0, Math.round(Number(value ?? 0))));
}

function parseJalali(value: string, required = true) {
  const normalized = normalizeDigits(value.trim()).replace(/-/g, "/");
  if (!normalized && !required) return null;
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) return undefined;
  const converted = jalaliToGregorian(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!converted) return undefined;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${converted.gy}-${pad(converted.gm)}-${pad(converted.gd)}`;
}

function exactOrLooseId(name: string | null | undefined, items: Array<{ id: string; name: string }>) {
  const needle = normalizeMatchText(name);
  if (!needle) return "";
  const exact = items.find((item) => normalizeMatchText(item.name) === needle);
  if (exact) return exact.id;
  const loose = items.filter((item) => {
    const itemName = normalizeMatchText(item.name);
    return itemName.includes(needle) || needle.includes(itemName);
  });
  return loose.length === 1 ? loose[0].id : "";
}

function buildDraft(extraction: AIInvoiceExtraction, suppliers: Supplier[], materials: Material[]): Draft {
  const supplierId = exactOrLooseId(extraction.supplier_match_name || extraction.supplier_name, suppliers);
  const items = extraction.items.map((item) => {
    const materialId = exactOrLooseId(item.matched_material_name || item.description, materials);
    const material = materials.find((entry) => entry.id === materialId);
    return {
      key: crypto.randomUUID(),
      materialId,
      description: item.description,
      quantity: String(item.quantity || ""),
      unit: item.unit || material?.unit || "عدد",
      unitPrice: roundText(item.unit_price_toman),
      discount: roundText(item.discount_amount_toman),
      tax: roundText(item.tax_amount_toman),
      extractedTotal: roundText(item.line_total_toman),
      confidence: item.confidence,
      warning: item.warning ?? "",
    };
  });
  return {
    supplierId,
    supplierRaw: extraction.supplier_name ?? "",
    invoiceNumber: extraction.invoice_number ?? "",
    invoiceDate: extraction.invoice_date_jalali ?? "",
    dueDate: extraction.due_date_jalali ?? "",
    documentType: extraction.document_type,
    originalCurrency: extraction.original_currency,
    paymentStatus: extraction.payment_status === "unknown" ? "unpaid" : extraction.payment_status,
    paymentMethod: extraction.payment_method === "unknown" ? "bank_transfer" : extraction.payment_method,
    discount: roundText(extraction.discount_amount_toman),
    tax: roundText(extraction.tax_amount_toman),
    shipping: roundText(extraction.shipping_amount_toman),
    otherCosts: roundText(extraction.other_costs_toman),
    extractedSubtotal: roundText(extraction.subtotal_toman),
    extractedTotal: roundText(extraction.total_amount_toman),
    notes: extraction.notes ?? "",
    overallConfidence: extraction.overall_confidence,
    warnings: extraction.warnings,
    items,
  };
}

async function compressedAnalysisFile(file: File) {
  const maxBytes = 3.6 * 1024 * 1024;
  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) throw new Error("PDF برای تحلیل باید کمتر از ۴ مگابایت باشد.");
    return file;
  }
  if (file.size <= maxBytes) return file;
  if (!("createImageBitmap" in window)) throw new Error("حجم عکس زیاد است؛ قبل از بارگذاری آن را کوچک‌تر کن.");
  const bitmap = await createImageBitmap(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("کوچک‌سازی عکس انجام نشد.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (!blob) throw new Error("کوچک‌سازی عکس انجام نشد.");
  if (blob.size > maxBytes) throw new Error("عکس پس از کوچک‌سازی هنوز بزرگ است؛ نسخه کم‌حجم‌تری انتخاب کن.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-analysis.jpg`, { type: "image/jpeg" });
}

export default function InvoiceAIScanner({ suppliers, materials }: { suppliers: Supplier[]; materials: Material[] }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const calculatedSubtotal = draft?.items.reduce((sum, item) => {
    return sum + Math.max(0, numeric(item.quantity) * numeric(item.unitPrice) - numeric(item.discount) + numeric(item.tax));
  }, 0) ?? 0;
  const calculatedTotal = draft
    ? Math.max(0, calculatedSubtotal - numeric(draft.discount) + numeric(draft.tax) + numeric(draft.shipping) + numeric(draft.otherCosts))
    : 0;
  const difference = draft ? Math.round(calculatedTotal - numeric(draft.extractedTotal)) : 0;
  const missingMaterialCount = draft?.items.filter((item) => !item.materialId).length ?? 0;

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setMessage(null);
    setDraft(null);
    setModel("");
    if (!next) return setFile(null);
    if (!["image/jpeg", "image/png", "application/pdf"].includes(next.type)) {
      event.target.value = "";
      return setMessage("فقط JPG، PNG یا PDF انتخاب کن.");
    }
    if (next.size > 10 * 1024 * 1024) {
      event.target.value = "";
      return setMessage("فایل اصلی باید کمتر از ۱۰ مگابایت باشد.");
    }
    setFile(next);
  }

  async function analyze() {
    if (!file) return setMessage("ابتدا عکس یا PDF فاکتور را انتخاب کن.");
    setAnalyzing(true);
    setMessage(null);
    try {
      const analysisFile = await compressedAnalysisFile(file);
      const body = new FormData();
      body.set("file", analysisFile);
      const response = await fetch("/api/accounting/invoice-extract", { method: "POST", body });
      const data = await response.json() as { extraction?: AIInvoiceExtraction; model?: string; error?: string };
      if (!response.ok || !data.extraction) throw new Error(data.error || "تحلیل فاکتور انجام نشد.");
      setDraft(buildDraft(data.extraction, suppliers, materials));
      setModel(data.model ?? "");
      setMessage("پیش‌نویس ساخته شد. همه مبلغ‌ها، تاریخ و تطبیق مواد را قبل از ثبت کنترل کن.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تحلیل فاکتور انجام نشد.");
    } finally {
      setAnalyzing(false);
    }
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setDraft((current) => current ? {
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    } : current);
  }

  async function save() {
    if (!draft || !file) return;
    setMessage(null);
    if (!draft.supplierId) return setMessage("تأمین‌کننده را از فهرست انتخاب کن. اگر وجود ندارد، ابتدا در صفحه فاکتورهای خرید ثبتش کن.");
    const invoiceDate = parseJalali(draft.invoiceDate, true);
    const dueDate = parseJalali(draft.dueDate, false);
    if (!invoiceDate || dueDate === undefined) return setMessage("تاریخ فاکتور یا سررسید معتبر نیست؛ مانند ۱۴۰۵/۰۴/۲۲ وارد کن.");
    if (!draft.items.length || draft.items.some((item) => !item.materialId || numeric(item.quantity) <= 0)) {
      return setMessage("برای همه اقلام، ماده درست و مقدار معتبر را انتخاب کن.");
    }

    setSaving(true);
    try {
      let duplicateQuery = supabase
        .from("purchase_invoices")
        .select("id,invoice_number,invoice_date,total_amount")
        .eq("supplier_id", draft.supplierId)
        .eq("invoice_date", invoiceDate)
        .limit(3);
      if (draft.invoiceNumber.trim()) duplicateQuery = duplicateQuery.eq("invoice_number", draft.invoiceNumber.trim());
      else duplicateQuery = duplicateQuery.eq("total_amount", Math.round(calculatedTotal));
      const duplicateResult = await duplicateQuery;
      if (duplicateResult.error) throw new Error(duplicateResult.error.message);
      if ((duplicateResult.data ?? []).length) {
        if (draft.invoiceNumber.trim()) {
          setSaving(false);
          return setMessage("فاکتوری با همین تأمین‌کننده و شماره قبلاً ثبت شده است؛ ثبت تکراری انجام نشد.");
        }
        if (!window.confirm("یک فاکتور با همین تاریخ و مبلغ قبلاً ثبت شده است. با این حال دوباره ثبت شود؟")) {
          setSaving(false);
          return;
        }
      }

      const items = draft.items.map((item) => ({
        material_id: item.materialId,
        description: item.description.trim(),
        quantity: numeric(item.quantity),
        unit: item.unit.trim() || "عدد",
        unit_price: numeric(item.unitPrice),
        discount_amount: numeric(item.discount),
        tax_amount: numeric(item.tax),
      }));
      const auditNote = [
        "ثبت‌شده با پیش‌نویس هوش مصنوعی و تأیید کاربر.",
        `نوع سند: ${draft.documentType}`,
        `واحد اصلی سند: ${draft.originalCurrency}`,
        `اعتماد استخراج: ${Math.round(draft.overallConfidence * 100)}٪`,
        draft.notes.trim(),
      ].filter(Boolean).join(" | ");

      const { data: invoiceId, error } = await supabase.rpc("create_purchase_invoice", {
        p_supplier_id: draft.supplierId,
        p_invoice_number: draft.invoiceNumber.trim(),
        p_invoice_date: invoiceDate,
        p_discount_amount: numeric(draft.discount),
        p_tax_amount: numeric(draft.tax),
        p_shipping_amount: numeric(draft.shipping),
        p_other_costs: numeric(draft.otherCosts),
        p_payment_status: draft.paymentStatus,
        p_payment_method: draft.paymentMethod,
        p_due_date: dueDate,
        p_notes: auditNote,
        p_items: items,
      });
      if (error || !invoiceId) throw new Error(error?.message ?? "ثبت فاکتور انجام نشد.");

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        const ext = file.name.split(".").pop()?.toLowerCase() || (file.type === "application/pdf" ? "pdf" : "jpg");
        const path = `${userId}/purchase_invoice/${invoiceId}/${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage.from("accounting-files").upload(path, file, { contentType: file.type });
        if (!upload.error) {
          await supabase.from("accounting_attachments").insert({
            entity_type: "purchase_invoice",
            entity_id: invoiceId,
            storage_path: path,
            original_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          });
        } else {
          setMessage(`فاکتور ثبت شد اما فایل آرشیو نشد: ${upload.error.message}`);
        }
      }

      router.push("/accounting/purchases?saved=invoice-ai");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? `ثبت انجام نشد: ${error.message}` : "ثبت انجام نشد.");
      setSaving(false);
    }
  }

  const formatter = new Intl.NumberFormat("fa-IR");

  return (
    <div className={styles.layout}>
      <section className={styles.uploadPanel}>
        <div className={styles.uploadBox}>
          <span className={styles.spark}>✦</span>
          <h2>فاکتور خرید را بارگذاری کن</h2>
          <p>فاکتور چاپی، پیش‌فاکتور، رسید و فاکتور دست‌نویس پشتیبانی می‌شود.</p>
          <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={chooseFile} />
          <small>فایل اصلی حداکثر ۱۰ مگابایت؛ PDF ارسالی برای تحلیل حداکثر ۴ مگابایت.</small>
          <button type="button" onClick={analyze} disabled={!file || analyzing}>
            {analyzing ? "در حال خواندن فاکتور..." : "خواندن با هوش مصنوعی"}
          </button>
        </div>
        <div className={styles.preview}>
          {!previewUrl ? <div className={styles.previewEmpty}>پیش‌نمایش فاکتور اینجا دیده می‌شود.</div> : file?.type === "application/pdf" ? (
            <iframe src={previewUrl} title="پیش‌نمایش PDF فاکتور" />
          ) : (
            <img src={previewUrl} alt="پیش‌نمایش فاکتور خرید" />
          )}
        </div>
        <div className={styles.securityNote}>
          فایل به‌صورت خودکار ثبت نمی‌شود. مدل فقط پیش‌نویس می‌سازد و ثبت مالی بعد از بررسی و تأیید تو انجام می‌شود.
        </div>
      </section>

      <section className={styles.draftPanel}>
        {!draft ? (
          <div className={styles.emptyState}>
            <strong>هنوز پیش‌نویسی ساخته نشده است</strong>
            <span>بعد از تحلیل، نام تأمین‌کننده، تاریخ، مبلغ‌ها و اقلام قابل ویرایش در این بخش ظاهر می‌شوند.</span>
          </div>
        ) : (
          <>
            <header className={styles.draftHeader}>
              <div>
                <span>پیش‌نویس قابل ویرایش</span>
                <h2>{draft.documentType === "preinvoice" ? "پیش‌فاکتور خرید" : "فاکتور خرید"}</h2>
              </div>
              <div className={draft.overallConfidence >= 0.8 ? styles.confidenceGood : styles.confidenceWarn}>
                اطمینان کلی {Math.round(draft.overallConfidence * 100).toLocaleString("fa-IR")}٪
              </div>
            </header>

            <div className={styles.currencyBanner}>
              {draft.originalCurrency === "unknown" ? (
                <>واحد مبلغ روی سند مشخص نشده است. همه اعداد را قبل از ثبت بررسی کن؛ اگر مبلغ‌ها ریال هستند باید به تومان تبدیل شوند.</>
              ) : (
                <>همه مبلغ‌ها برای ثبت در برنامه به <strong>تومان</strong> تبدیل شده‌اند. واحد نوشته‌شده روی سند: {draft.originalCurrency === "rial" ? "ریال" : "تومان"}.</>
              )}
            </div>

            <div className={styles.formGrid}>
              <label>تأمین‌کننده
                <select value={draft.supplierId} onChange={(event) => patchDraft({ supplierId: event.target.value })}>
                  <option value="">انتخاب کن — متن خوانده‌شده: {draft.supplierRaw || "نامشخص"}</option>
                  {suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label>شماره فاکتور<input value={draft.invoiceNumber} onChange={(event) => patchDraft({ invoiceNumber: event.target.value })} /></label>
              <label>تاریخ شمسی<input value={draft.invoiceDate} onChange={(event) => patchDraft({ invoiceDate: event.target.value })} placeholder="۱۴۰۵/۰۴/۲۲" dir="ltr" /></label>
              <label>تاریخ سررسید<input value={draft.dueDate} onChange={(event) => patchDraft({ dueDate: event.target.value })} placeholder="اختیاری" dir="ltr" /></label>
              <label>وضعیت پرداخت<select value={draft.paymentStatus} onChange={(event) => patchDraft({ paymentStatus: event.target.value })}><option value="unpaid">پرداخت‌نشده</option><option value="partial">بخشی پرداخت شده</option><option value="paid">تسویه‌شده</option></select></label>
              <label>روش پرداخت<select value={draft.paymentMethod} onChange={(event) => patchDraft({ paymentMethod: event.target.value })}><option value="bank_transfer">واریز بانکی</option><option value="cash">نقد</option><option value="card">کارت</option><option value="cheque">چک</option><option value="credit">نسیه</option><option value="other">سایر</option></select></label>
            </div>

            {draft.warnings.length ? (
              <div className={styles.warningBox}><strong>موارد نیازمند بررسی</strong><ul>{draft.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>
            ) : null}

            <div className={styles.itemsHeader}>
              <h3>اقلام استخراج‌شده</h3>
              <button type="button" onClick={() => patchDraft({ items: [...draft.items, { key: crypto.randomUUID(), materialId: "", description: "", quantity: "1", unit: "عدد", unitPrice: "0", discount: "0", tax: "0", extractedTotal: "0", confidence: 1, warning: "" }] })}>افزودن ردیف</button>
            </div>

            <div className={styles.items}>
              {draft.items.map((item, index) => (
                <article className={`${styles.itemCard} ${!item.materialId || item.confidence < 0.75 ? styles.itemNeedsReview : ""}`} key={item.key}>
                  <div className={styles.itemTitle}><strong>ردیف {(index + 1).toLocaleString("fa-IR")}</strong><span>{Math.round(item.confidence * 100).toLocaleString("fa-IR")}٪ اطمینان</span></div>
                  <label className={styles.full}>ماده متناظر
                    <select value={item.materialId} onChange={(event) => {
                      const material = materials.find((entry) => entry.id === event.target.value);
                      patchItem(item.key, { materialId: event.target.value, unit: material?.unit || item.unit });
                    }}>
                      <option value="">انتخاب ماده لازم است</option>
                      {materials.map((material) => <option value={material.id} key={material.id}>{material.name}</option>)}
                    </select>
                  </label>
                  <label className={styles.full}>شرح روی فاکتور<input value={item.description} onChange={(event) => patchItem(item.key, { description: event.target.value })} /></label>
                  <label>مقدار<input value={item.quantity} onChange={(event) => patchItem(item.key, { quantity: event.target.value })} inputMode="decimal" /></label>
                  <label>واحد<input value={item.unit} onChange={(event) => patchItem(item.key, { unit: event.target.value })} /></label>
                  <label>قیمت واحد تومان<input value={item.unitPrice} onChange={(event) => patchItem(item.key, { unitPrice: event.target.value })} inputMode="decimal" /></label>
                  <label>تخفیف ردیف<input value={item.discount} onChange={(event) => patchItem(item.key, { discount: event.target.value })} inputMode="decimal" /></label>
                  <label>مالیات ردیف<input value={item.tax} onChange={(event) => patchItem(item.key, { tax: event.target.value })} inputMode="decimal" /></label>
                  <div className={styles.lineCheck}><span>جمع محاسبه‌شده</span><strong>{formatter.format(Math.round(Math.max(0, numeric(item.quantity) * numeric(item.unitPrice) - numeric(item.discount) + numeric(item.tax))))}</strong><small>روی سند: {formatter.format(numeric(item.extractedTotal))}</small></div>
                  {item.warning ? <p className={styles.itemWarning}>{item.warning}</p> : null}
                  <button className={styles.removeButton} type="button" onClick={() => patchDraft({ items: draft.items.filter((entry) => entry.key !== item.key) })}>حذف ردیف</button>
                </article>
              ))}
            </div>

            <div className={styles.costGrid}>
              <label>تخفیف کل<input value={draft.discount} onChange={(event) => patchDraft({ discount: event.target.value })} inputMode="decimal" /></label>
              <label>مالیات کل<input value={draft.tax} onChange={(event) => patchDraft({ tax: event.target.value })} inputMode="decimal" /></label>
              <label>کرایه حمل<input value={draft.shipping} onChange={(event) => patchDraft({ shipping: event.target.value })} inputMode="decimal" /></label>
              <label>سایر هزینه‌ها<input value={draft.otherCosts} onChange={(event) => patchDraft({ otherCosts: event.target.value })} inputMode="decimal" /></label>
            </div>
            <label className={styles.notes}>یادداشت<textarea value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} /></label>

            <div className={styles.totalComparison}>
              <div><span>جمع محاسبه‌شده برنامه</span><strong>{formatter.format(Math.round(calculatedTotal))} تومان</strong></div>
              <div><span>جمع خوانده‌شده از سند</span><strong>{formatter.format(numeric(draft.extractedTotal))} تومان</strong></div>
              <div className={Math.abs(difference) > 10 ? styles.differenceWarn : styles.differenceOk}><span>اختلاف</span><strong>{formatter.format(difference)} تومان</strong></div>
            </div>

            {missingMaterialCount ? <div className={styles.alert}>{missingMaterialCount.toLocaleString("fa-IR")} ردیف هنوز به ماده داخل برنامه متصل نشده است.</div> : null}
            {message ? <div className={message.includes("پیش‌نویس") ? styles.success : styles.alert}>{message}</div> : null}
            {model ? <small className={styles.model}>مدل تحلیل: {model}</small> : null}
            <button className={styles.saveButton} type="button" onClick={save} disabled={saving || missingMaterialCount > 0}>
              {saving ? "در حال ثبت و آرشیو فایل..." : "تأیید و ثبت نهایی فاکتور"}
            </button>
          </>
        )}
        {!draft && message ? <div className={styles.alert}>{message}</div> : null}
      </section>
    </div>
  );
}
