"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/app-shell";
import styles from "./sales-import.module.css";

type CsvRow = Record<string, string>;

type SalesRecord = {
  customer_id: string;
  invoice_number: string | null;
  document_number: string | null;
  sale_date: string;
  amount: number;
  description: string | null;
  source: "holo_excel";
  source_row: number | null;
  external_key: string;
  raw_customer_name: string | null;
};

const requiredHeaders = [
  "external_key",
  "customer_code",
  "customer_name",
  "raw_customer_name",
  "sale_date",
  "jalali_sale_date",
  "invoice_number",
  "document_number",
  "amount",
  "description",
  "source_row",
];

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
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
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [
          header.trim(),
          values[index]?.trim() ?? "",
        ]),
      ),
    );
}

function nullable(value: string | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function parseAmount(value: string | undefined) {
  const normalized = (value ?? "").replace(/[٬,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

function parseSourceRow(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export default function SalesImporter() {
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
    setFileName("");

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
      setError(`ستون‌های لازم پیدا نشد: ${missingHeaders.join(", ")}`);
      return;
    }

    const invalidRow = parsed.find(
      (row) =>
        !row.external_key ||
        !row.customer_code ||
        !isIsoDate(row.sale_date) ||
        !Number.isFinite(parseAmount(row.amount)) ||
        parseAmount(row.amount) < 0,
    );

    if (invalidRow) {
      setError(
        "حداقل یک ردیف کد مشتری، تاریخ استاندارد، شناسه یکتا یا مبلغ معتبر ندارد.",
      );
      return;
    }

    const uniqueKeys = new Set(parsed.map((row) => row.external_key));
    if (uniqueKeys.size !== parsed.length) {
      setError("داخل فایل، شناسه تکراری فروش وجود دارد.");
      return;
    }

    setFileName(file.name);
    setRows(parsed);
  }

  async function readExistingKeys() {
    const supabase = createClient();
    const keys = new Set<string>();
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error: readError } = await supabase
        .from("sales")
        .select("external_key")
        .eq("source", "holo_excel")
        .not("external_key", "is", null)
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
      const { data: customers, error: customerError } = await supabase
        .from("customers")
        .select("id,customer_code")
        .not("customer_code", "is", null)
        .range(0, 4999);

      if (customerError) throw customerError;

      const idByCode = new Map(
        (customers ?? []).map((customer) => [
          customer.customer_code as string,
          customer.id as string,
        ]),
      );

      const missingCodes = Array.from(
        new Set(
          rows
            .filter((row) => !idByCode.has(row.customer_code))
            .map((row) => row.customer_code),
        ),
      );

      if (missingCodes.length) {
        throw new Error(
          `برای ${new Intl.NumberFormat("fa-IR").format(missingCodes.length)} کد، مشتری پیدا نشد. ابتدا بانک ۶۹۷ مشتری را وارد کن. نمونه: ${missingCodes.slice(0, 5).join("، ")}`,
        );
      }

      setProgress(10);
      const existingKeys = await readExistingKeys();
      const pendingRows = rows.filter(
        (row) => !existingKeys.has(row.external_key),
      );
      const skippedCount = rows.length - pendingRows.length;

      const records: SalesRecord[] = pendingRows.map((row) => ({
        customer_id: idByCode.get(row.customer_code) as string,
        invoice_number: nullable(row.invoice_number),
        document_number: nullable(row.document_number),
        sale_date: row.sale_date,
        amount: parseAmount(row.amount),
        description: nullable(row.description),
        source: "holo_excel",
        source_row: parseSourceRow(row.source_row),
        external_key: row.external_key,
        raw_customer_name: nullable(row.raw_customer_name),
      }));

      const batchSize = 100;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const { error: insertError } = await supabase.from("sales").insert(batch);
        if (insertError) throw insertError;

        const completed = start + batch.length;
        const percentage = records.length
          ? 10 + Math.round((completed / records.length) * 90)
          : 100;
        setProgress(Math.min(100, percentage));
      }

      setProgress(100);
      const importedText = new Intl.NumberFormat("fa-IR").format(records.length);
      const skippedText = new Intl.NumberFormat("fa-IR").format(skippedCount);
      setMessage(
        skippedCount
          ? `${importedText} فروش جدید وارد شد و ${skippedText} ردیف تکراری نادیده گرفته شد.`
          : `${importedText} فروش با موفقیت وارد شد. حالا سابقه اسناد در پرونده هر مشتری دیده می‌شود.`,
      );
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : "خطای نامشخص در ورود فروش‌ها";
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className={styles.importer}>
      <div className={styles.dropzone}>
        <div className={styles.uploadIcon}>
          <Icon name="upload" size={30} />
        </div>
        <h3>فایل ریز فروش هلو را انتخاب کن</h3>
        <p>فقط فایل «ریز فروش هلو آماده ورود» که برای این مرحله ساخته شده است.</p>
        <label className={styles.fileButton}>
          انتخاب فایل فروش
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
          <span>
            {new Intl.NumberFormat("fa-IR").format(rows.length)} فروش آماده ورود
          </span>
        </div>
      ) : null}

      {rows.length ? (
        <div className={styles.preview}>
          <span>نمونه:</span>
          {rows.slice(0, 3).map((row) => (
            <b key={row.external_key}>
              {row.customer_name} — سند {row.document_number || "بدون شماره"}
            </b>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.progress}>
          <div style={{ width: `${progress}%` }} />
          <span>{new Intl.NumberFormat("fa-IR").format(progress)}٪</span>
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
        <Icon name="check" size={19} />
        {loading ? "در حال ورود ریز فروش‌ها..." : "ورود ریز فروش‌ها به برنامه"}
      </button>
    </article>
  );
}
