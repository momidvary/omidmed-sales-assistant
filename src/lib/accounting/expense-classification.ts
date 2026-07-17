import { allowedCostBehaviors, allowedExpenseCategories } from "@/lib/accounting/constants";

export const costScopeLabels: Record<string, string> = {
  manufacturing: "تولید و بهای محصول",
  selling: "فروش، ارسال و توزیع",
  period: "هزینه عمومی دوره",
  asset: "خرید دارایی یا دستگاه",
  partner: "برداشت شریک",
  ignore: "در محاسبه استفاده نشود",
  unreviewed: "بررسی نشده",
};

export const allowedCostScopes = new Set([
  "manufacturing",
  "selling",
  "period",
  "asset",
  "partner",
  "ignore",
]);

export type ExpenseClassification = {
  key: string;
  category: string;
  costBehavior: string;
  costScope: string;
  manufacturingSharePercent: number;
  confidence: number;
  reason: string;
};

export function normalizeExpenseText(value: unknown) {
  return String(value ?? "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[أإ]/g, "ا")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalizeExpenseText(word)));
}

function result(
  key: string,
  category: string,
  costBehavior: string,
  costScope: string,
  manufacturingSharePercent: number,
  confidence: number,
  reason: string,
): ExpenseClassification {
  return {
    key,
    category: allowedExpenseCategories.has(category) ? category : "other",
    costBehavior: allowedCostBehaviors.has(costBehavior) ? costBehavior : "mixed",
    costScope: allowedCostScopes.has(costScope) ? costScope : "period",
    manufacturingSharePercent: Math.min(100, Math.max(0, manufacturingSharePercent)),
    confidence: Math.min(1, Math.max(0, confidence)),
    reason,
  };
}

export function deterministicExpenseClassification(
  description: unknown,
  currentCategory = "other",
): ExpenseClassification {
  const key = normalizeExpenseText(description);
  const category = allowedExpenseCategories.has(currentCategory) ? currentCategory : "other";

  if (!key) return result(key, category, "mixed", "period", 0, 0.25, "شرح هزینه خالی یا نامشخص است.");

  if (hasAny(key, ["برداشت محمد", "برداشت میثم", "برداشت شریک", "جاری شرکا", "جاری شریک"])) {
    return result(key, "other", "mixed", "partner", 0, 0.98, "برداشت شریک هزینه تولید یا فروش نیست.");
  }
  if (hasAny(key, ["خرید دستگاه", "دستگاه دوخت", "دستگاه چاپ", "پرس", "کمپرسور", "تجهیز کارگاه", "خرید تجهیزات"])) {
    return result(key, "equipment", "fixed", "asset", 0, 0.92, "خرید دستگاه یا تجهیزات باید به‌عنوان دارایی بررسی شود.");
  }
  if (hasAny(key, ["قسط", "اقساط", "وام", "اصل تسهیلات"])) {
    return result(key, "other", "fixed", "period", 0, 0.62, "قسط باید به اصل و کارمزد تفکیک شود؛ فعلاً وارد بهای محصول نمی‌شود.");
  }
  if (hasAny(key, ["رنگ چاپ", "رنگ سیلک", "ریتاردر", "رتاردر", "تینر", "حلال", "شابلون", "کلیشه", "توری چاپ", "لاک حساس", "کاردک چاپ", "وسایل چاپ", "لوازم چاپ"])) {
    return result(key, "printing", "variable", "manufacturing", 100, 0.96, "ماده یا ابزار مصرفی چاپ مستقیماً به تولید محصولات چاپ‌شده مربوط است.");
  }
  if (hasAny(key, ["تعمیر دستگاه", "تعمیرات", "قطعه دستگاه", "سرویس دستگاه", "خرابی دستگاه"])) {
    return result(key, "maintenance", "mixed", "manufacturing", 100, 0.93, "تعمیر و نگهداری دستگاه‌های کارگاه سربار تولید است.");
  }
  if (hasAny(key, ["کارتن", "نایلون", "زیپ کیپ", "زیپ‌کیپ", "بسته بندی", "بسته‌بندی", "لیبل", "چسب بسته", "گونی"])) {
    return result(key, "packaging", "variable", "manufacturing", 100, 0.94, "مواد بسته‌بندی جزو هزینه تولید و آماده‌سازی محصول است.");
  }
  if (hasAny(key, ["دوخت", "خیاط", "خیاطی", "دوزندگی"])) {
    return result(key, "sewing", "variable", "manufacturing", 100, 0.96, "هزینه دوخت مستقیماً به تولید مربوط است.");
  }
  if (hasAny(key, ["حقوق تولید", "حقوق پرسنل", "حقوق نیرو", "دستمزد", "اضافه کاری", "اضافه‌کاری"])) {
    return result(key, "direct_labor", "fixed", "manufacturing", 100, 0.82, "حقوق باید با نقش نیرو کنترل شود؛ پیشنهاد اولیه تولیدی است.");
  }
  if (hasAny(key, ["اجاره کارگاه", "اجاره"])) {
    return result(key, "rent", "fixed", "manufacturing", 100, 0.95, "اجاره محل کارگاه سربار تولید است.");
  }
  if (hasAny(key, ["برق", "آب", "گاز", "اینترنت کارگاه", "قبض"])) {
    return result(key, "utilities", "fixed", "manufacturing", 100, 0.9, "انرژی و خدمات کارگاه در سربار تولید لحاظ می‌شود.");
  }
  if (hasAny(key, ["پست", "ارسال", "باربری", "اسنپ", "تیپاکس", "چاپار", "کرایه حمل مشتری", "تحویل بسته"])) {
    return result(key, "shipping", "variable", "selling", 0, 0.95, "هزینه ارسال و تحویل سفارش، هزینه فروش و توزیع است.");
  }
  if (hasAny(key, ["تبلیغ", "اینستاگرام", "پیامک", "بنر", "طراحی تبلیغ", "گوگل ادز"])) {
    return result(key, "advertising", "variable", "selling", 0, 0.94, "تبلیغات برای جذب و حفظ مشتری هزینه فروش است.");
  }
  if (hasAny(key, ["بیمه کارگاه", "بیمه پرسنل", "بیمه"])) {
    return result(key, "insurance", "fixed", "manufacturing", 70, 0.72, "بخشی از بیمه مرتبط با نیروی تولید است؛ سهم ۷۰٪ قابل بازبینی است.");
  }
  if (hasAny(key, ["مالیات", "عوارض", "دارایی", "ارزش افزوده"])) {
    return result(key, "tax_fee", "fixed", "period", 0, 0.9, "مالیات و عوارض معمولاً هزینه عمومی دوره است، نه ماده مستقیم محصول.");
  }
  if (hasAny(key, ["نرم افزار", "نرم‌افزار", "هلو", "دامنه", "هاست", "سایت", "اشتراک"])) {
    return result(key, "software", "fixed", "period", 0, 0.88, "نرم‌افزار و خدمات دیجیتال هزینه عمومی کسب‌وکار است.");
  }
  if (hasAny(key, ["غذا", "ناهار", "شام", "پذیرایی", "چای", "میوه"])) {
    return result(key, "indirect_labor", "mixed", "period", 0, 0.78, "پذیرایی و غذای کارکنان هزینه عمومی دوره است.");
  }

  const defaults: Record<string, ExpenseClassification> = {
    rent: result(key, "rent", "fixed", "manufacturing", 100, 0.7, "بر اساس گروه فعلی اجاره."),
    utilities: result(key, "utilities", "fixed", "manufacturing", 100, 0.7, "بر اساس گروه فعلی انرژی."),
    direct_labor: result(key, "direct_labor", "fixed", "manufacturing", 100, 0.65, "بر اساس گروه فعلی دستمزد مستقیم."),
    indirect_labor: result(key, "indirect_labor", "fixed", "manufacturing", 70, 0.55, "بر اساس گروه فعلی نیروی غیرمستقیم."),
    sewing: result(key, "sewing", "variable", "manufacturing", 100, 0.8, "بر اساس گروه فعلی دوخت."),
    printing: result(key, "printing", "variable", "manufacturing", 100, 0.8, "بر اساس گروه فعلی چاپ."),
    packaging: result(key, "packaging", "variable", "manufacturing", 100, 0.8, "بر اساس گروه فعلی بسته‌بندی."),
    shipping: result(key, "shipping", "variable", "selling", 0, 0.8, "بر اساس گروه فعلی حمل و ارسال."),
    maintenance: result(key, "maintenance", "mixed", "manufacturing", 100, 0.8, "بر اساس گروه فعلی تعمیرات."),
    advertising: result(key, "advertising", "variable", "selling", 0, 0.8, "بر اساس گروه فعلی تبلیغات."),
    equipment: result(key, "equipment", "fixed", "asset", 0, 0.8, "بر اساس گروه فعلی خرید تجهیزات."),
    tax_fee: result(key, "tax_fee", "fixed", "period", 0, 0.8, "بر اساس گروه فعلی مالیات."),
    insurance: result(key, "insurance", "fixed", "manufacturing", 70, 0.6, "بر اساس گروه فعلی بیمه."),
    software: result(key, "software", "fixed", "period", 0, 0.8, "بر اساس گروه فعلی نرم‌افزار."),
  };

  return defaults[category] ?? result(key, "other", "mixed", "period", 0, 0.35, "شرح برای تصمیم قطعی کافی نیست؛ پیشنهاد اولیه هزینه عمومی است.");
}

export function classificationMatches(ruleText: string, description: unknown, mode = "contains") {
  const normalizedRule = normalizeExpenseText(ruleText);
  const normalizedDescription = normalizeExpenseText(description);
  if (!normalizedRule || !normalizedDescription) return false;
  return mode === "exact"
    ? normalizedDescription === normalizedRule
    : normalizedDescription.includes(normalizedRule) || normalizedRule.includes(normalizedDescription);
}
