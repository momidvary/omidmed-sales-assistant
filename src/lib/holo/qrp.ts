import { jalaliToGregorian } from "@/lib/jalali";

type EmfText = {
  x: number;
  y: number;
  text: string;
};

type PageText = {
  pageNumber: number;
  records: EmfText[];
};

export type ParsedHoloInvoice = {
  invoiceNumber: string;
  documentNumber: string | null;
  invoiceDate: string;
  jalaliInvoiceDate: string;
  customerName: string;
  totalQuantity: number;
  totalAmount: number;
  cashAmount: number;
  checkAmount: number;
  cardAmount: number;
  accountBalanceAmount: number;
  accountBalanceStatus: "debtor" | "creditor" | "zero" | "unknown";
  discountAmount: number;
  dueDate: string | null;
  jalaliDueDate: string | null;
  discountPercent: number;
  transactionStatus: string | null;
  sourcePage: number;
  sourceRow: number;
};

export type ParsedHoloInvoiceItem = {
  invoiceNumber: string;
  jalaliInvoiceDate: string;
  rowNumber: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  description: string | null;
  sourcePage: number;
};

const EMF_SIGNATURE = [0x20, 0x45, 0x4d, 0x46];
const EMR_HEADER = 1;
const EMR_EXTTEXTOUTW = 84;
const textDecoder = new TextDecoder("utf-16le");

function readUint32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function readInt32(view: DataView, offset: number) {
  return view.getInt32(offset, true);
}

function hasSignature(bytes: Uint8Array, offset: number) {
  return EMF_SIGNATURE.every((value, index) => bytes[offset + index] === value);
}

