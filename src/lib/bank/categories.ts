// Spending and income categories for bank transactions. Keys are stored in
// bank_transactions.category; labels are only for display.

export type CategoryGroup = "partner" | "business" | "personal" | "transfer" | "income";

export type BankCategory = {
  key: string;
  label: string;
  kind: "deposit" | "withdrawal";
  group: CategoryGroup;
  hint?: string;
};

export const BANK_CATEGORIES: BankCategory[] = [
  { key: "owner_draw", label: "برداشت من", kind: "withdrawal", group: "partner" },
  { key: "partner_meysam", label: "برداشت میثم", kind: "withdrawal", group: "partner" },
  {
    key: "workshop_materials",
    label: "خرید مواد و لوازم کارگاه",
    kind: "withdrawal",
    group: "business",
    hint: "پارچه، فوم، بسته‌بندی، قطعات",
  },
  {
    key: "workshop_expense",
    label: "هزینه‌های کارگاه",
    kind: "withdrawal",
    group: "business",
    hint: "اجاره، قبوض، تعمیرات، ابزار",
  },
  { key: "payroll", label: "حقوق و دستمزد", kind: "withdrawal", group: "business" },
  { key: "shipping", label: "ارسال و پیک", kind: "withdrawal", group: "business" },
  { key: "tax_insurance", label: "مالیات و بیمه", kind: "withdrawal", group: "business" },
  { key: "bank_fee", label: "کارمزد بانک", kind: "withdrawal", group: "business" },
  { key: "other_expense", label: "سایر هزینه‌ها", kind: "withdrawal", group: "business" },
  { key: "home", label: "خرید خانه", kind: "withdrawal", group: "personal" },
  { key: "own_transfer_out", label: "انتقال به حساب دیگر خودم", kind: "withdrawal", group: "transfer" },

  { key: "customer_payment", label: "واریز مشتری", kind: "deposit", group: "income" },
  { key: "partner_capital", label: "آورده شریک", kind: "deposit", group: "partner" },
  { key: "own_transfer_in", label: "انتقال از حساب دیگر خودم", kind: "deposit", group: "transfer" },
  { key: "refund", label: "برگشت وجه", kind: "deposit", group: "income" },
  { key: "other_income", label: "سایر واریزها", kind: "deposit", group: "income" },
];

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  partner: "برداشت / آورده شرکا",
  business: "هزینه‌های کسب‌وکار",
  personal: "هزینه‌های شخصی",
  transfer: "جابه‌جایی بین حساب‌ها",
  income: "درآمد",
};

const byKey = new Map(BANK_CATEGORIES.map((category) => [category.key, category]));

export function bankCategory(key: string | null | undefined) {
  return key ? byKey.get(key) ?? null : null;
}

export function categoriesFor(kind: "deposit" | "withdrawal") {
  return BANK_CATEGORIES.filter((category) => category.kind === kind);
}

export function isValidCategory(key: string, kind: "deposit" | "withdrawal") {
  return bankCategory(key)?.kind === kind;
}
