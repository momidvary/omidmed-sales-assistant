export const materialCategoryLabels: Record<string, string> = {
  raw_material: "مواد اولیه",
  packaging: "بسته‌بندی",
  service: "خدمت تولیدی",
  other: "سایر",
};

export const expenseCategoryLabels: Record<string, string> = {
  rent: "اجاره",
  utilities: "آب، برق، گاز و اینترنت",
  direct_labor: "دستمزد مستقیم تولید",
  indirect_labor: "حقوق و نیروی غیرمستقیم",
  sewing: "دوخت",
  printing: "چاپ",
  packaging: "بسته‌بندی",
  shipping: "حمل‌ونقل",
  maintenance: "تعمیر و نگهداری",
  advertising: "تبلیغات",
  equipment: "خرید تجهیزات",
  tax_fee: "مالیات و عوارض",
  insurance: "بیمه",
  software: "نرم‌افزار و خدمات دیجیتال",
  other: "سایر هزینه‌ها",
};

export const costBehaviorLabels: Record<string, string> = {
  fixed: "ثابت",
  variable: "متغیر",
  mixed: "ترکیبی",
};

export const paymentMethodLabels: Record<string, string> = {
  cash: "نقد",
  card: "کارت",
  bank_transfer: "واریز بانکی",
  cheque: "چک",
  credit: "نسیه",
  other: "سایر",
};

export const paymentStatusLabels: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  partial: "بخشی پرداخت شده",
  paid: "تسویه‌شده",
};

export const productCategoryLabels: Record<string, string> = {
  pad: "پد",
  sheet: "ملحفه",
  bag: "کیف",
  pack: "پک کامل",
  strap: "استرپ",
  other: "سایر",
};

export const allowedMaterialCategories = new Set(Object.keys(materialCategoryLabels));
export const allowedExpenseCategories = new Set(Object.keys(expenseCategoryLabels));
export const allowedCostBehaviors = new Set(Object.keys(costBehaviorLabels));
export const allowedPaymentMethods = new Set(Object.keys(paymentMethodLabels));
export const allowedPaymentStatuses = new Set(Object.keys(paymentStatusLabels));
export const allowedProductCategories = new Set(Object.keys(productCategoryLabels));
