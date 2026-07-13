import {
  getCurrentJalaliDate,
  getJalaliMonthLength,
  jalaliToGregorian,
} from "@/lib/jalali";

export type ReportPeriodKey =
  | "month"
  | "previous_month"
  | "30d"
  | "90d"
  | "year"
  | "all";

export type ReportRange = {
  key: ReportPeriodKey;
  label: string;
  from: string | null;
  to: string | null;
  previousFrom: string | null;
  previousTo: string | null;
};

export const REPORT_PERIODS: Array<{ key: ReportPeriodKey; label: string }> = [
  { key: "month", label: "این ماه شمسی" },
  { key: "previous_month", label: "ماه شمسی قبل" },
  { key: "30d", label: "۳۰ روز اخیر" },
  { key: "90d", label: "۹۰ روز اخیر" },
  { key: "year", label: "امسال شمسی" },
  { key: "all", label: "تمام سوابق" },
];

const allowed = new Set<ReportPeriodKey>(
  REPORT_PERIODS.map((item) => item.key),
);

export function safeReportPeriod(value: string | null | undefined) {
  return allowed.has(value as ReportPeriodKey)
    ? (value as ReportPeriodKey)
    : "month";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function gregorianIsoFromJalali(year: number, month: number, day: number) {
  const value = jalaliToGregorian(year, month, day);
  if (!value) throw new Error("Invalid Jalali date");
  return isoDate(value.gy, value.gm, value.gd);
}

function isoToUtcDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function shiftIsoDate(value: string, days: number) {
  const date = isoToUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function daysBetweenInclusive(from: string, to: string) {
  const difference = isoToUtcDate(to).getTime() - isoToUtcDate(from).getTime();
  return Math.floor(difference / 86_400_000) + 1;
}

function previousRange(from: string, to: string) {
  const length = daysBetweenInclusive(from, to);
  const previousTo = shiftIsoDate(from, -1);
  const previousFrom = shiftIsoDate(previousTo, -(length - 1));
  return { previousFrom, previousTo };
}

function currentGregorianIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return isoDate(value("year"), value("month"), value("day"));
}

function previousJalaliMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

export function getReportRange(key: ReportPeriodKey): ReportRange {
  const currentJalali = getCurrentJalaliDate();
  const today = currentGregorianIso();

  if (key === "all") {
    return {
      key,
      label: "تمام سوابق",
      from: null,
      to: null,
      previousFrom: null,
      previousTo: null,
    };
  }

  let from: string;
  let to: string;

  if (key === "month") {
    from = gregorianIsoFromJalali(
      currentJalali.year,
      currentJalali.month,
      1,
    );
    to = today;
  } else if (key === "previous_month") {
    const previous = previousJalaliMonth(
      currentJalali.year,
      currentJalali.month,
    );
    from = gregorianIsoFromJalali(previous.year, previous.month, 1);
    to = gregorianIsoFromJalali(
      previous.year,
      previous.month,
      getJalaliMonthLength(previous.year, previous.month),
    );
  } else if (key === "year") {
    from = gregorianIsoFromJalali(currentJalali.year, 1, 1);
    to = today;
  } else if (key === "90d") {
    to = today;
    from = shiftIsoDate(today, -89);
  } else {
    to = today;
    from = shiftIsoDate(today, -29);
  }

  const previous = previousRange(from, to);
  const label =
    REPORT_PERIODS.find((item) => item.key === key)?.label ?? "گزارش فروش";

  return {
    key,
    label,
    from,
    to,
    ...previous,
  };
}

export function toTimestampStart(value: string | null) {
  return value ? `${value}T00:00:00+03:30` : null;
}

export function toTimestampEnd(value: string | null) {
  return value ? `${value}T23:59:59+03:30` : null;
}
