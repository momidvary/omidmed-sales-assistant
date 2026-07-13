"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/app-shell";
import {
  type CsvRow,
  isIsoDate,
  nullable,
  parseCsv,
  parseInteger,
  parseNumber,
} from "./csv-utils";
import styles from "./invoice-import.module.css";

const requiredHeaders = [
  "external_key",
  "customer_code",
  "customer_name",
  "raw_customer_name",
  "invoice_number",
  "document_number",
  "invoice_date",
  "jalali_invoice_date",
  "total_quantity",
  "total_amount",
  "cash_amount",
  "check_amount",
  "card_amount",
  "account_balance_amount",
  "account_balance_status",
  "discount_amount",
  "due_date",
  "jalali_due_date",
  "discount_percent",
  "transaction_status",
  "source_page",
  "source_row",
];

type InvoiceRecord = {
  customer_id: string;
  invoice_number: string;
  document_number: string | null;
  invoice_date: string;
  due_date: string | null;
  total_quantity: number;
  total_amount: number;
  cash_amount: number;
  check_amount: number;
  card_amount: number;
  account_balance_amount: number;
  account_balance_status: string;
  discount_amount: number;
  discount_percent: number;
  transaction_status: string | null;
  raw_customer_name: string | null;
  source: "holo_qrp";
  source_page: number | null;
  source_row: number | null;
  external_key: string;
};

const number = new Intl.NumberFormat("fa-IR");

export default function InvoiceImporter() {
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

    const invalidRow = parsed.find((row) => {
      const dueDateValid = !row.due_date || isIsoDate(row.due_date);
      return (
        !row.external_key ||
        !row.customer_code ||
        !row.invoice_number ||
        !isIsoDate(row.invoice_date) ||
        !dueDateValid ||
        !Number.isFinite(parseNumber(row.total_quantity)) ||
        !Number.isFinite(parseInteger(row.total_amount))
      );
    });

    if (invalidRow) {
      setError(
        "حداقل یک فاکتور، کد مشتری، شماره فاکتور، تاریخ یا مبلغ معتبر ندارد.",
      );
      return;
    }

    if (new Set(parsed.map((row) => row.external_key)).size !== parsed.length) {
      setError("داخل فایل، شناسه تکراری فاکتور وجود دارد.");
      return;
    }

    if (new Set(parsed.map((row) => row.invoice_number)).size !== parsed.length) {
      setError("داخل فایل، شماره فاکتور تکراری وجود دارد.");
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
        .from("invoices")
        .select("external_key")
        .eq("source", "holo_qrp")
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
          `برای ${number.format(missingCodes.length)} کد مشتری پیدا نشد. ابتدا بانک مشتریان را وارد کن. نمونه: ${missingCodes.slice(0, 5).join("، ")}`,
        );
      }

      setProgress(10);
      const existingKeys = await readExistingKeys();
      const pendingRows = rows.filter(
        (row) => !existingKeys.has(row.external_key),
      );
      const skippedCount = rows.length - pendingRows.length;

      const records: InvoiceRecord[] = pendingRows.map((row) => ({
        customer_id: idByCode.get(row.customer_code) as string,
        invoice_number: row.invoice_number,
        document_number: nullable(row.document_number),
        invoice_date: row.invoice_date,
        due_date: nullable(row.due_date),
        total_quantity: parseNumber(row.total_quantity),
        total_amount: parseInteger(row.total_amount),
        cash_amount: parseInteger(row.cash_amount),
        check_amount: parseInteger(row.check_amount),
        card_amount: parseInteger(row.card_amount),
        account_balance_amount: parseInteger(row.account_balance_amount),
        account_balance_status: row.account_balance_status || "unknown",
        discount_amount: parseInteger(row.discount_amount),
        discount_percent: parseNumber(row.discount_percent),
        transaction_status: nullable(row.transaction_status),
        raw_customer_name: nullable(row.raw_customer_name),
        source: "holo_qrp",
        source_page: Number.isFinite(parseInteger(row.source_page))
          ? parseInteger(row.source_page)
          : null,
        source_row: Number.isFinite(parseInteger(row.source_row))
          ? parseInteger(row.source_row)
          : null,
        external_key: row.external_key,
      }));

      const batchSize = 100;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const { error: insertError } = await supabase
          .from("invoices")
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
          ? `${number.format(records.length)} فاکتور جدید وارد شد و ${number.format(skippedCount)} فاکتور تکراری نادیده گرفته شد.`
          : `${number.format(records.length)} فاکتور با موفقیت وارد شد. حالا فایل اقلام را در کادر بعدی وارد کن.`,
      );
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : "خطای نامشخص در ورود فاکتورها";
      setError(
        text.includes("relation") || text.includes("invoices")
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
        <h4>فایل تیتر فاکتورها</h4>
        <p>فایل «فاکتورهای هلو آماده ورود.csv» را انتخاب کن.</p>
        <label className={styles.fileButton}>
          انتخاب فایل فاکتورها
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
          <span>{number.format(rows.length)} فاکتور آماده ورود</span>
        </div>
      ) : null}

      {rows.length ? (
        <div className={styles.preview}>
          {rows.slice(0, 3).map((row) => (
            <b key={row.external_key}>
              فاکتور {row.invoice_number} — {row.customer_name}
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
      {message ? <p className={styles.success}>{message}</p> : null}

      <button
        className={styles.submit}
        type="button"
        disabled={!rows.length || loading}
        onClick={importRows}
      >
        <Icon name="check" size={18} />
        {loading ? "در حال ورود فاکتورها..." : "ورود تیتر فاکتورها"}
      </button>
    </div>
  );
}
