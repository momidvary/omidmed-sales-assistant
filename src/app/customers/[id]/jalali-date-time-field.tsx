"use client";

import { useMemo, useState } from "react";
import { getJalaliMonthLength } from "@/lib/jalali";
import styles from "./customer.module.css";

const number = new Intl.NumberFormat("fa-IR", { useGrouping: false });
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

export default function JalaliDateTimeField({ currentYear }: { currentYear: number }) {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");

  const years = useMemo(
    () => Array.from({ length: 7 }, (_, index) => currentYear + index),
    [currentYear],
  );

  const dayCount = year && month ? getJalaliMonthLength(Number(year), Number(month)) : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  function reset() {
    setYear("");
    setMonth("");
    setDay("");
    setTime("");
  }

  return (
    <fieldset className={styles.jalaliFieldset}>
      <legend>تاریخ و ساعت پیگیری بعدی</legend>

      <div className={styles.jalaliGrid}>
        <label>
          سال
          <select name="next_followup_year" value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="">انتخاب سال</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {number.format(item)}
              </option>
            ))}
          </select>
        </label>

        <label>
          ماه
          <select
            name="next_followup_month"
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              if (day && Number(day) > getJalaliMonthLength(Number(year || currentYear), Number(nextMonth))) {
                setDay("");
              }
            }}
          >
            <option value="">انتخاب ماه</option>
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          روز
          <select name="next_followup_day" value={day} onChange={(event) => setDay(event.target.value)}>
            <option value="">انتخاب روز</option>
            {days.map((item) => (
              <option key={item} value={item}>
                {number.format(item)}
              </option>
            ))}
          </select>
        </label>

        <label>
          ساعت
          <input
            type="time"
            name="next_followup_time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.jalaliHelpRow}>
        <small>تاریخ به تقویم شمسی انتخاب می‌شود و در دیتابیس به‌صورت استاندارد ذخیره خواهد شد.</small>
        {year || month || day || time ? (
          <button type="button" className={styles.clearDateButton} onClick={reset}>
            پاک‌کردن تاریخ
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
