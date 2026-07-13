"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/app-shell";
import {
  type CsvRow,
  nullable,
  parseCsv,
  parseInteger,
  parseNumber,
} from "./csv-utils";
import styles from "./invoice-import.module.css";

const requiredHeaders = [
  "external_key",
  "invoice_number",
  "jalali_invoice_date",
  "row_number",
  "product_name",
  "quantity",
  "unit_price",
  "line_total",
  "description",
  "source_page",
];

type ItemRecord = {
  invoice_id: string;
  row_number: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  description: string | null;
  source_page: number | null;
  external_key: string;
};

const number = new Intl.NumberFormat("fa-IR");

export default function InvoiceItemsImporter() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  async function chooseFile(file?: File) {
    setRows([]);
    setFileName("");
    setError("");
    setMessage("");
    setProgress(0);

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

    const missingHeaders = requiredHeaders.filter(
      (header) => !(header in parsed[0]),
    );
    if (missingHeaders.length) {
      setError(`ستون‌های لازم پیدا نشد: ${missingHeaders.join("، ")}`);
      return;
    }

    const invalidRow = parsed.find(
      (row) =>
        !row.external_key ||
        !row.invoice_number ||
        !row.product_name ||
        !Number.isFinite(parseNumber(row.quantity)) ||
        !Number.isFinite(parseNumber(row.unit_price)) ||
        !Number.isFinite(parseInteger(row.line_total)),
    );

    if (invalidRow) {
      setError(
        "حداقل یک ردیف، شماره فاکتور، نام کالا، تعداد یا مبلغ معتبر ندارد.",
      );
      return;
    }

    if (new Set(parsed.map((row) => row.external_key)).size !== parsed.length) {
      setError("داخل فایل، شناسه تکراری ردیف فاکتور وجود دارد.");
      return;
    }

    setFileName(file.name);
    setRows(parsed);
  }

  async function readAllInvoices() {
    const supabase = createClient();
    const invoiceIds = new Map<string, string>();
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error: readError } = await supabase
        .from("invoices")
        .select("id,invoice_number")
        .eq("source", "holo_qrp")
        .range(from, from + pageSize - 1);

      if (readError) throw readError;
      for (const invoice of data ?? []) {
        invoiceIds.set(invoice.invoice_number as string, invoice.id as string);
      }
      if ((data?.length ?? 0) < pageSize) break;
      from += pageSize;
    }

    return invoiceIds;
  }

  async function readExistingKeys() {
    const supabase = createClient();
    const keys = new Set<string>();
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error: readError } = await supabase
        .from("invoice_items")
        .select("external_key")
        .range(from, from + pageSize - 1);

      if (readError) throw readError;
      for (const item of data ?? []) {
        if (item.external_key) keys.add(item.external_key);
      }
      if ((data?.length ?? 0) < pageSize) break;
      from += pageSize;
    }

    return keys;
  }

  async function importRows() {
    if (!rows.length || loading) return;

    setLoading(true);
    setError("");
    setMessage("");
    setProgress(3);

    try {
      const supabase = createClient();
      const invoiceIds = await readAllInvoices();

      const missingInvoices = Array.from(
        new Set(
          rows
            .filter((row) => !invoiceIds.has(row.invoice_number))
            .map((row) => row.invoice_number),
        ),
      );

      if (missingInvoices.length) {
        throw new Error(
          `برای ${number.format(missingInvoices.length)} شماره فاکتور، تیتر فاکتور پیدا نشد. ابتدا فایل اول را کامل وارد کن. نمونه: ${missingInvoices.slice(0, 5).join("، ")}`,
        );
      }

      setProgress(10);
      const existingKeys = await readExistingKeys();
      const pendingRows = rows.filter(
        (row) => !existingKeys.has(row.external_key),
      );
      const skippedCount = rows.length - pendingRows.length;

      const records: ItemRecord[] = pendingRows.map((row) => ({
        invoice_id: invoiceIds.get(row.invoice_number) as string,
        row_number: Number.isFinite(parseInteger(row.row_number))
          ? parseInteger(row.row_number)
          : null,
        product_name: row.product_name,
        quantity: parseNumber(row.quantity),
        unit_price: parseNumber(row.unit_price),
        line_total: parseInteger(row.line_total),
        description: nullable(row.description),
        source_page: Number.isFinite(parseInteger(row.source_page))
          ? parseInteger(row.source_page)
          : null,
        external_key: row.external_key,
      }));

      const batchSize = 100;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const { error: insertError } = await supabase
          .from("invoice_items")
          .insert(batch);
        if (insertError) throw insertError;

        const completed = start + batch.length;
        const percentage = records.length
          ? 10 + Math.round((completed / records.length) * 90)
          : 100;
        setProgress(Math.min(100, percentage));
      }

      setProgress(100);
      setMessage(
        skippedCount
          ? `${number.format(records.length)} ردیف کالای جدید وارد شد و ${number.format(skippedCount)} ردیف تکراری نادیده گرفته شد.`
          : `${number.format(records.length)} ردیف کالا با موفقیت وارد شد. پرونده مشتریان اکنون محصولات هر فاکتور را نمایش می‌دهد.`,
      );
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : "خطای نامشخص در ورود اقلام";
      setError(
        text.includes("relation") || text.includes("invoice_items")
          ? `${text} — مطمئن شو فایل SQL مرحله هشتم را در Supabase اجرا کرده‌ای.`
          : text,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.importer}>
      <div className={styles.dropzone}>
        <div className={styles.uploadIcon}>
          <Icon name="upload" size={28} />
        </div>
        <h4>فایل اقلام فاکتورها</h4>
        <p>فایل «اقلام فاکتورهای هلو آماده ورود.csv» را انتخاب کن.</p>
        <label className={styles.fileButton}>
          انتخاب فایل اقلام
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>
      </div>

      {fileName ? (
        <div className={styles.fileInfo}>
          <strong>{fileName}</strong>
          <span>{number.format(rows.length)} ردیف کالا آماده ورود</span>
        </div>
      ) : null}

      {rows.length ? (
        <div className={styles.preview}>
          {rows.slice(0, 3).map((row) => (
            <b key={row.external_key}>
              {row.product_name} — فاکتور {row.invoice_number}
            </b>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.progress}>
          <div style={{ width: `${progress}%` }} />
          <span>{number.format(progress)}٪</span>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? (
        <div className={styles.successBox}>
          <p>{message}</p>
          <Link href="/customers">رفتن به بانک مشتریان</Link>
        </div>
      ) : null}

      <button
        className={styles.submit}
        type="button"
        disabled={!rows.length || loading}
        onClick={importRows}
      >
        <Icon name="check" size={18} />
        {loading ? "در حال ورود اقلام..." : "ورود اقلام فاکتورها"}
      </button>
    </div>
  );
}
