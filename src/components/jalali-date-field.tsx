"use client";

import { useMemo, useState } from "react";
import { getCurrentJalaliDate, getJalaliMonthLength } from "@/lib/jalali";

const monthNames = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export default function JalaliDateField({
  namePrefix,
  label,
  required = true,
  yearsBack = 6,
  yearsForward = 1,
  defaultToday = true,
}: {
  namePrefix: string;
  label: string;
  required?: boolean;
  yearsBack?: number;
  yearsForward?: number;
  defaultToday?: boolean;
}) {
  const current = useMemo(() => getCurrentJalaliDate(), []);
  const [year, setYear] = useState(defaultToday ? String(current.year) : "");
  const [month, setMonth] = useState(defaultToday ? String(current.month) : "");
  const [day, setDay] = useState(defaultToday ? String(current.day) : "");

  const years = useMemo(
    () =>
      Array.from(
        { length: yearsBack + yearsForward + 1 },
        (_, index) => current.year - yearsBack + index,
      ).reverse(),
    [current.year, yearsBack, yearsForward],
  );

  const dayCount = year && month
    ? getJalaliMonthLength(Number(year), Number(month))
    : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  return (
    <fieldset className="jalali-date-field">
      <legend>{label}</legend>
      <div className="jalali-date-grid">
        <label>
          سال
          <select
            name={`${namePrefix}_year`}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            required={required}
          >
            <option value="">سال</option>
            {years.map((item) => <option key={item} value={item}>{item.toLocaleString("fa-IR", { useGrouping: false })}</option>)}
          </select>
        </label>
        <label>
          ماه
          <select
            name={`${namePrefix}_month`}
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              const max = getJalaliMonthLength(Number(year || current.year), Number(nextMonth));
              if (day && Number(day) > max) setDay("");
            }}
            required={required}
          >
            <option value="">ماه</option>
            {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
        </label>
        <label>
          روز
          <select
            name={`${namePrefix}_day`}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            required={required}
          >
            <option value="">روز</option>
            {days.map((item) => <option key={item} value={item}>{item.toLocaleString("fa-IR")}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
