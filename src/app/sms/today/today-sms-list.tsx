"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "./today.module.css";

export type TodayTarget = {
  customerId: string;
  name: string;
  /** How the SMS addresses the customer ("دکتر …" for a bare name). */
  greeting: string;
  phone: string | null;
  kind: string;
  kindLabel: string;
  score: number;
  reasons: string[];
  note: string | null;
  draft: string;
  patternAllowed: boolean;
};

type Channel = "pattern" | "text";
type Result = { ok: boolean; text: string };
type AiSuggestion = { title: string; text: string };

// Same storage key as the poster maker and the profile's pattern buttons.
const CONTACT_STORAGE_KEY = "omidmed.poster.phones";
const number = new Intl.NumberFormat("fa-IR");

const aiPurpose: Record<string, string> = {
  reorder: "reorder",
  winback: "reorder",
  declining: "reorder",
  quote: "quote",
  scheduled: "general",
};

function readContact() {
  try {
    return (window.localStorage.getItem(CONTACT_STORAGE_KEY) ?? "").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

function saveContact(value: string) {
  try {
    const rest = (window.localStorage.getItem(CONTACT_STORAGE_KEY) ?? "").split("\n").slice(1);
    window.localStorage.setItem(CONTACT_STORAGE_KEY, [value, ...rest].join("\n"));
  } catch {
    // Remembering the number is only a convenience.
  }
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? "درخواست انجام نشد."));
  return data;
}

