"use client";

import { useState } from "react";
import { saveReorderUnit } from "../../actions";
import type { ReorderUnit } from "@/lib/sales/reorder-unit";
import { jalaliToGregorian } from "@/lib/jalali";
import { normalizeSearchText } from "@/lib/search/normalize";
import styles from "../../customer-form.module.css";

type Props = {
  customerId: string;
  initial: ReorderUnit | null;
  options: [string, string][];
  forecast: string;
  today: string;
};

const persianDate = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
});

function stockDate(value: string) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalizeSearchText(value));
  if (!match) return "";
  const date = jalaliToGregorian(Number(match[1]), Number(match[2]), Number(match[3]));
  return date ? `${date.gy}-${String(date.gm).padStart(2, "0")}-${String(date.gd).padStart(2, "0")}` : "";
}

export function ReorderForm({ customerId, initial, options, forecast, today }: Props) {
  const [custom, setCustom] = useState(Boolean(initial));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [leadDays, setLeadDays] = useState(initial?.leadDays ?? 7);
  const [parts, setParts] = useState(initial?.parts ?? [{ quantity: 1, keys: [] as string[] }]);
  const [threshold, setThreshold] = useState(initial?.reorderAt?.toString() ?? "");
  const [counts, setCounts] = useState(() => (initial?.stockCounts ?? []).map(count => ({
    date: persianDate.format(new Date(count.date)), quantity: String(count.quantity),
  })));
  const stockCounts = counts.map(count => ({ date: stockDate(count.date), quantity: Number(count.quantity) }));
  const dates = stockCounts.map(count => count.date);
  const invalidDates = dates.some(date => !date || date > today) || new Set(dates).size !== dates.length;
  const profile = { label, parts, leadDays, reorderAt: threshold === "" ? undefined : Number(threshold),
    stockCounts: stockCounts.length ? stockCounts : undefined };
  const labels = new Map(options);
  for (const key of parts.flatMap(part => part.keys)) {
    if (!labels.has(key)) labels.set(key, key.replace(/^(sku|name):/, ""));
  }
  return (
    <form action={saveReorderUnit} className={styles.formCard}>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="reorder_unit" value={JSON.stringify(custom ? profile : null)} />
      <div className={styles.formHeader}><h2>پیش‌بینی سفارش مجدد</h2></div>
      <p>{forecast}</p>
      <div className={styles.grid}>
        <label>مبنای پیش‌بینی
          <select value={custom ? "custom" : "auto"} onChange={e => setCustom(e.target.value === "custom")}>
            <option value="auto">کالاهای خریداری‌شده، جداگانه</option>
            <option value="custom">پک یا گروه کالای مشخص</option>
          </select>
        </label>
        {custom && <>
          <label>عنوان در فهرست پیگیری
            <input value={label} maxLength={120} required onChange={e => setLabel(e.target.value)} placeholder="مثلاً پک مصرفی کلینیک" />
          </label>
          <label>چند روز پیش از موعد پیگیری شود؟
            <input type="number" min="0" max="365" required value={leadDays} onChange={e => setLeadDays(Number(e.target.value))} />
          </label>
          <p className={styles.wide}>برای هر جزء، کالاهای جایگزین با واحد شمارش یکسان را انتخاب کنید. تعداد را بر حسب واحد فاکتور هلو برای یک پک وارد کنید. برای پیگیری یک کالای مستقل، یک جزء با تعداد ۱ کافی است.</p>
          {parts.map((part, i) => (
            <fieldset key={i} className={styles.wide}>
              <legend>جزء {new Intl.NumberFormat("fa-IR").format(i + 1)}</legend>
              <label>کالاهای قابل جایگزینی
                <select multiple required value={part.keys} onChange={e => {
                  const keys = Array.from(e.target.selectedOptions, o => o.value);
                  setParts(parts.map((p, n) => n === i ? { ...p, keys } : p));
                }}>
                  {[...labels].map(([key, name]) => <option key={key} value={key}
                    disabled={parts.some((p, n) => n !== i && p.keys.includes(key))}>{name}</option>)}
                </select>
              </label>
              <label>تعداد در هر واحد مصرف
                <input type="number" required step="any" min="0.001" value={part.quantity || ""} onChange={e => {
                  const quantity = Number(e.target.value);
                  setParts(parts.map((p, n) => n === i ? { ...p, quantity } : p));
                }} />
              </label>
              {parts.length > 1 && <button type="button" onClick={() => setParts(parts.filter((_, n) => n !== i))}>حذف جزء</button>}
            </fieldset>
          ))}
          {parts.length < 30 && <button type="button" onClick={() => setParts([...parts, { quantity: 1, keys: [] }])}>افزودن جزء</button>}
          <fieldset className={styles.wide}>
            <legend>موجودی مشتری</legend>
            <label>وقتی چند واحد می‌ماند، مشتری سفارش می‌دهد؟
              <input type="number" min="0" step="1" value={threshold} placeholder="اختیاری"
                onChange={e => setThreshold(e.target.value)} />
            </label>
            <p>موجودی کل پک یا کالای انتخابی را پس از تحویل‌های همان روز ثبت کنید. اپ مصرف را از دو شمارش آخر و خریدهای ثبت‌شده در هلو برآورد می‌کند.</p>
            {counts.map((count, i) => (
              <div key={i} className={styles.grid}>
                <label>تاریخ شمارش (شمسی)
                  <input dir="ltr" required value={count.date} placeholder="۱۴۰۵/۰۱/۱۵" onChange={e =>
                    setCounts(counts.map((c, n) => n === i ? { ...c, date: e.target.value } : c))} />
                </label>
                <label>تعداد موجود
                  <input type="number" min="0" step="1" required value={count.quantity} onChange={e =>
                    setCounts(counts.map((c, n) => n === i ? { ...c, quantity: e.target.value } : c))} />
                </label>
                <button type="button" onClick={() => setCounts(counts.filter((_, n) => n !== i))}>حذف شمارش</button>
              </div>
            ))}
            <button type="button" onClick={() => setCounts([...counts, { date: "", quantity: "" }])}>افزودن شمارش موجودی</button>
            {invalidDates && <p>برای هر شمارش، یک تاریخ شمسی معتبر و جداگانه تا امروز وارد کنید.</p>}
          </fieldset>
        </>}
      </div>
      <div className={styles.formActions}><button type="submit" disabled={custom && invalidDates}>ذخیره الگوی خرید</button></div>
    </form>
  );
}
