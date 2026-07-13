"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/app-shell";
import {
  normalizeCustomerName,
  parseInvoiceHeaderQrp,
  parseInvoiceItemsQrp,
  stableTextHash,
  type ParsedHoloInvoice,
  type ParsedHoloInvoiceItem,
} from "@/lib/holo/qrp";
import { createClient } from "@/lib/supabase/client";
import styles from "./holo-sync.module.css";

const number = new Intl.NumberFormat("fa-IR");

type CustomerRow = {
  id: string;
  name: string;
  customer_code: string | null;
};

type ExistingInvoiceRow = {
  id: string;
  customer_id: string;
  invoice_number: string;
  document_number: string | null;
  invoice_date: string;
  due_date: string | null;
  total_quantity: number | string;
  total_amount: number | string;
  cash_amount: number | string;
  check_amount: number | string;
  card_amount: number | string;
  account_balance_amount: number | string;
  account_balance_status: string;
  discount_amount: number | string;
  discount_percent: number | string;
  transaction_status: string | null;
  raw_customer_name: string | null;
};

type ExistingItemRow = {
  invoice_id: string;
  row_number: number | null;
  product_name: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  description: string | null;
};

type Analysis = {
  customers: CustomerRow[];
  newCustomerNames: string[];
  ambiguousCustomerNames: string[];
  newInvoices: number;
  changedInvoices: number;
  unchangedInvoices: number;
  changedItemInvoices: number;
  orphanItemInvoices: string[];
};

function asNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function nullable(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function invoiceSignature(
  invoice: ParsedHoloInvoice,
  customerId: string | null,
) {
  return JSON.stringify({
    customerId,
    documentNumber: nullable(invoice.documentNumber),
    invoiceDate: invoice.invoiceDate,
    dueDate: nullable(invoice.dueDate),
    totalQuantity: asNumber(invoice.totalQuantity),
    totalAmount: asNumber(invoice.totalAmount),
    cashAmount: asNumber(invoice.cashAmount),
    checkAmount: asNumber(invoice.checkAmount),
    cardAmount: asNumber(invoice.cardAmount),
    accountBalanceAmount: asNumber(invoice.accountBalanceAmount),
    accountBalanceStatus: invoice.accountBalanceStatus,
    discountAmount: asNumber(invoice.discountAmount),
    discountPercent: asNumber(invoice.discountPercent),
    transactionStatus: nullable(invoice.transactionStatus),
    rawCustomerName: normalizeCustomerName(invoice.customerName),
  });
}

function existingInvoiceSignature(invoice: ExistingInvoiceRow) {
  return JSON.stringify({
    customerId: invoice.customer_id,
    documentNumber: nullable(invoice.document_number),
    invoiceDate: invoice.invoice_date,
    dueDate: nullable(invoice.due_date),
    totalQuantity: asNumber(invoice.total_quantity),
    totalAmount: asNumber(invoice.total_amount),
    cashAmount: asNumber(invoice.cash_amount),
    checkAmount: asNumber(invoice.check_amount),
    cardAmount: asNumber(invoice.card_amount),
    accountBalanceAmount: asNumber(invoice.account_balance_amount),
    accountBalanceStatus: invoice.account_balance_status,
    discountAmount: asNumber(invoice.discount_amount),
    discountPercent: asNumber(invoice.discount_percent),
    transactionStatus: nullable(invoice.transaction_status),
    rawCustomerName: normalizeCustomerName(invoice.raw_customer_name ?? ""),
  });
}

function parsedItemsSignature(items: ParsedHoloInvoiceItem[]) {
  return JSON.stringify(
    items.map((item, index) => ({
      order: index + 1,
      productName: item.productName,
      quantity: asNumber(item.quantity),
      unitPrice: asNumber(item.unitPrice),
      lineTotal: asNumber(item.lineTotal),
      description: nullable(item.description),
    })),
  );
}

function existingItemsSignature(items: ExistingItemRow[]) {
  return JSON.stringify(
    [...items]
      .sort(
        (first, second) =>
          (first.row_number ?? 0) - (second.row_number ?? 0),
      )
      .map((item, index) => ({
        order: index + 1,
        productName: item.product_name,
        quantity: asNumber(item.quantity),
        unitPrice: asNumber(item.unit_price),
        lineTotal: asNumber(item.line_total),
        description: nullable(item.description),
      })),
  );
}

async function readAllRows(table: string, select: string) {
  const supabase = createClient();
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data?.length ?? 0) < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function customerMap(
  customers: CustomerRow[],
  aliases: Array<{ customer_id: string; raw_customer_name: string | null }> = [],
) {
  const map = new Map<string, CustomerRow[]>();
  const customerById = new Map(
    customers.map((customer) => [customer.id, customer]),
  );

  function add(keyValue: string, customer: CustomerRow) {
    const key = normalizeCustomerName(keyValue);
    if (!key) return;
    const matches = map.get(key) ?? [];
    if (!matches.some((match) => match.id === customer.id)) {
      matches.push(customer);
    }
    map.set(key, matches);
  }

  for (const customer of customers) add(customer.name, customer);
  for (const alias of aliases) {
    const customer = customerById.get(alias.customer_id);
    if (customer && alias.raw_customer_name) {
      add(alias.raw_customer_name, customer);
    }
  }

  return map;
}

function resolveCustomerMatches(
  name: string,
  map: Map<string, CustomerRow[]>,
  customers: CustomerRow[],
) {
  const key = normalizeCustomerName(name);
  const exact = map.get(key) ?? [];
  if (exact.length) return exact;

  const words = key.split(" ").filter(Boolean);
  if (key.length < 8 || words.length < 2) return [];

  return customers.filter((customer) => {
    const candidate = normalizeCustomerName(customer.name);
    return candidate.startsWith(key) || key.startsWith(candidate);
  });
}

function batches<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

export default function HoloSync() {
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [invoices, setInvoices] = useState<ParsedHoloInvoice[]>([]);
  const [items, setItems] = useState<ParsedHoloInvoiceItem[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const invoiceNumbers = useMemo(
    () => new Set(invoices.map((invoice) => invoice.invoiceNumber)),
    [invoices],
  );

  function resetResults() {
    setInvoices([]);
    setItems([]);
    setAnalysis(null);
    setError("");
    setMessage("");
    setStage("");
    setProgress(0);
  }

  function chooseHeader(file?: File) {
    resetResults();
    if (!file) {
      setHeaderFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".qrp")) {
      setError("فایل تیتر فاکتور باید با پسوند QRP باشد.");
      setHeaderFile(null);
      return;
    }
    setHeaderFile(file);
  }

  function chooseItems(file?: File) {
    resetResults();
    if (!file) {
      setItemsFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".qrp")) {
      setError("فایل فاکتور ستونی باید با پسوند QRP باشد.");
      setItemsFile(null);
      return;
    }
    setItemsFile(file);
  }

  async function parseAndAnalyze() {
    if (!headerFile || !itemsFile || busy) return;

    setBusy(true);
    setError("");
    setMessage("");
    setAnalysis(null);
    setStage("در حال خواندن گزارش تیتر فاکتور...");
    setProgress(5);

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const parsedInvoices = parseInvoiceHeaderQrp(
        await headerFile.arrayBuffer(),
      );
      setProgress(25);
      setStage("در حال خواندن اقلام فاکتورها...");
      await new Promise((resolve) => setTimeout(resolve, 30));
      const parsedItems = parseInvoiceItemsQrp(await itemsFile.arrayBuffer());

      setInvoices(parsedInvoices);
      setItems(parsedItems);
      setProgress(45);
      setStage("در حال مقایسه با اطلاعات فعلی برنامه...");

      const headerNumbers = new Set(
        parsedInvoices.map((invoice) => invoice.invoiceNumber),
      );
      const orphanItemInvoices = Array.from(
        new Set(
          parsedItems
            .filter((item) => !headerNumbers.has(item.invoiceNumber))
            .map((item) => item.invoiceNumber),
        ),
      );

      const customers = (await readAllRows(
        "customers",
        "id,name,customer_code",
      )) as CustomerRow[];
      const existingInvoices = (await readAllRows(
        "invoices",
        "id,customer_id,invoice_number,document_number,invoice_date,due_date,total_quantity,total_amount,cash_amount,check_amount,card_amount,account_balance_amount,account_balance_status,discount_amount,discount_percent,transaction_status,raw_customer_name",
      )) as ExistingInvoiceRow[];
      const existingItems = (await readAllRows(
        "invoice_items",
        "invoice_id,row_number,product_name,quantity,unit_price,line_total,description",
      )) as ExistingItemRow[];

      const customersByName = customerMap(customers, existingInvoices);
      const uniqueNames = Array.from(
        new Map(
          parsedInvoices.map((invoice) => [
            normalizeCustomerName(invoice.customerName),
            invoice.customerName,
          ]),
        ).entries(),
      );
      const newCustomerNames: string[] = [];
      const ambiguousCustomerNames: string[] = [];

      for (const [, displayName] of uniqueNames) {
        const matches = resolveCustomerMatches(
          displayName,
          customersByName,
          customers,
        );
        if (!matches.length) newCustomerNames.push(displayName);
        if (matches.length > 1) ambiguousCustomerNames.push(displayName);
      }

      const existingByNumber = new Map(
        existingInvoices.map((invoice) => [invoice.invoice_number, invoice]),
      );
      let newInvoices = 0;
      let changedInvoices = 0;
      let unchangedInvoices = 0;

      for (const invoice of parsedInvoices) {
        const existing = existingByNumber.get(invoice.invoiceNumber);
        if (!existing) {
          newInvoices += 1;
          continue;
        }
        const matches = resolveCustomerMatches(
          invoice.customerName,
          customersByName,
          customers,
        );
        const expectedCustomerId = matches.length === 1 ? matches[0].id : null;
        if (
          invoiceSignature(invoice, expectedCustomerId) ===
          existingInvoiceSignature(existing)
        ) {
          unchangedInvoices += 1;
        } else {
          changedInvoices += 1;
        }
      }

      const invoiceNumberById = new Map(
        existingInvoices.map((invoice) => [invoice.id, invoice.invoice_number]),
      );
      const existingItemsByInvoice = new Map<string, ExistingItemRow[]>();
      for (const item of existingItems) {
        const invoiceNumber = invoiceNumberById.get(item.invoice_id);
        if (!invoiceNumber) continue;
        const group = existingItemsByInvoice.get(invoiceNumber) ?? [];
        group.push(item);
        existingItemsByInvoice.set(invoiceNumber, group);
      }
      const parsedItemsByInvoice = new Map<string, ParsedHoloInvoiceItem[]>();
      for (const item of parsedItems) {
        const group = parsedItemsByInvoice.get(item.invoiceNumber) ?? [];
        group.push(item);
        parsedItemsByInvoice.set(item.invoiceNumber, group);
      }

      let changedItemInvoices = 0;
      for (const [invoiceNumber, parsedGroup] of parsedItemsByInvoice) {
        const existingGroup = existingItemsByInvoice.get(invoiceNumber) ?? [];
        if (
          parsedItemsSignature(parsedGroup) !==
          existingItemsSignature(existingGroup)
        ) {
          changedItemInvoices += 1;
        }
      }

      setAnalysis({
        customers,
        newCustomerNames,
        ambiguousCustomerNames,
        newInvoices,
        changedInvoices,
        unchangedInvoices,
        changedItemInvoices,
        orphanItemInvoices,
      });
      setProgress(100);
      setStage("بررسی کامل شد.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "فایل‌های هلو قابل‌خواندن نبودند.",
      );
      setProgress(0);
      setStage("");
    } finally {
      setBusy(false);
    }
  }

  async function synchronize() {
    if (!analysis || !invoices.length || !items.length || busy) return;
    if (analysis.orphanItemInvoices.length) {
      setError(
        "بعضی اقلام، تیتر فاکتور متناظر ندارند. هر دو گزارش را دقیقاً با یک بازه زمانی بگیر.",
      );
      return;
    }
    if (analysis.ambiguousCustomerNames.length) {
      setError(
        `برای این نام‌ها بیش از یک مشتری پیدا شد و ادغام خودکار امن نیست: ${analysis.ambiguousCustomerNames.slice(0, 8).join("، ")}`,
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setStage("در حال آماده‌سازی حساب کاربری...");
    setProgress(4);

    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("نشست ورود منقضی شده است. دوباره وارد شو.");
      const ownerId = authData.user.id;

      setStage("در حال ثبت مشتریان جدید...");
      setProgress(10);
      if (analysis.newCustomerNames.length) {
        const records = analysis.newCustomerNames.map((name) => ({
          owner_id: ownerId,
          customer_code: `holo-sync-${stableTextHash(normalizeCustomerName(name))}`,
          name,
          status: "active",
          priority: "normal",
          notes: "ایجاد خودکار هنگام به‌روزرسانی مستقیم از گزارش هلو",
        }));

        for (const batch of batches(records, 100)) {
          const { error: insertError } = await supabase
            .from("customers")
            .insert(batch);
          if (insertError && insertError.code !== "23505") throw insertError;
        }
      }

      const customers = (await readAllRows(
        "customers",
        "id,name,customer_code",
      )) as CustomerRow[];
      const invoiceAliases = (await readAllRows(
        "invoices",
        "customer_id,raw_customer_name",
      )) as Array<{ customer_id: string; raw_customer_name: string | null }>;
      const customersByName = customerMap(customers, invoiceAliases);

      const unmatchedNames: string[] = [];
      const invoiceRecords = invoices.flatMap((invoice) => {
        const matches = resolveCustomerMatches(
          invoice.customerName,
          customersByName,
          customers,
        );
        if (matches.length !== 1) {
          unmatchedNames.push(invoice.customerName);
          return [];
        }

        return [
          {
            owner_id: ownerId,
            customer_id: matches[0].id,
            invoice_number: invoice.invoiceNumber,
            document_number: invoice.documentNumber,
            invoice_date: invoice.invoiceDate,
            due_date: invoice.dueDate,
            total_quantity: invoice.totalQuantity,
            total_amount: invoice.totalAmount,
            cash_amount: invoice.cashAmount,
            check_amount: invoice.checkAmount,
            card_amount: invoice.cardAmount,
            account_balance_amount: invoice.accountBalanceAmount,
            account_balance_status: invoice.accountBalanceStatus,
            discount_amount: invoice.discountAmount,
            discount_percent: invoice.discountPercent,
            transaction_status: invoice.transactionStatus,
            raw_customer_name: invoice.customerName,
            source: "holo_qrp",
            source_page: invoice.sourcePage,
            source_row: invoice.sourceRow,
            external_key: `holo-qrp-invoice-${invoice.invoiceNumber}`,
          },
        ];
      });

      if (unmatchedNames.length) {
        throw new Error(
          `برای ${number.format(new Set(unmatchedNames).size)} مشتری تطبیق امن پیدا نشد. نمونه: ${Array.from(new Set(unmatchedNames)).slice(0, 6).join("، ")}`,
        );
      }

      setStage("در حال به‌روزرسانی تیتر فاکتورها...");
      setProgress(20);
      const invoiceBatches = batches(invoiceRecords, 100);
      for (let index = 0; index < invoiceBatches.length; index += 1) {
        const { error: upsertError } = await supabase
          .from("invoices")
          .upsert(invoiceBatches[index], {
            onConflict: "owner_id,invoice_number",
          });
        if (upsertError) throw upsertError;
        setProgress(20 + Math.round(((index + 1) / invoiceBatches.length) * 25));
      }

      setStage("در حال اتصال اقلام به فاکتورها...");
      const invoiceIds = new Map<string, string>();
      const invoiceNumberList = invoices.map((invoice) => invoice.invoiceNumber);
      for (const batch of batches(invoiceNumberList, 150)) {
        const { data, error: readError } = await supabase
          .from("invoices")
          .select("id,invoice_number")
          .in("invoice_number", batch);
        if (readError) throw readError;
        for (const invoice of data ?? []) {
          invoiceIds.set(invoice.invoice_number as string, invoice.id as string);
        }
      }

      if (invoiceIds.size !== invoiceNumberList.length) {
        throw new Error("بعضی فاکتورها پس از ثبت پیدا نشدند. عملیات را دوباره اجرا کن.");
      }

      setStage("در حال جایگزینی نسخه قدیمی اقلام فاکتورها...");
      setProgress(50);
      const invoiceIdList = Array.from(invoiceIds.values());
      const deleteBatches = batches(invoiceIdList, 60);
      for (let index = 0; index < deleteBatches.length; index += 1) {
        const { error: deleteError } = await supabase
          .from("invoice_items")
          .delete()
          .in("invoice_id", deleteBatches[index]);
        if (deleteError) throw deleteError;
        setProgress(50 + Math.round(((index + 1) / deleteBatches.length) * 10));
      }

      const orderByInvoice = new Map<string, number>();
      const itemRecords = items.map((item) => {
        const order = (orderByInvoice.get(item.invoiceNumber) ?? 0) + 1;
        orderByInvoice.set(item.invoiceNumber, order);
        return {
          owner_id: ownerId,
          invoice_id: invoiceIds.get(item.invoiceNumber) as string,
          row_number: item.rowNumber,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          line_total: item.lineTotal,
          description: item.description,
          source_page: item.sourcePage,
          external_key: `holo-qrp-item-${item.invoiceNumber}-${order}`,
        };
      });

      setStage("در حال ثبت اقلام فاکتورها...");
      const itemBatches = batches(itemRecords, 150);
      for (let index = 0; index < itemBatches.length; index += 1) {
        const { error: insertError } = await supabase
          .from("invoice_items")
          .insert(itemBatches[index]);
        if (insertError) throw insertError;
        setProgress(60 + Math.round(((index + 1) / itemBatches.length) * 38));
      }

      const { error: logError } = await supabase.from("holo_import_runs").insert({
        owner_id: ownerId,
        header_file_name: headerFile?.name ?? null,
        items_file_name: itemsFile?.name ?? null,
        invoice_count: invoices.length,
        item_count: items.length,
        new_customer_count: analysis.newCustomerNames.length,
        new_invoice_count: analysis.newInvoices,
        changed_invoice_count: analysis.changedInvoices,
        unchanged_invoice_count: analysis.unchangedInvoices,
        changed_item_invoice_count: analysis.changedItemInvoices,
        status: "completed",
      });

      setProgress(100);
      setStage("به‌روزرسانی کامل شد.");
      setMessage(
        `${number.format(invoices.length)} فاکتور و ${number.format(items.length)} ردیف کالا با موفقیت همگام شد.${logError ? " گزارش تاریخچه ذخیره نشد، اما اطلاعات فروش کامل ثبت شد." : ""}`,
      );
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : "خطای نامشخص در همگام‌سازی";
      setError(
        text.includes("holo_import_runs") || text.includes("relation")
          ? `${text} — فایل SQL مرحله همگام‌سازی را در Supabase اجرا کن.`
          : text,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.fileGrid}>
        <article className={styles.fileCard}>
          <div className={styles.fileIcon}>
            <Icon name="upload" size={27} />
          </div>
          <span>فایل اول</span>
          <h3>تیتر فاکتور.QRP</h3>
          <p>شماره فاکتور، مشتری، تاریخ، مبلغ، شماره سند و وضعیت تسویه</p>
          <label className={styles.fileButton}>
            انتخاب گزارش تیتر فاکتور
            <input
              type="file"
              accept=".qrp"
              onChange={(event) => chooseHeader(event.target.files?.[0])}
            />
          </label>
          {headerFile ? (
            <div className={styles.selectedFile}>
              <strong>{headerFile.name}</strong>
              <span>{number.format(Math.round(headerFile.size / 1024))} کیلوبایت</span>
            </div>
          ) : null}
        </article>

        <article className={styles.fileCard}>
          <div className={styles.fileIcon}>
            <Icon name="upload" size={27} />
          </div>
          <span>فایل دوم</span>
          <h3>فاکتور ستونی.QRP</h3>
          <p>نام کالا، تعداد، قیمت واحد، مبلغ ردیف و توضیحات هر فاکتور</p>
          <label className={styles.fileButton}>
            انتخاب گزارش فاکتور ستونی
            <input
              type="file"
              accept=".qrp"
              onChange={(event) => chooseItems(event.target.files?.[0])}
            />
          </label>
          {itemsFile ? (
            <div className={styles.selectedFile}>
              <strong>{itemsFile.name}</strong>
              <span>{number.format(Math.round(itemsFile.size / 1024))} کیلوبایت</span>
            </div>
          ) : null}
        </article>
      </section>

      <section className={styles.instructions}>
        <strong>هر دو گزارش باید یک بازه زمانی یکسان داشته باشند</strong>
        <p>
          مطمئن‌ترین روش این است که هر بار گزارش کامل از ابتدای اطلاعات تا امروز
          را بگیری. برنامه فاکتورهای قبلی را تکراری ثبت نمی‌کند و اصلاحات را با
          نسخه جدید جایگزین می‌کند.
        </p>
      </section>

      <button
        className={styles.analyzeButton}
        type="button"
        disabled={!headerFile || !itemsFile || busy}
        onClick={parseAndAnalyze}
      >
        <Icon name="search" size={19} />
        {busy && !analysis ? "در حال بررسی فایل‌ها..." : "بررسی فایل‌ها قبل از ثبت"}
      </button>

      {stage || busy ? (
        <div className={styles.progressBox}>
          <div className={styles.progressHeader}>
            <span>{stage}</span>
            <b>{number.format(progress)}٪</b>
          </div>
          <div className={styles.progressTrack}>
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {invoices.length && items.length ? (
        <section className={styles.parsedSummary}>
          <div>
            <span>فاکتور خوانده‌شده</span>
            <strong>{number.format(invoices.length)}</strong>
          </div>
          <div>
            <span>ردیف کالا</span>
            <strong>{number.format(items.length)}</strong>
          </div>
          <div>
            <span>اولین فاکتور</span>
            <strong>{invoices[0]?.jalaliInvoiceDate ?? "—"}</strong>
          </div>
          <div>
            <span>آخرین فاکتور</span>
            <strong>{invoices.at(-1)?.jalaliInvoiceDate ?? "—"}</strong>
          </div>
          <div>
            <span>شماره آخرین فاکتور</span>
            <strong>{invoices.at(-1)?.invoiceNumber ?? "—"}</strong>
          </div>
          <div>
            <span>اقلام بدون تیتر</span>
            <strong>
              {number.format(
                items.filter((item) => !invoiceNumbers.has(item.invoiceNumber))
                  .length,
              )}
            </strong>
          </div>
        </section>
      ) : null}

      {analysis ? (
        <section className={styles.analysisBox}>
          <div className={styles.analysisTitle}>
            <div>
              <span>پیش‌نمایش تغییرات</span>
              <h3>قبل از ثبت نهایی</h3>
            </div>
            <Icon name="chart" size={25} />
          </div>

          <div className={styles.analysisGrid}>
            <div className={styles.positive}>
              <span>فاکتور جدید</span>
              <strong>{number.format(analysis.newInvoices)}</strong>
            </div>
            <div className={styles.warning}>
              <span>فاکتور اصلاح‌شده</span>
              <strong>{number.format(analysis.changedInvoices)}</strong>
            </div>
            <div>
              <span>بدون تغییر</span>
              <strong>{number.format(analysis.unchangedInvoices)}</strong>
            </div>
            <div className={styles.warning}>
              <span>فاکتور با اقلام تغییرکرده</span>
              <strong>{number.format(analysis.changedItemInvoices)}</strong>
            </div>
            <div className={styles.positive}>
              <span>مشتری جدید</span>
              <strong>{number.format(analysis.newCustomerNames.length)}</strong>
            </div>
            <div className={analysis.ambiguousCustomerNames.length ? styles.danger : ""}>
              <span>نام مشتری مبهم</span>
              <strong>{number.format(analysis.ambiguousCustomerNames.length)}</strong>
            </div>
          </div>

          {analysis.newCustomerNames.length ? (
            <p className={styles.smallNotice}>
              مشتریان جدید هنگام ثبت ساخته می‌شوند: {analysis.newCustomerNames.slice(0, 6).join("، ")}
              {analysis.newCustomerNames.length > 6 ? " و ..." : ""}
            </p>
          ) : null}

          {analysis.orphanItemInvoices.length ? (
            <p className={styles.dangerNotice}>
              برای شماره فاکتورهای زیر تیتر پیدا نشد: {analysis.orphanItemInvoices.slice(0, 8).join("، ")}
            </p>
          ) : null}

          <button
            className={styles.syncButton}
            type="button"
            disabled={
              busy ||
              Boolean(analysis.ambiguousCustomerNames.length) ||
              Boolean(analysis.orphanItemInvoices.length)
            }
            onClick={synchronize}
          >
            <Icon name="check" size={20} />
            {busy ? "در حال به‌روزرسانی اطلاعات..." : "تأیید و به‌روزرسانی اطلاعات هلو"}
          </button>
        </section>
      ) : null}

      {message ? (
        <section className={styles.successBox}>
          <strong>به‌روزرسانی موفق بود</strong>
          <p>{message}</p>
          <Link href="/customers">مشاهده بانک مشتریان ←</Link>
        </section>
      ) : null}
    </div>
  );
}
