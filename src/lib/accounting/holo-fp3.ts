import { jalaliToGregorian } from "@/lib/jalali";

export type HoloAccountingKind =
  | "expense"
  | "partner_withdrawal"
  | "review"
  | "ignore";

export type HoloReviewKind = "asset_purchase" | "installment" | "ambiguous";

export type HoloAccountingEntry = {
  sourceAccount: string;
  documentNumber: string;
  jalaliDate: string;
  gregorianDate: string;
  debit: number;
  credit: number;
  balance: number;
  direction: string;
  description: string;
  normalizedDescription: string;
  groupKey: string;
  suggestedKind: HoloAccountingKind;
  suggestedCategory: string | null;
  suggestedCostBehavior: string | null;
  suggestedReviewKind: HoloReviewKind | null;
  partnerName: string | null;
  confidence: "high" | "medium" | "low";
};

export type HoloAccountingGroup = {
  key: string;
  label: string;
  sourceAccount: string;
  count: number;
  totalAmount: number;
  suggestedKind: HoloAccountingKind;
  suggestedCategory: string | null;
  suggestedCostBehavior: string | null;
  suggestedReviewKind: HoloReviewKind | null;
  confidence: "high" | "medium" | "low";
};

export type ParsedHoloAccountingFile = {
  entries: HoloAccountingEntry[];
  groups: HoloAccountingGroup[];
  summary: {
    totalRows: number;
    expenseRows: number;
    partnerRows: number;
    reviewRows: number;
    totalDebit: number;
    expenseDebit: number;
    partnerDebit: number;
    reviewDebit: number;
    firstDate: string | null;
    lastDate: string | null;
  };
};

type Classification = Pick<
  HoloAccountingEntry,
  | "suggestedKind"
  | "suggestedCategory"
  | "suggestedCostBehavior"
  | "suggestedReviewKind"
  | "partnerName"
  | "confidence"
>;

