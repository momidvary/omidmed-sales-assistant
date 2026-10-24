// The name an SMS addresses: Holoo names often have no title ("صفری"), and
// customers are mostly physiotherapists, so a bare personal name is
// addressed as "دکتر …". A name that already has a title, or is a business
// (clinic, shop, supplier), is left as it is.

import { persianLetters } from "@/lib/search/normalize";

const TITLES = ["دکتر", "خانم", "آقای", "آقا", "جناب", "سرکار", "استاد", "مهندس"];

/** Words that mark a business rather than a person. */
const BUSINESS_WORDS = new Set([
  "کلینیک",
  "فیزیوتراپی",
  "مطب",
  "مرکز",
  "درمانگاه",
  "بیمارستان",
  "داروخانه",
  "طب",
  "پوشاک",
  "فروشگاه",
  "شرکت",
  "تجهیزات",
  "پزشکی",
  "بازرگانی",
  "گروه",
  "توزیع",
  "پخش",
  "سالن",
  "زیبایی",
  "لیزر",
  "ماساژ",
  "باشگاه",
  "آرایشگاه",
  "آموزشگاه",
  "کاردرمانی",
  "توانبخشی",
  "ارتوپدی",
]);

export function smsGreetingName(name: string) {
  const clean = persianLetters(name).replace(/\s+/g, " ").trim().replace(/^اقای /, "آقای ").replace(/^اقا /, "آقا ");
  if (!clean) return clean;
  const words = clean.split(" ");
  if (TITLES.some((title) => words[0] === title || words[0].startsWith(`${title}.`))) return clean;
  if (words.some((word) => BUSINESS_WORDS.has(word))) return clean;
  return `دکتر ${clean}`;
}
