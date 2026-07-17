"use client";

import { useState } from "react";
import styles from "./sms.module.css";

type SuggestionPurpose =
  "reorder" | "festival" | "quote" | "payment" | "general";

type Suggestion = {
  title: string;
  text: string;
  reason: string;
};

type ApiResponse = {
  strategy?: string;
  suggestions?: Suggestion[];
  error?: string;
};

type Props = {
  mode: "customer" | "campaign";
  customerId?: string;
  campaignId?: string;
  defaultPurpose?: SuggestionPurpose;
  onSelect: (text: string) => void;
};

const purposeOptions: Array<{
  value: SuggestionPurpose;
  label: string;
}> = [
  { value: "reorder", label: "خرید مجدد" },
  { value: "festival", label: "جشنواره و تخفیف" },
  { value: "quote", label: "پیگیری قیمت" },
  { value: "payment", label: "پیگیری تسویه" },
  { value: "general", label: "ارتباط عمومی" },
];

const numberFormatter = new Intl.NumberFormat("fa-IR");

export default function AiSmsSuggester({
  mode,
  customerId,
  campaignId,
  defaultPurpose = "reorder",
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<SuggestionPurpose>(defaultPurpose);
  const [brief, setBrief] = useState("");
  const [strategy, setStrategy] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateSuggestions() {
    setLoading(true);
    setError(null);
    setStrategy("");
    setSuggestions([]);

    try {
      const response = await fetch("/api/sms/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          customerId,
          campaignId,
          purpose,
          brief,
        }),
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.suggestions?.length) {
        throw new Error(data.error || "پیشنهاد پیامک دریافت نشد.");
      }

      setStrategy(data.strategy || "");
      setSuggestions(data.suggestions);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "دریافت پیشنهاد هوشمند انجام نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.aiBox}>
      <button
        className={styles.aiToggle}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.aiBadge}>AI</span>
        {open ? "بستن پیشنهاد هوشمند" : "پیشنهاد هوشمند متن پیامک"}
      </button>

      {open ? (
        <div className={styles.aiPanel}>
          <div className={styles.aiIntro}>
            <strong>
              {mode === "customer"
                ? "پیشنهاد بر اساس سابقه همین مشتری"
                : "پیشنهاد قالب برای جشنواره یا کمپین"}
            </strong>
            <span>
              هوش مصنوعی فقط متن پیشنهاد می‌دهد؛ انتخاب و ارسال نهایی با توست.
            </span>
          </div>

          <div className={styles.aiControls}>
            <label>
              هدف پیام
              <select
                value={purpose}
                onChange={(event) =>
                  setPurpose(event.target.value as SuggestionPurpose)
                }
              >
                {purposeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              توضیح تکمیلی برای هوش مصنوعی
              <textarea
                rows={3}
                maxLength={1200}
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder={
                  mode === "campaign"
                    ? "مثلاً: جشنواره روز فیزیوتراپی؛ پد فرانسوی یک‌رو جفتی ۳۲ و دورو ۴۴ تومان؛ لحن محترمانه و کوتاه"
                    : "مثلاً: این مشتری قبلاً قیمت پد فرانسوی خواسته؛ لحن صمیمی ولی رسمی باشد"
                }
              />
            </label>
          </div>

          <button
            className={styles.aiGenerate}
            type="button"
            disabled={loading}
            onClick={generateSuggestions}
          >
            {loading
              ? "در حال بررسی اطلاعات..."
              : "ساخت ۳ پیشنهاد شخصی‌سازی‌شده"}
          </button>

          {error ? <div className={styles.error}>{error}</div> : null}

          {strategy ? (
            <div className={styles.aiStrategy}>
              <b>پیشنهاد دستیار:</b> {strategy}
            </div>
          ) : null}

          {suggestions.length ? (
            <div className={styles.aiSuggestions}>
              {suggestions.map((suggestion, index) => (
                <article
                  className={styles.aiSuggestion}
                  key={`${suggestion.title}-${index}`}
                >
                  <header>
                    <div>
                      <span>پیشنهاد {numberFormatter.format(index + 1)}</span>
                      <strong>{suggestion.title}</strong>
                    </div>
                    <small>
                      {numberFormatter.format(suggestion.text.length)} نویسه
                    </small>
                  </header>

                  <p className={styles.aiMessage}>{suggestion.text}</p>
                  <p className={styles.aiReason}>{suggestion.reason}</p>

                  <button
                    type="button"
                    onClick={() => {
                      onSelect(suggestion.text);
                      setOpen(false);
                    }}
                  >
                    استفاده از این متن
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
