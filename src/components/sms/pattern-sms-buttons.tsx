"use client";

import { useRef, useState } from "react";

import styles from "./pattern-sms.module.css";

export type PatternOption = {
  key: string;
  button: string;
  description: string;
  text: string;
  variables: Array<{
    key: string;
    label: string;
    maxLength: number;
    placeholder?: string;
    options?: string[];
    fill?: string;
  }>;
};

export type PatternInvoice = { number: string; amount: string; items: string };

type Props = {
  customerId: string;
  customerName: string;
  phone: string | null;
  invoices: PatternInvoice[];
  patterns: PatternOption[];
};

const CONTACT_STORAGE_KEY = "omidmed.poster.phones";

function storedContact() {
  try {
    return (window.localStorage.getItem(CONTACT_STORAGE_KEY) ?? "").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

function fill(text: string, args: string[]) {
  return text.replace(/\{(\d+)\}/g, (_, index: string) => args[Number(index)] || "…");
}

export default function PatternSmsButtons({ customerId, customerName, phone, invoices, patterns }: Props) {
  const [active, setActive] = useState<PatternOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const requestId = useRef<string | null>(null);

  if (!patterns.length) {
    return (
      <p className={styles.hint}>
        پیامک الگویی (خط خدماتی) هنوز فعال نیست. کد الگوهای تأییدشده ملی پیامک را در Vercel تعریف کنید.
      </p>
    );
  }

  function open(pattern: PatternOption) {
    setActive(pattern);
    setResult(null);
    requestId.current = null;
    const latest = invoices[0];
    const sources: Record<string, string> = {
      name: customerName,
      title: "آقا",
      lastName: customerName,
      invoice: latest?.number ?? "",
      amount: latest?.amount ?? "",
      items: latest?.items ?? "",
      contact: storedContact(),
    };
    setValues(
      Object.fromEntries(
        pattern.variables.map((variable) => [variable.key, variable.fill ? sources[variable.fill] ?? "" : ""]),
      ),
    );
  }

  function update(variableKey: string, value: string) {
    setValues((current) => {
      const next = { ...current, [variableKey]: value };
      // Picking another invoice number refreshes its amount and items.
      const variable = active?.variables.find((item) => item.key === variableKey);
      const invoice = variable?.fill === "invoice" ? invoices.find((item) => item.number === value.trim()) : null;
      if (invoice && active) {
        for (const other of active.variables) {
          if (other.fill === "amount") next[other.key] = invoice.amount;
          if (other.fill === "items") next[other.key] = invoice.items;
        }
      }
      return next;
    });
  }

  async function send() {
    if (!active) return;
    setLoading(true);
    setResult(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/sms/pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          pattern: active.key,
          values,
          clientRequestId: requestId.current,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "ارسال پیامک انجام نشد.");
      setResult({ ok: true, text: "پیامک از خط خدماتی ارسال شد." });
      requestId.current = null;
    } catch (caught) {
      setResult({ ok: false, text: caught instanceof Error ? caught.message : "ارسال پیامک انجام نشد." });
    } finally {
      setLoading(false);
    }
  }

  const args = active ? active.variables.map((variable) => values[variable.key] ?? "") : [];

  return (
    <div className={styles.wrap}>
      <div className={styles.buttons}>
        {patterns.map((pattern) => (
          <button
            key={pattern.key}
            type="button"
            className={`${styles.button} ${active?.key === pattern.key ? styles.buttonActive : ""}`}
            onClick={() => (active?.key === pattern.key ? setActive(null) : open(pattern))}
            disabled={!phone}
            title={phone ? pattern.description : "شماره موبایل مشتری ثبت نشده است"}
          >
            {pattern.button}
          </button>
        ))}
      </div>

      {active ? (
        <div className={styles.panel}>
          <p className={styles.description}>{active.description}</p>
          {active.variables.map((variable) => (
            <label className={styles.field} key={variable.key}>
              <span>{variable.label}</span>
              {variable.options ? (
                <select value={values[variable.key] ?? ""} onChange={(event) => update(variable.key, event.target.value)}>
                  {variable.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={values[variable.key] ?? ""}
                  maxLength={variable.maxLength}
                  placeholder={variable.placeholder}
                  list={variable.fill === "invoice" ? `invoices-${customerId}` : undefined}
                  onChange={(event) => update(variable.key, event.target.value)}
                />
              )}
            </label>
          ))}
          <datalist id={`invoices-${customerId}`}>
            {invoices.map((invoice) => (
              <option key={invoice.number} value={invoice.number} />
            ))}
          </datalist>

          <div className={styles.preview}>
            <span>پیش‌نمایش پیامک</span>
            <p>{fill(active.text, args)}</p>
            <small>متن نهایی همان متنی است که ملی پیامک تأیید کرده است.</small>
          </div>

          <div className={styles.actions}>
            <button className={styles.send} type="button" onClick={send} disabled={loading}>
              {loading ? "در حال ارسال…" : `ارسال به ${phone}`}
            </button>
            <button className={styles.cancel} type="button" onClick={() => setActive(null)}>
              انصراف
            </button>
          </div>
        </div>
      ) : null}

      {result ? <p className={result.ok ? styles.success : styles.error}>{result.text}</p> : null}
    </div>
  );
}
