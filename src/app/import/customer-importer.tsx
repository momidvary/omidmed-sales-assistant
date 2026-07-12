"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/app-shell";
import styles from "./import.module.css";

type CsvRow = Record<string, string>;

type CustomerRecord = {
  id?: string;
  customer_code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  normalized_phone: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  status: "active" | "inactive" | "prospect" | "lost";
  priority: "low" | "normal" | "high" | "vip";
  notes: string | null;
  imported_last_purchase_at: string | null;
  imported_purchase_count: number;
  imported_total_sales: number;
  imported_avg_purchase_gap_days: number | null;
};

const requiredHeaders = [
  "customer_code",
  "name",
  "phone",
  "normalized_phone",
  "address",
  "status",
  "priority",
  "notes",
  "imported_last_purchase_at",
  "imported_purchase_count",
  "imported_total_sales",
  "imported_avg_purchase_gap_days",
];

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const [headers, ...body] = rows;
  if (!headers) return [];
  return body
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])));
}

function nullable(value: string | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function toNumber(value: string | undefined, fallback = 0) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRecord(row: CsvRow): CustomerRecord {
  const status = ["active", "inactive", "prospect", "lost"].includes(row.status) ? row.status : "active";
  const priority = ["low", "normal", "high", "vip"].includes(row.priority) ? row.priority : "normal";
  return {
    customer_code: row.customer_code,
    name: row.name,
    contact_name: nullable(row.contact_name),
    phone: nullable(row.phone),
    normalized_phone: nullable(row.normalized_phone),
    province: nullable(row.province),
    city: nullable(row.city),
    address: nullable(row.address),
    status: status as CustomerRecord["status"],
    priority: priority as CustomerRecord["priority"],
    notes: nullable(row.notes),
    imported_last_purchase_at: nullable(row.imported_last_purchase_at),
    imported_purchase_count: Math.max(0, Math.round(toNumber(row.imported_purchase_count))),
    imported_total_sales: Math.max(0, Math.round(toNumber(row.imported_total_sales))),
    imported_avg_purchase_gap_days: nullable(row.imported_avg_purchase_gap_days) === null ? null : Math.max(0, toNumber(row.imported_avg_purchase_gap_days)),
  };
}

export default function CustomerImporter() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  async function chooseFile(file?: File) {
    setError("");
    setMessage("");
    setRows([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("فایل انتخاب‌شده باید CSV باشد.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (!parsed.length) {
      setError("فایل خالی است یا ساختار آن قابل‌خواندن نیست.");
      return;
    }
    const missing = requiredHeaders.filter((header) => !(header in parsed[0]));
    if (missing.length) {
      setError(`ستون‌های لازم پیدا نشد: ${missing.join(", ")}`);
      return;
    }
    const invalid = parsed.find((row) => !row.customer_code || !row.name);
    if (invalid) {
      setError("حداقل یک ردیف فاقد کد یا نام مشتری است.");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
  }

  async function importRows() {
    if (!rows.length || loading) return;
    setLoading(true);
    setError("");
    setMessage("");
    setProgress(5);

    try {
      const supabase = createClient();
      const { data: existing, error: existingError } = await supabase
        .from("customers")
        .select("id,customer_code")
        .not("customer_code", "is", null)
        .range(0, 4999);

      if (existingError) throw existingError;
      const idByCode = new Map((existing ?? []).map((item) => [item.customer_code as string, item.id as string]));
      const records = rows.map((row) => {
        const record = toRecord(row);
        const id = idByCode.get(record.customer_code);
        return id ? { ...record, id } : record;
      });

      const batchSize = 100;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const { error: upsertError } = await supabase.from("customers").upsert(batch);
        if (upsertError) throw upsertError;
        setProgress(Math.min(100, Math.round(((start + batch.length) / records.length) * 100)));
      }

      setMessage(`${new Intl.NumberFormat("fa-IR").format(records.length)} مشتری با موفقیت وارد یا به‌روزرسانی شد.`);
      setTimeout(() => { window.location.href = "/customers"; }, 900);
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "خطای نامشخص در ورود اطلاعات";
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className={styles.importer}>
      <div className={styles.dropzone}>
        <div className={styles.uploadIcon}><Icon name="upload" size={30} /></div>
        <h3>فایل CSV را انتخاب کن</h3>
        <p>فقط فایل آماده‌ای که برای این پروژه ساخته شده است.</p>
        <label className={styles.fileButton}>
          انتخاب فایل
          <input type="file" accept=".csv,text/csv" onChange={(event) => chooseFile(event.target.files?.[0])} />
        </label>
      </div>

      {fileName ? <div className={styles.fileInfo}><strong>{fileName}</strong><span>{new Intl.NumberFormat("fa-IR").format(rows.length)} مشتری آماده ورود</span></div> : null}
      {rows.length ? <div className={styles.preview}><span>نمونه:</span>{rows.slice(0, 3).map((row) => <b key={row.customer_code}>{row.name}</b>)}</div> : null}
      {loading ? <div className={styles.progress}><div style={{ width: `${progress}%` }} /><span>{new Intl.NumberFormat("fa-IR").format(progress)}٪</span></div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}
      <button className={styles.submit} type="button" disabled={!rows.length || loading} onClick={importRows}>
        <Icon name="check" size={19} />
        {loading ? "در حال ورود اطلاعات..." : "ورود مشتریان به برنامه"}
      </button>
    </article>
  );
}
