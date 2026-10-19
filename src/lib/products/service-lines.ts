// Invoice lines that are charges, not goods: shipping, packing, discounts,
// fees and taxes. They appear on most invoices and say nothing about when a
// customer runs out of anything.
const SERVICE_LINE_WORDS = [
  "حمل",
  "ارسال",
  "کرایه",
  "باربری",
  "پست",
  "پیک",
  "تیپاکس",
  "تاپین",
  "بسته بندی",
  "هزینه",
  "خدمات",
  "تخفیف",
  "کارمزد",
  "مالیات",
  "عوارض",
  "ارزش افزوده",
];

function normalizeName(value: string) {
  return value
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}

/** True for charge lines (shipping, discount, fees) rather than products. */
export function isServiceLine(productName: string) {
  const name = normalizeName(productName);
  return SERVICE_LINE_WORDS.some((word) => name.includes(word));
}
