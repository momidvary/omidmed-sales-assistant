// Parses the Resalat bank "صورت حساب سپرده" PDF (mobile/internet bank export)
// from positioned text items. Pure: no pdf.js here, so it is unit-testable.
//
// Layout facts this relies on (verified on a real statement):
// - one header row with fixed column titles (ردیف ... یادداشت);
// - each transaction has its row number in the ردیف column on its middle line,
//   while its description wraps over several lines above and below;
// - amounts are in rial;
// - balances chain: newer.balance = older.balance - withdrawal + deposit.

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  dir: "ltr" | "rtl" | "ttb" | string;
};

export type ColumnKey =
  | "row"
  | "branch"
  | "date"
  | "time"
  | "document"
  | "receipt"
  | "cheque"
  | "description"
  | "withdrawal"
  | "deposit"
  | "balance"
  | "note";

export type BankTransaction = {
  rowNo: number;
  branch: string;
  jalaliDate: string;
  gregorianDate: string;
  time: string;
  documentNo: string;
  referenceNo: string;
  chequeNo: string;
  description: string;
  note: string;
  withdrawalRial: number;
  depositRial: number;
  balanceRial: number | null;
  kind: "deposit" | "withdrawal";
  isFee: boolean;
  counterpartyName: string | null;
  counterpartyCard: string | null;
  fingerprint: string;
};

export type ParsedStatement = {
  accountNo: string | null;
  fromDate: string | null;
  toDate: string | null;
  transactions: BankTransaction[];
  /** Row numbers whose balance does not chain with their neighbours. */
  balanceMismatches: number[];
  totals: { withdrawalRial: number; depositRial: number };
  /** Totals printed in the statement's footer, when present. */
  statementTotals: { withdrawalRial: number | null; depositRial: number | null };
};

