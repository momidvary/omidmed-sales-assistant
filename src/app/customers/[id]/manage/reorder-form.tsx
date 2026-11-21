"use client";

import { useState } from "react";
import { saveReorderUnit } from "../../actions";
import type { ReorderUnit } from "@/lib/sales/reorder-unit";
import styles from "../../customer-form.module.css";

type Props = {
  customerId: string;
  initial: ReorderUnit | null;
  options: [string, string][];
  forecast: string;
};

export function ReorderForm({ customerId, initial, options, forecast }: Props) {
  const [custom, setCustom] = useState(Boolean(initial));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [leadDays, setLeadDays] = useState(initial?.leadDays ?? 7);
  const [parts, setParts] = useState(initial?.parts ?? [{ quantity: 1, keys: [] as string[] }]);
  const labels = new Map(options);
  for (const key of parts.flatMap(part => part.keys)) {
    if (!labels.has(key)) labels.set(key, key.replace(/^(sku|name):/, ""));
  }
  return (
    <form action={saveReorderUnit} className={styles.formCard}>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="reorder_unit" value={JSON.stringify(custom ? { label, parts, leadDays } : null)} />
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
        </>}
      </div>
      <div className={styles.formActions}><button type="submit">ذخیره الگوی خرید</button></div>
    </form>
  );
}