export default function TodaySmsList({ targets }: { targets: TodayTarget[] }) {
  const router = useRouter();
  const [contact, setContact] = useState("");
  // Only the user's changes are kept here; customers that arrive after a
  // refresh start from their own defaults.
  const [channelChoice, setChannels] = useState<Record<string, Channel>>({});
  const [textEdits, setTexts] = useState<Record<string, string>>({});
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, AiSuggestion[] | "loading" | string>>({});
  // One request id per customer until it succeeds, so a retry never sends twice.
  const requestIds = useRef<Record<string, string>>({});

  useEffect(() => {
    // localStorage is only readable after mount.
    setContact(readContact());
  }, []);

  const channelOf = (target: TodayTarget): Channel =>
    // A customer who stopped buying gets the personal "we miss you" text;
    // the reorder pattern ("time to reorder") fits the ones who are due.
    channelChoice[target.customerId] ?? (target.patternAllowed && target.kind !== "winback" ? "pattern" : "text");
  const textOf = (target: TodayTarget) => textEdits[target.customerId] ?? target.draft;
  // A sent customer leaves the list at once; the server keeps them out for
  // 14 days and the refresh brings in the next customers.
  const visible = targets.filter((target) => !sent.has(target.customerId));

  if (!visible.length) {
    return (
      <div className={styles.empty}>
        <h3>امروز مشتری‌ای نیاز به پیامک ندارد</h3>
        <p>همه کسانی که دلیلی برای پیام داشتند اخیراً پیامک یا تماس گرفته‌اند.</p>
      </div>
    );
  }

  const finalText = (target: TodayTarget) => textOf(target).replaceAll("{contact}", contact.trim());

  async function send(target: TodayTarget) {
    const channel = channelOf(target);
    if (!contact.trim()) {
      setResults((current) => ({
        ...current,
        [target.customerId]: { ok: false, text: "اول شماره تماس شرکت را بالای صفحه وارد کنید." },
      }));
      return false;
    }
    requestIds.current[target.customerId] ??= crypto.randomUUID();
    try {
      if (channel === "pattern") {
        await postJson("/api/sms/pattern", {
          pattern: "followup",
          customerId: target.customerId,
          values: { name: target.greeting.slice(0, 40), contact: contact.trim() },
          clientRequestId: requestIds.current[target.customerId],
        });
      } else {
        const text = finalText(target).trim();
        if (!text) throw new Error("متن پیامک خالی است.");
        await postJson("/api/sms/send", {
          customerId: target.customerId,
          text,
          source: "customer",
          marketing: true,
          scheduleFollowup: false,
          clientRequestId: requestIds.current[target.customerId],
        });
      }
      delete requestIds.current[target.customerId];
      setSent((current) => new Set(current).add(target.customerId));
      return true;
    } catch (error) {
      setResults((current) => ({
        ...current,
        [target.customerId]: { ok: false, text: error instanceof Error ? error.message : "ارسال انجام نشد." },
      }));
      return false;
    }
  }

  async function sendOne(target: TodayTarget) {
    setBusy(target.customerId);
    const ok = await send(target);
    setBusy(null);
    if (ok) router.refresh();
  }

  async function sendSelected() {
    setBusy("all");
    let anySent = false;
    for (const target of visible) {
      if (unchecked.has(target.customerId)) continue;
      if (await send(target)) anySent = true;
    }
    setBusy(null);
    if (anySent) router.refresh();
  }

  async function suggest(target: TodayTarget) {
    setAi((current) => ({ ...current, [target.customerId]: "loading" }));
    try {
      const data = await postJson("/api/sms/suggest", {
        mode: "customer",
        customerId: target.customerId,
        purpose: aiPurpose[target.kind] ?? "general",
        brief: `دلیل پیام: ${target.reasons.join("؛ ")}`,
      });
      const suggestions = (data.suggestions as AiSuggestion[] | undefined) ?? [];
      setAi((current) => ({ ...current, [target.customerId]: suggestions }));
    } catch (error) {
      setAi((current) => ({
        ...current,
        [target.customerId]: error instanceof Error ? error.message : "پیشنهاد آماده نشد.",
      }));
    }
  }

  const pendingSelected = visible.filter((target) => !unchecked.has(target.customerId)).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <label>
          شماره تماس شرکت در پیامک
          <input
            value={contact}
            dir="ltr"
            maxLength={20}
            placeholder="0912…"
            onChange={(event) => {
              setContact(event.target.value);
              saveContact(event.target.value);
            }}
          />
        </label>
        <button type="button" className={styles.primary} disabled={Boolean(busy) || !pendingSelected} onClick={sendSelected}>
          {busy === "all" ? "در حال ارسال…" : `ارسال برای ${number.format(pendingSelected)} نفر انتخاب‌شده`}
        </button>
      </div>

      {sent.size ? (
        <p className={styles.sentNote}>
          {number.format(sent.size)} پیامک ارسال شد؛ این مشتری‌ها تا ۱۴ روز در فهرست نمی‌آیند و نفرات بعدی جایشان را
          می‌گیرند.
        </p>
      ) : null}

      {visible.map((target) => {
        const channel = channelOf(target);
        const result = results[target.customerId];
        const suggestions = ai[target.customerId];
        return (
          <article key={target.customerId} className={`${styles.card} ${result?.ok ? styles.done : ""}`}>
            <div className={styles.head}>
              <label className={styles.pick}>
                <input
                  type="checkbox"
                  checked={!unchecked.has(target.customerId)}
                  onChange={(event) =>
                    setUnchecked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(target.customerId);
                      else next.add(target.customerId);
                      return next;
                    })
                  }
                />
                <Link href={`/customers/${target.customerId}`}>
                  <b>{target.name}</b>
                </Link>
              </label>
              <span className={styles.kind}>{target.kindLabel}</span>
              <span className={styles.score}>امتیاز {number.format(target.score)}</span>
            </div>

            <ul className={styles.reasons}>
              {target.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {target.note ? <p className={styles.note}>{target.note}</p> : null}

            {target.patternAllowed ? (
              <div className={styles.channels}>
                <label>
                  <input
                    type="radio"
                    checked={channel === "pattern"}
                    onChange={() => setChannels((current) => ({ ...current, [target.customerId]: "pattern" }))}
                  />
                  الگوی «یادآوری سفارش مجدد» (خط خدماتی؛ به همه می‌رسد)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={channel === "text"}
                    onChange={() => setChannels((current) => ({ ...current, [target.customerId]: "text" }))}
                  />
                  متن شخصی (خط ۵۰۰۰؛ به شماره‌هایی که تبلیغات را بسته‌اند نمی‌رسد)
                </label>
              </div>
            ) : null}

            {channel === "pattern" ? (
              <p className={styles.preview}>
                {target.greeting.slice(0, 40)} گرامی، موعد سفارش مجدد لوازم مصرفی شما فرا رسیده است. برای ثبت سفارش با شماره{" "}
                {contact || "…"} تماس بگیرید.
                <br />
                omidmed.com
              </p>
            ) : (
              <>
                <textarea
                  className={styles.text}
                  value={textOf(target)}
                  maxLength={600}
                  rows={3}
                  onChange={(event) => setTexts((current) => ({ ...current, [target.customerId]: event.target.value }))}
                />
                <small className={styles.hint}>
                  «{"{contact}"}» با شماره شرکت جایگزین می‌شود و «لغو۱۱» خودکار به آخر پیامک اضافه می‌شود.
                </small>
                {Array.isArray(suggestions) ? (
                  <div className={styles.suggestions}>
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.text}
                        type="button"
                        onClick={() => setTexts((current) => ({ ...current, [target.customerId]: suggestion.text }))}
                      >
                        <b>{suggestion.title}</b>
                        {suggestion.text}
                      </button>
                    ))}
                  </div>
                ) : typeof suggestions === "string" && suggestions !== "loading" ? (
                  <p className={styles.error}>{suggestions}</p>
                ) : null}
              </>
            )}

            <div className={styles.actions}>
              {channel === "text" ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={suggestions === "loading" || Boolean(result?.ok)}
                  onClick={() => suggest(target)}
                >
                  {suggestions === "loading" ? "در حال نوشتن…" : "متن با هوش مصنوعی"}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primary}
                disabled={Boolean(busy) || Boolean(result?.ok)}
                onClick={() => sendOne(target)}
              >
                {busy === target.customerId ? "در حال ارسال…" : `ارسال به ${target.phone ?? ""}`}
              </button>
              {result ? <span className={result.ok ? styles.ok : styles.error}>{result.text}</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
