import { jalaliToGregorian } from "@/lib/jalali";

const faDigits = "۰۱۲۳۴۵۶۷۸۹";
const arDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(faDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arDigits.indexOf(digit)))
    .replace(/[٬,\s]/g, "");
}

export function parseMoney(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(normalizeDigits(String(value ?? "")));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function parseOptionalMoney(value: FormDataEntryValue | null) {
  const raw = normalizeDigits(String(value ?? "").trim());
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function parseInteger(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(normalizeDigits(String(value ?? "")), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function cleanText(
  formData: FormData,
  key: string,
  maxLength = 500,
) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

export function parseJalaliFormDate(
  formData: FormData,
  prefix: string,
  required = true,
) {
  const year = parseInteger(formData.get(`${prefix}_year`));
  const month = parseInteger(formData.get(`${prefix}_month`));
  const day = parseInteger(formData.get(`${prefix}_day`));
  const hasAny = Boolean(year || month || day);

  if (!hasAny && !required) return null;
  const converted = jalaliToGregorian(year, month, day);
  if (!converted) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${converted.gy}-${pad(converted.gm)}-${pad(converted.gd)}`;
}

export function formatMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("fa-IR").format(
    Math.round(Number.isFinite(parsed) ? parsed : 0),
  );
}

export function formatDecimal(value: number | string | null | undefined, digits = 2) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: digits,
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value}T12:00:00+03:30`));
}

export function currentJalaliMonthRange() {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric",
    month: "numeric",
    timeZone: "Asia/Tehran",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const start = jalaliToGregorian(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const next = jalaliToGregorian(nextYear, nextMonth, 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = (date: { gy: number; gm: number; gd: number } | null) =>
    date ? `${date.gy}-${pad(date.gm)}-${pad(date.gd)}` : "";
  return { year, month, from: iso(start), toExclusive: iso(next) };
}