function decodeEntities(value: string) {
  return value
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function convertPersianDigits(value: string) {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  return value
    .replace(/[۰-۹]/g, (char) => String(persian.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String(arabic.indexOf(char)));
}

function normalizeText(value: string) {
  return convertPersianDigits(decodeEntities(value))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ه")
    .replace(/ة/g, "ه")
    .replace(/‌/g, " ")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(value: string) {
  const normalized = convertPersianDigits(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function attribute(block: string, memoNumber: number) {
  const match = new RegExp(`<m${memoNumber}\\s+u="([^"]*)"`, "i").exec(block);
  return normalizeText(match?.[1] ?? "");
}

function toIsoDate(value: string) {
  const parts = convertPersianDigits(value).match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!parts) return null;
  const converted = jalaliToGregorian(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  if (!converted) return null;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${converted.gy}-${pad(converted.gm)}-${pad(converted.gd)}`;
}

function includesAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function extractPartnerName(description: string) {
  if (description.includes("محمد")) return "محمد";
  if (description.includes("میثم")) return "میثم";
  if (description.includes("خانواده")) return "خانواده";
  const match = description.match(/شرکا\s*[-–:]\s*([^\s]+)/);
  return match?.[1] ?? "نامشخص";
}

function classify(sourceAccount: string, description: string): Classification {
  const account = normalizeText(sourceAccount);
  const text = normalizeText(description);

  if (account.includes("جاری شرکا") || text.includes("برداشت جاری شرکا")) {
    return {
      suggestedKind: "partner_withdrawal",
      suggestedCategory: null,
      suggestedCostBehavior: null,
      suggestedReviewKind: null,
      partnerName: extractPartnerName(text),
      confidence: "high",
    };
  }

  if (text.includes("خرید دارایی") || text.includes("خريد دارايي")) {
    return {
      suggestedKind: "review",
      suggestedCategory: "equipment",
      suggestedCostBehavior: "fixed",
      suggestedReviewKind: "asset_purchase",
      partnerName: null,
      confidence: "high",
    };
  }

  if (text.includes("پرداخت اقساط") || text.includes("قسط")) {
    return {
      suggestedKind: "review",
      suggestedCategory: "other",
      suggestedCostBehavior: "fixed",
      suggestedReviewKind: "installment",
      partnerName: null,
      confidence: "high",
    };
  }

  if (text.includes("تاپین") || text.includes("تاپين")) {
    return {
      suggestedKind: "review",
      suggestedCategory: "other",
      suggestedCostBehavior: "mixed",
      suggestedReviewKind: "ambiguous",
      partnerName: null,
      confidence: "low",
    };
  }

  const rules: Array<{
    keywords: string[];
    category: string;
    behavior: string;
  }> = [
    { keywords: ["حقوق پرسنل", "حقوق نیرو", "دستمزد پرسنل"], category: "indirect_labor", behavior: "fixed" },
    { keywords: ["اجاره کارگاه"], category: "rent", behavior: "fixed" },
    { keywords: ["باربری", "اسنپ", "پست", "کرایه"], category: "shipping", behavior: "variable" },
    { keywords: ["وسایل چاپ", "لوازم چاپ"], category: "printing", behavior: "variable" },
    { keywords: ["کارتن", "بسته بندی", "بسته‌بندی"], category: "packaging", behavior: "variable" },
    { keywords: ["تعمیرات", "تعمير"], category: "maintenance", behavior: "mixed" },
    { keywords: ["سایت", "سايت", "اینترنت", "اينترنت"], category: "software", behavior: "fixed" },
    { keywords: ["شام", "ناهار", "غذا"], category: "indirect_labor", behavior: "mixed" },
    { keywords: ["تبلیغات", "تبليغات"], category: "advertising", behavior: "variable" },
    { keywords: ["ضایعات", "ضايعات"], category: "other", behavior: "variable" },
    { keywords: ["تلفن", "برق", "آب", "گاز"], category: "utilities", behavior: "fixed" },
    { keywords: ["مالیات", "ماليات", "عوارض"], category: "tax_fee", behavior: "fixed" },
    { keywords: ["بیمه", "بيمه"], category: "insurance", behavior: "fixed" },
    { keywords: ["دوخت", "خیاط", "خياط"], category: "sewing", behavior: "variable" },
    { keywords: ["چاپ"], category: "printing", behavior: "variable" },
  ];

  const rule = rules.find((item) => includesAny(text, item.keywords));
  if (rule) {
    return {
      suggestedKind: "expense",
      suggestedCategory: rule.category,
      suggestedCostBehavior: rule.behavior,
      suggestedReviewKind: null,
      partnerName: null,
      confidence: "high",
    };
  }

  return {
    suggestedKind: "review",
    suggestedCategory: "other",
    suggestedCostBehavior: "mixed",
    suggestedReviewKind: "ambiguous",
    partnerName: null,
    confidence: "low",
  };
}

function makeGroupKey(sourceAccount: string, description: string) {
  return `${normalizeText(sourceAccount)}|${normalizeText(description)}`;
}

export function parseHoloAccountingFp3(arrayBuffer: ArrayBuffer): ParsedHoloAccountingFile {
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
  const pages = [...xml.matchAll(/<page0\b[^>]*>([\s\S]*?)<\/page0>/gi)].map((match) => match[1]);
  const entries: HoloAccountingEntry[] = [];

  for (const page of pages) {
    const header = /<b1\b[^>]*>([\s\S]*?)<\/b1>/i.exec(page)?.[1] ?? "";
    const sourceAccount = attribute(header, 25) || "نامشخص";
    const rows = [...page.matchAll(/<b2\b[^>]*>([\s\S]*?)<\/b2>/gi)];

    for (const rowMatch of rows) {
      const row = rowMatch[1];
      const jalaliDate = attribute(row, 32);
      const description = attribute(row, 37);
      const gregorianDate = toIsoDate(jalaliDate);
      if (!jalaliDate || !description || !gregorianDate) continue;

      const debit = parseAmount(attribute(row, 33));
      const credit = parseAmount(attribute(row, 34));
      if (!debit && !credit) continue;

      const normalizedDescription = normalizeText(description);
      const classification = classify(sourceAccount, normalizedDescription);

      entries.push({
        sourceAccount: normalizeText(sourceAccount),
        documentNumber: attribute(row, 31),
        jalaliDate,
        gregorianDate,
        debit,
        credit,
        balance: parseAmount(attribute(row, 35)),
        direction: attribute(row, 36),
        description,
        normalizedDescription,
        groupKey: makeGroupKey(sourceAccount, normalizedDescription),
        ...classification,
      });
    }
  }

  const groupMap = new Map<string, HoloAccountingGroup>();
  for (const entry of entries) {
    const current = groupMap.get(entry.groupKey);
    if (current) {
      current.count += 1;
      current.totalAmount += Math.max(entry.debit, entry.credit);
      continue;
    }
    groupMap.set(entry.groupKey, {
      key: entry.groupKey,
      label: entry.normalizedDescription,
      sourceAccount: entry.sourceAccount,
      count: 1,
      totalAmount: Math.max(entry.debit, entry.credit),
      suggestedKind: entry.suggestedKind,
      suggestedCategory: entry.suggestedCategory,
      suggestedCostBehavior: entry.suggestedCostBehavior,
      suggestedReviewKind: entry.suggestedReviewKind,
      confidence: entry.confidence,
    });
  }

  const groups = [...groupMap.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  const dates = entries.map((entry) => entry.gregorianDate).sort();
  const amountOf = (entry: HoloAccountingEntry) => Math.max(entry.debit, entry.credit);

  return {
    entries,
    groups,
    summary: {
      totalRows: entries.length,
      expenseRows: entries.filter((entry) => entry.suggestedKind === "expense").length,
      partnerRows: entries.filter((entry) => entry.suggestedKind === "partner_withdrawal").length,
      reviewRows: entries.filter((entry) => entry.suggestedKind === "review").length,
      totalDebit: entries.reduce((sum, entry) => sum + amountOf(entry), 0),
      expenseDebit: entries.filter((entry) => entry.suggestedKind === "expense").reduce((sum, entry) => sum + amountOf(entry), 0),
      partnerDebit: entries.filter((entry) => entry.suggestedKind === "partner_withdrawal").reduce((sum, entry) => sum + amountOf(entry), 0),
      reviewDebit: entries.filter((entry) => entry.suggestedKind === "review").reduce((sum, entry) => sum + amountOf(entry), 0),
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
    },
  };
}