export function normalizeHoloText(value: string) {
  let result = "";

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code >= 0xf020 && code <= 0xf07e) {
      result += String.fromCharCode(code - 0xf000);
    } else {
      result += character;
    }
  }

  return result
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[إأٱ]/g, "ا")
    .replace(/ـ/g, "")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/[–—]/g, "-")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCustomerName(value: string) {
  return normalizeHoloText(value)
    .replace(/[()\[\]{}،,:؛;.!؟?"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}

export function stableTextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function findEmfPages(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const pages: Array<{ start: number; end: number }> = [];

  for (let offset = 40; offset <= bytes.length - 4; offset += 1) {
    if (!hasSignature(bytes, offset)) continue;

    const start = offset - 40;
    if (start < 0 || start + 56 > bytes.length) continue;
    if (readUint32(view, start) !== EMR_HEADER) continue;

    const recordSize = readUint32(view, start + 4);
    const totalBytes = readUint32(view, start + 48);
    if (recordSize < 88 || totalBytes < recordSize) continue;
    if (start + totalBytes > bytes.length) continue;

    pages.push({ start, end: start + totalBytes });
    offset = start + totalBytes - 1;
  }

  return pages;
}

function extractPageText(buffer: ArrayBuffer): PageText[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const pages = findEmfPages(buffer);

  if (!pages.length) {
    throw new Error(
      "ساختار فایل QRP قابل‌خواندن نیست. گزارش را دوباره از پیش‌نمایش هلو ذخیره کن.",
    );
  }

  return pages.map((page, pageIndex) => {
    const records: EmfText[] = [];
    let offset = page.start;

    while (offset + 8 <= page.end) {
      const type = readUint32(view, offset);
      const size = readUint32(view, offset + 4);

      if (size < 8 || offset + size > page.end) break;

      if (type === EMR_EXTTEXTOUTW && size >= 76) {
        const x = readInt32(view, offset + 36);
        const y = readInt32(view, offset + 40);
        const characterCount = readUint32(view, offset + 44);
        const stringOffset = readUint32(view, offset + 48);
        const textStart = offset + stringOffset;
        const textEnd = textStart + characterCount * 2;

        if (
          characterCount > 0 &&
          stringOffset > 0 &&
          textStart >= offset &&
          textEnd <= offset + size
        ) {
          const raw = bytes.slice(textStart, textEnd);
          const text = normalizeHoloText(textDecoder.decode(raw));
          if (text) records.push({ x, y, text });
        }
      }

      offset += size;
    }

    return { pageNumber: pageIndex + 1, records };
  });
}

function groupByRow(records: EmfText[]) {
  const rows = new Map<number, EmfText[]>();
  for (const record of records) {
    const row = rows.get(record.y) ?? [];
    row.push(record);
    rows.set(record.y, row);
  }
  return Array.from(rows.entries()).sort(([first], [second]) => first - second);
}

function findHeaderX(
  records: EmfText[],
  labels: string[],
  fallback: number,
) {
  const normalizedLabels = labels.map(normalizeHoloText);
  const match = records.find((record) =>
    normalizedLabels.some((label) => record.text.includes(label)),
  );
  return match?.x ?? fallback;
}

function nearestText(records: EmfText[], x: number, tolerance: number) {
  const matches = records
    .filter((record) => Math.abs(record.x - x) <= tolerance)
    .sort(
      (first, second) =>
        Math.abs(first.x - x) - Math.abs(second.x - x),
    );
  return matches[0]?.text ?? "";
}

function parseNumber(value: string) {
  const normalized = normalizeHoloText(value).replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseInteger(value: string) {
  return Math.trunc(parseNumber(value));
}

function parseJalaliDate(value: string) {
  const normalized = normalizeHoloText(value)
    .replace(/[.-]/g, "/")
    .replace(/\s+/g, "");
  const match = normalized.match(/(14\d{2})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const gregorian = jalaliToGregorian(year, month, day);
  if (!gregorian) return null;

  const pad = (number: number) => String(number).padStart(2, "0");
  return {
    jalali: `${year}/${pad(month)}/${pad(day)}`,
    iso: `${gregorian.gy}-${pad(gregorian.gm)}-${pad(gregorian.gd)}`,
  };
}

function parseBalanceStatus(value: string) {
  const normalized = normalizeHoloText(value);
  if (!parseInteger(normalized)) return "zero" as const;
  if (normalized.includes("بد") || normalized.includes("بدهکار")) {
    return "debtor" as const;
  }
  if (normalized.includes("بس") || normalized.includes("بستانکار")) {
    return "creditor" as const;
  }
  return "unknown" as const;
}

export function parseInvoiceHeaderQrp(buffer: ArrayBuffer) {
  const pages = extractPageText(buffer);
  const invoices: ParsedHoloInvoice[] = [];

  for (const page of pages) {
    const rowHeaderX = findHeaderX(page.records, ["ردیف"], 1070);
    const scale = rowHeaderX / 1070 || 1;
    const x = (value: number) => Math.round(value * scale);
    const tolerance = (value: number) => Math.max(18, Math.round(value * Math.abs(scale)));

    for (const [, row] of groupByRow(page.records)) {
      const invoiceNumber = nearestText(row, x(1006), tolerance(36));
      const invoiceDate = parseJalaliDate(
        nearestText(row, x(959), tolerance(40)),
      );
      const customerName = nearestText(row, x(875), tolerance(58));

      if (!/^\d+$/.test(invoiceNumber) || !invoiceDate || !customerName) {
        continue;
      }

      const balanceText = nearestText(row, x(226), tolerance(48));
      const dueDate = parseJalaliDate(
        nearestText(row, x(-202), tolerance(52)),
      );
      const documentNumber = nearestText(row, x(-71), tolerance(48));
      const transactionStatus = nearestText(row, x(-343), tolerance(60));

      invoices.push({
        invoiceNumber,
        documentNumber: /^\d+$/.test(documentNumber)
          ? documentNumber
          : null,
        invoiceDate: invoiceDate.iso,
        jalaliInvoiceDate: invoiceDate.jalali,
        customerName,
        totalQuantity: parseNumber(nearestText(row, x(721), tolerance(58))),
        totalAmount: parseInteger(nearestText(row, x(632), tolerance(58))),
        cashAmount: parseInteger(nearestText(row, x(518), tolerance(58))),
        checkAmount: parseInteger(nearestText(row, x(434), tolerance(48))),
        cardAmount: parseInteger(nearestText(row, x(350), tolerance(48))),
        accountBalanceAmount: Math.abs(parseInteger(balanceText)),
        accountBalanceStatus: parseBalanceStatus(balanceText),
        discountAmount: parseInteger(nearestText(row, x(112), tolerance(58))),
        dueDate: dueDate?.iso ?? null,
        jalaliDueDate: dueDate?.jalali ?? null,
        discountPercent: parseNumber(
          nearestText(row, x(-259), tolerance(48)),
        ),
        transactionStatus: transactionStatus || null,
        sourcePage: page.pageNumber,
        sourceRow: invoices.length + 1,
      });
    }
  }

  if (!invoices.length) {
    throw new Error(
      "این فایل، گزارش «تیتر فاکتور» هلو نیست یا هیچ فاکتوری در آن پیدا نشد.",
    );
  }

  const duplicate = invoices.find(
    (invoice, index) =>
      invoices.findIndex(
        (candidate) => candidate.invoiceNumber === invoice.invoiceNumber,
      ) !== index,
  );
  if (duplicate) {
    throw new Error(
      `شماره فاکتور ${duplicate.invoiceNumber} بیش از یک‌بار در گزارش آمده است. بازه گزارش را بررسی کن.`,
    );
  }

  return invoices;
}

export function parseInvoiceItemsQrp(buffer: ArrayBuffer) {
  const pages = extractPageText(buffer);
  const items: ParsedHoloInvoiceItem[] = [];

  for (const page of pages) {
    const rowHeaderX = findHeaderX(page.records, ["ردیف"], 741);
    const scale = rowHeaderX / 741 || 1;
    const x = (value: number) => Math.round(value * scale);
    const tolerance = (value: number) => Math.max(16, Math.round(value * Math.abs(scale)));

    for (const [, row] of groupByRow(page.records)) {
      const rowNumberText = nearestText(row, x(741), tolerance(24));
      const invoiceNumber = nearestText(row, x(714), tolerance(24));
      const invoiceDate = parseJalaliDate(
        nearestText(row, x(630), tolerance(44)),
      );
      const productName = nearestText(row, x(546), tolerance(84));

      if (
        !/^\d+$/.test(rowNumberText) ||
        !/^\d+$/.test(invoiceNumber) ||
        !invoiceDate ||
        !productName
      ) {
        continue;
      }

      const description = nearestText(row, x(130), tolerance(94));
      items.push({
        invoiceNumber,
        jalaliInvoiceDate: invoiceDate.jalali,
        rowNumber: Number(rowNumberText),
        productName,
        quantity: parseNumber(nearestText(row, x(392), tolerance(52))),
        unitPrice: parseNumber(nearestText(row, x(318), tolerance(48))),
        lineTotal: parseInteger(nearestText(row, x(234), tolerance(48))),
        description: description || null,
        sourcePage: page.pageNumber,
      });
    }
  }

  if (!items.length) {
    throw new Error(
      "این فایل، گزارش «فاکتور ستونی» هلو نیست یا هیچ قلم کالایی در آن پیدا نشد.",
    );
  }

  return items;
}