const HEADER_TITLES: Array<[ColumnKey, string]> = [
  ["row", "ردیف"],
  ["branch", "شعبه"],
  ["date", "تاریخ"],
  ["time", "ساعت"],
  ["document", "شماره سند"],
  ["receipt", "شماره قبض"],
  ["cheque", "شماره چک"],
  ["description", "توضیحات"],
  ["withdrawal", "برداشت"],
  ["deposit", "واریز"],
  ["balance", "مانده"],
  ["note", "یادداشت"],
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function latinDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

// The bank writes some depositor names as Windows-1256 bytes shown as
// Latin-1 ("ÇÍ Ï ÚÇáí"). Map those characters back to the Arabic script.
let cp1256: TextDecoder | null = null;
export function fixMojibake(value: string) {
  if (!/[À-ÿ]/.test(value)) return value;
  cp1256 ??= new TextDecoder("windows-1256");
  return value.replace(/[\u0080-ÿ]+/g, (run) =>
    cp1256!.decode(Uint8Array.from(run, (char) => char.charCodeAt(0))),
  );
}

export function normalizeItemText(item: PdfTextItem) {
  let text = item.str.normalize("NFKC");
  if (item.dir === "rtl") {
    // Glyph-level mirroring leaves brackets reversed in RTL runs.
    text = text.replace(/[()]/g, (bracket) => (bracket === "(" ? ")" : "("));
  }
  const repaired = fixMojibake(text);
  if (repaired !== text && item.dir === "ltr") {
    // A mis-encoded run is laid out as an LTR run, so its words come out in
    // visual order; flip them back to Persian reading order.
    text = repaired.trim().split(/\s+/).reverse().join(" ");
  } else {
    text = repaired;
  }
  return text.replace(/\s+/g, " ").trim();
}

function center(item: PdfTextItem) {
  return item.x + item.w / 2;
}

type Header = { columns: Map<ColumnKey, number>; headerY: number };

function findHeader(items: PdfTextItem[]): Header | null {
  const columns = new Map<ColumnKey, number>();
  let headerY: number | null = null;
  for (const [key, title] of HEADER_TITLES) {
    const match = items.find((item) => normalizeItemText(item) === title);
    if (match) {
      columns.set(key, center(match));
      headerY = headerY === null ? match.y : Math.max(headerY, match.y);
    }
  }
  const required: ColumnKey[] = ["row", "date", "description", "withdrawal", "deposit", "balance"];
  if (!required.every((key) => columns.has(key))) return null;
  return { columns, headerY: headerY ?? 0 };
}

function nearestColumn(item: PdfTextItem, columns: Map<ColumnKey, number>) {
  let best: ColumnKey = "description";
  let distance = Infinity;
  const c = center(item);
  for (const [key, x] of columns) {
    const d = Math.abs(c - x);
    if (d < distance) {
      distance = d;
      best = key;
    }
  }
  return best;
}

export function parseAmount(value: string) {
  const cleaned = latinDigits(value).replace(/[,٬\s]/g, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

function joinCell(items: PdfTextItem[], separator: string) {
  return items
    .slice()
    .sort((a, b) => a.y - b.y || (a.dir === "rtl" ? b.x - a.x : a.x - b.x))
    .map(normalizeItemText)
    .filter(Boolean)
    .join(separator)
    .trim();
}

function toGregorianIso(jalali: string, convert: JalaliConverter) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(jalali);
  if (!match) return null;
  const result = convert(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!result) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${result.gy}-${pad(result.gm)}-${pad(result.gd)}`;
}

export type JalaliConverter = (
  year: number,
  month: number,
  day: number,
) => { gy: number; gm: number; gd: number } | null;

const OWNER_SEPARATORS = /\s*(?:\(|\)|-|ازاینترنت| از اینترنت| از |$)/;

function cleanName(raw: string | undefined) {
  if (!raw) return null;
  const name = raw.split(OWNER_SEPARATORS)[0]?.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 80) : null;
}

/** Who the money came from (deposit) or went to (withdrawal). */
export function extractCounterparty(description: string, kind: "deposit" | "withdrawal") {
  const text = description.replace(/\s+/g, " ");
  const transfer =
    /انتقال از کارت (\d{16}) متعلق به (.+?) به کارت (\d{16}) متعلق به (.+?)(?: از |$)/.exec(text);
  if (transfer) {
    return kind === "withdrawal"
      ? { card: transfer[3], name: cleanName(transfer[4]) }
      : { card: transfer[1], name: cleanName(transfer[2]) };
  }
  const by = /توسط (.+?)$/.exec(text);
  if (by) return { card: null, name: cleanName(by[1]) };
  const owner = /متعلق به (.+?)(?: از |$)/.exec(text);
  if (owner) return { card: /(\d{16})/.exec(text)?.[1] ?? null, name: cleanName(owner[1]) };
  return { card: null, name: null };
}

export function transactionFingerprint(
  accountNo: string | null,
  tx: Pick<BankTransaction, "jalaliDate" | "time" | "documentNo" | "withdrawalRial" | "depositRial" | "balanceRial">,
) {
  return [
    accountNo ?? "-",
    tx.jalaliDate,
    tx.time,
    tx.documentNo,
    tx.withdrawalRial,
    tx.depositRial,
    tx.balanceRial ?? "-",
  ].join("|");
}

/** Value printed just left of a footer label on the same line. */
function footerValue(items: PdfTextItem[], label: string) {
  const labelItem = items.find((item) => normalizeItemText(item).startsWith(label));
  if (!labelItem) return null;
  const candidates = items
    .filter((item) => Math.abs(item.y - labelItem.y) < 3 && item.x < labelItem.x)
    .map((item) => ({ item, amount: parseAmount(latinDigits(item.str.trim())) }))
    .filter((entry) => entry.amount !== null)
    .sort((a, b) => b.item.x - a.item.x);
  return candidates[0]?.amount ?? null;
}

function checkBalances(transactions: BankTransaction[]) {
  const failures = (ordered: BankTransaction[]) => {
    const bad = new Set<number>();
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const newer = ordered[i];
      const older = ordered[i + 1];
      if (newer.balanceRial === null || older.balanceRial === null) continue;
      const expected = older.balanceRial - newer.withdrawalRial + newer.depositRial;
      if (expected !== newer.balanceRial) {
        bad.add(newer.rowNo);
        bad.add(older.rowNo);
      }
    }
    return bad;
  };
  const newestFirst = failures(transactions);
  const oldestFirst = failures(transactions.slice().reverse());
  return [...(newestFirst.size <= oldestFirst.size ? newestFirst : oldestFirst)].sort((a, b) => a - b);
}

/** Problems that make a parsed statement unsafe to import. */
export function statementProblems(statement: ParsedStatement) {
  const problems: string[] = [];
  if (!statement.accountNo) problems.push("شماره حساب در فایل پیدا نشد.");
  if (!statement.transactions.length) problems.push("هیچ تراکنشی در فایل پیدا نشد.");
  if (statement.balanceMismatches.length) {
    problems.push(`مانده ردیف‌های ${statement.balanceMismatches.join("، ")} با مبالغ نمی‌خواند.`);
  }
  const { statementTotals: printed, totals } = statement;
  if (printed.depositRial !== null && printed.depositRial !== totals.depositRial) {
    problems.push("جمع واریزها با جمع چاپ‌شده در پایین صورت‌حساب برابر نیست.");
  }
  if (printed.withdrawalRial !== null && printed.withdrawalRial !== totals.withdrawalRial) {
    problems.push("جمع برداشت‌ها با جمع چاپ‌شده در پایین صورت‌حساب برابر نیست.");
  }
  return problems;
}

export function parseResalatStatement(
  pages: PdfTextItem[][],
  convertJalali: JalaliConverter,
): ParsedStatement {
  let accountNo: string | null = null;
  let fromDate: string | null = null;
  let toDate: string | null = null;
  let lastHeader: Header | null = null;
  const transactions: BankTransaction[] = [];
  const statementTotals: ParsedStatement["statementTotals"] = { withdrawalRial: null, depositRial: null };

  for (const pageItems of pages) {
    const items = pageItems.filter((item) => item.str.trim());
    for (const item of items) {
      const text = latinDigits(normalizeItemText(item));
      const range = /صورتحساب سپرده ([\d.]+) از تاریخ (\d{4}\/\d{2}\/\d{2}) تا تاریخ (\d{4}\/\d{2}\/\d{2})/.exec(text);
      if (range) {
        accountNo = range[1];
        fromDate = range[2];
        toDate = range[3];
      }
    }

    const header: Header | null = findHeader(items) ?? lastHeader;
    if (!header) continue;
    lastHeader = header;
    const { columns, headerY } = header;

    // The statistics block ends the table.
    const footer = items.find((item) => normalizeItemText(item).startsWith("اطلاعات آماری"));
    const tableEnd = footer ? footer.y : Infinity;
    statementTotals.depositRial ??= footerValue(items, "جمع کل واریزها");
    statementTotals.withdrawalRial ??= footerValue(items, "جمع کل برداشت");
    const tableItems = items.filter((item) => item.y > headerY + 1 && item.y < tableEnd - 1);

    const anchors = tableItems
      .filter((item) => nearestColumn(item, columns) === "row" && /^\d+$/.test(latinDigits(item.str.trim())))
      .sort((a, b) => a.y - b.y);
    if (!anchors.length) continue;

    anchors.forEach((anchor, index) => {
      const top = index === 0 ? headerY + 1 : (anchors[index - 1].y + anchor.y) / 2;
      const bottom = index === anchors.length - 1 ? tableEnd : (anchor.y + anchors[index + 1].y) / 2;
      const cells = new Map<ColumnKey, PdfTextItem[]>();
      for (const item of tableItems) {
        if (item.y < top || item.y >= bottom) continue;
        const key = nearestColumn(item, columns);
        cells.set(key, [...(cells.get(key) ?? []), item]);
      }
      const cell = (key: ColumnKey, separator = " ") => latinDigits(joinCell(cells.get(key) ?? [], separator));

      const jalaliDate = cell("date");
      const gregorianDate = toGregorianIso(jalaliDate, convertJalali);
      const withdrawalRial = parseAmount(cell("withdrawal")) ?? 0;
      const depositRial = parseAmount(cell("deposit")) ?? 0;
      if (!gregorianDate || (withdrawalRial === 0 && depositRial === 0)) return;

      const description = joinCell(cells.get("description") ?? [], " ");
      const kind = depositRial > 0 ? "deposit" : "withdrawal";
      const counterparty = extractCounterparty(description, kind);
      const tx: BankTransaction = {
        rowNo: Number(latinDigits(anchor.str.trim())),
        branch: cell("branch"),
        jalaliDate,
        gregorianDate,
        time: cell("time"),
        documentNo: cell("document", ""),
        referenceNo: cell("receipt"),
        chequeNo: cell("cheque"),
        description,
        note: cell("note"),
        withdrawalRial,
        depositRial,
        balanceRial: parseAmount(cell("balance")),
        kind,
        isFee: kind === "withdrawal" && /کارمزد/.test(description),
        counterpartyName: counterparty.name,
        counterpartyCard: counterparty.card,
        fingerprint: "",
      };
      tx.fingerprint = transactionFingerprint(accountNo, tx);
      transactions.push(tx);
    });
  }

  // Fingerprints need the account number, which may appear after page one's rows.
  for (const tx of transactions) tx.fingerprint = transactionFingerprint(accountNo, tx);

  return {
    accountNo,
    fromDate,
    toDate,
    transactions,
    balanceMismatches: checkBalances(transactions),
    totals: {
      withdrawalRial: transactions.reduce((sum, tx) => sum + tx.withdrawalRial, 0),
      depositRial: transactions.reduce((sum, tx) => sum + tx.depositRial, 0),
    },
    statementTotals,
  };
}
