"use client";

import { useState } from "react";
import AiSmsSuggester from "./ai-sms-suggester";
import styles from "./sms.module.css";

export default function CampaignSmsSender({
  campaignId,
  campaignName,
  defaultTemplate,
  targetCount,
}: {
  campaignId: string;
  campaignName: string;
  defaultTemplate?: string | null;
  targetCount: number;
}) {
  const [template, setTemplate] = useState(
    defaultTemplate ||
      "{{name}} گرامی، وقت بخیر. مدتی از آخرین خرید مجموعه شما گذشته است. برای اطلاع از شرایط خرید و قیمت روز {{product}} در خدمتتان هستیم. امیدمِد",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [includeRetries, setIncludeRetries] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendCampaign() {
    if (!confirmed) {
      setError("ابتدا تأیید کن که متن و مخاطبان را بررسی کرده‌ای.");
      return;
    }

    if (!template.trim()) {
      setError("متن پیامک خالی است.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sms/send-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, template, includeRetries }),
      });

      const data = (await response.json()) as {
        error?: string;
        total?: number;
        successCount?: number;
        failedCount?: number;
        skippedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error || "ارسال کمپین انجام نشد.");
      }

      setResult(
        `ارسال کمپین «${campaignName}» تمام شد: ${data.successCount ?? 0} موفق، ${data.failedCount ?? 0} ناموفق و ${data.skippedCount ?? 0} شماره نامعتبر.`,
      );
      setConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ارسال انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.campaignBox}>
      <div className={styles.campaignHeader}>
        <div>
          <strong>ارسال مستقیم پیامک کمپین</strong>
          <p>
            متن برای هر مشتری با جایگزینی نام، محصول، شهر و تعداد روز عدم خرید
            شخصی‌سازی می‌شود.
          </p>
        </div>

        <span>
          حداکثر هدف: {new Intl.NumberFormat("fa-IR").format(targetCount)}
        </span>
      </div>

      <AiSmsSuggester
        mode="campaign"
        campaignId={campaignId}
        defaultPurpose="festival"
        onSelect={(suggestedText) => {
          setTemplate(suggestedText);
          setConfirmed(false);
          setError(null);
        }}
      />

      <textarea
        rows={6}
        maxLength={1500}
        value={template}
        onChange={(event) => {
          setTemplate(event.target.value);
          setConfirmed(false);
        }}
      />

      <div className={styles.counter}>
        {new Intl.NumberFormat("fa-IR").format(template.length)} نویسه در قالب
      </div>

      <div className={styles.placeholders}>
        متغیرهای شخصی‌سازی: <code>{"{{name}}"}</code>
        <code>{"{{product}}"}</code>
        <code>{"{{days}}"}</code>
        <code>{"{{city}}"}</code>
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={includeRetries}
          onChange={(event) => setIncludeRetries(event.target.checked)}
        />
        مشتریان «پاسخ نداد» و «پیگیری مجدد» هم دوباره ارسال شوند
      </label>

      <label className={styles.confirm}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        متن و مخاطبان را بررسی کردم و ارسال را تأیید می‌کنم
      </label>

      {result ? <div className={styles.success}>{result}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <button
        className={styles.sendButton}
        type="button"
        disabled={loading}
        onClick={sendCampaign}
      >
        {loading ? "در حال ارسال دسته‌ای..." : "ارسال پیامک به مشتریان کمپین"}
      </button>
    </div>
  );
}
