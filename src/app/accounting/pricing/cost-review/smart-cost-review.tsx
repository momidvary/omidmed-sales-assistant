"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  costBehaviorLabels,
  expenseCategoryLabels,
} from "@/lib/accounting/constants";
import { costScopeLabels } from "@/lib/accounting/expense-classification";

import styles from "./smart-cost-review.module.css";

type Suggestion = {
  key: string;
  category: string;
  costBehavior: string;
  costScope: string;
  manufacturingSharePercent: number;
  confidence: number;
  reason: string;
};

type Group = {
  key: string;
  label: string;
  count: number;
  totalAmount: number;
  latestDate: string | null;
  currentCategory: string;
  sourceAccounts: string[];
  expenseIds: string[];
  reviewIds: string[];
  confirmedCount: number;
  suggestion: Suggestion;
};

type AnalyzeResponse = {
  groups?: Group[];
  usedAi?: boolean;
  model?: string | null;
  warning?: string | null;
  summary?: {
    groupCount: number;
    expenseCount: number;
    pendingReviewCount: number;
    totalAmount: number;
  };
  error?: string;
};

const scopeOptions = ["manufacturing", "selling", "period", "asset", "partner", "ignore"];

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("fa-IR")} تومان`;
}

function confidenceLabel(value: number) {
  if (value >= 0.9) return "اطمینان زیاد";
  if (value >= 0.7) return "اطمینان متوسط";
  return "نیازمند توجه";
}

export default function SmartCostReview() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<AnalyzeResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(true);

  const filteredGroups = useMemo(() => {
    const list = onlyNeedsReview
      ? groups.filter(
          (group) =>
            group.suggestion.confidence < 0.9 ||
            group.reviewIds.length > 0 ||
            group.confirmedCount < group.expenseIds.length,
        )
      : groups;
    return list;
  }, [groups, onlyNeedsReview]);

  async function analyze() {
    setLoading(true);
    setError(null);
    setMessage(null);
    setWarning(null);
    try {
      const response = await fetch("/api/accounting/expense-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await response.json()) as AnalyzeResponse;
      if (!response.ok || data.error) throw new Error(data.error || "تحلیل هزینه‌ها انجام نشد.");
      setGroups(data.groups ?? []);
      setSummary(data.summary ?? null);
      setWarning(data.warning ?? null);
      setUsedAi(Boolean(data.usedAi));
      setVisibleCount(24);
      if (!(data.groups ?? []).length) setMessage("هزینه‌ای برای بررسی پیدا نشد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تحلیل هزینه‌ها انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  function updateSuggestion(key: string, patch: Partial<Suggestion>) {
    setGroups((current) =>
      current.map((group) =>
        group.key === key
          ? { ...group, suggestion: { ...group.suggestion, ...patch } }
          : group,
      ),
    );
  }

  async function applyAll() {
    if (!groups.length) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/expense-classify/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: groups.map((group) => group.suggestion) }),
      });
      const data = (await response.json()) as {
        savedRules?: number;
        expensesUpdated?: number;
        reviewConverted?: number;
        reviewResolved?: number;
        error?: string;
      };
      if (!response.ok || data.error) throw new Error(data.error || "ثبت تصمیم‌ها انجام نشد.");
      setMessage(
        `${(data.savedRules ?? 0).toLocaleString("fa-IR")} قاعده ذخیره شد؛ ${(data.expensesUpdated ?? 0).toLocaleString("fa-IR")} هزینه به‌روزرسانی و ${(data.reviewResolved ?? 0).toLocaleString("fa-IR")} مورد مبهم تعیین تکلیف شد.`,
      );
      await analyze();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت تصمیم‌ها انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span>ساده، یک‌بار برای همیشه</span>
          <h2>هزینه‌های هلو را بده؛ برنامه خودش مرتب می‌کند</h2>
          <p>
            رنگ چاپ، ریتاردر، کلیشه، تعمیر دستگاه، کارتن، ارسال، اجاره و سایر شرح‌ها گروه‌بندی می‌شوند. پیشنهاد هوش مصنوعی را کنترل می‌کنی و بعد همان تصمیم برای ورودهای آینده هم حفظ می‌شود.
          </p>
        </div>
        <button type="button" onClick={analyze} disabled={loading || saving}>
          {loading ? "در حال بررسی هزینه‌ها…" : groups.length ? "تحلیل دوباره هزینه‌ها" : "شروع بررسی هوشمند"}
        </button>
      </section>

      <section className={styles.steps}>
        <article><strong>۱</strong><div><h3>بررسی خودکار</h3><p>شرح‌های مشابه یک‌جا جمع می‌شوند.</p></div></article>
        <article><strong>۲</strong><div><h3>تأیید ساده</h3><p>فقط موارد نامطمئن را اصلاح می‌کنی.</p></div></article>
        <article><strong>۳</strong><div><h3>قیمت‌گذاری</h3><p>هزینه تأییدشده وارد بهای واقعی می‌شود.</p></div></article>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {warning ? <div className={styles.warning}>{warning}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      {summary ? (
        <section className={styles.metrics}>
          <article><span>گروه هزینه</span><strong>{summary.groupCount.toLocaleString("fa-IR")}</strong></article>
          <article><span>ردیف هزینه</span><strong>{summary.expenseCount.toLocaleString("fa-IR")}</strong></article>
          <article><span>موارد مبهم</span><strong>{summary.pendingReviewCount.toLocaleString("fa-IR")}</strong></article>
          <article><span>مجموع بررسی‌شده</span><strong>{formatMoney(summary.totalAmount)}</strong></article>
        </section>
      ) : null}

      {groups.length ? (
        <>
          <section className={styles.toolbar}>
            <div>
              <h3>پیشنهادهای هزینه</h3>
              <p>{usedAi ? "پیشنهادها با هوش مصنوعی و قواعد داخلی ترکیب شده‌اند." : "پیشنهادهای مطمئن داخلی برنامه نمایش داده شده‌اند."}</p>
            </div>
            <div className={styles.toolbarActions}>
              <label>
                <input
                  type="checkbox"
                  checked={onlyNeedsReview}
                  onChange={(event) => {
                    setOnlyNeedsReview(event.target.checked);
                    setVisibleCount(24);
                  }}
                />
                فقط موارد نیازمند توجه
              </label>
              <button type="button" onClick={applyAll} disabled={saving || loading}>
                {saving ? "در حال ثبت…" : "تأیید همه و استفاده در قیمت‌گذاری"}
              </button>
            </div>
          </section>

          <section className={styles.cards}>
            {filteredGroups.slice(0, visibleCount).map((group) => {
              const suggestion = group.suggestion;
              const lowConfidence = suggestion.confidence < 0.7;
              return (
                <article className={`${styles.card} ${lowConfidence ? styles.cardAttention : ""}`} key={group.key}>
                  <header>
                    <div>
                      <h3>{group.label}</h3>
                      <p>
                        {group.count.toLocaleString("fa-IR")} ردیف · {formatMoney(group.totalAmount)}
                        {group.reviewIds.length ? ` · ${group.reviewIds.length.toLocaleString("fa-IR")} مورد مبهم` : ""}
                      </p>
                    </div>
                    <span className={lowConfidence ? styles.confidenceLow : styles.confidence}>
                      {confidenceLabel(suggestion.confidence)}
                    </span>
                  </header>

                  <div className={styles.formGrid}>
                    <label>
                      گروه هزینه
                      <select
                        value={suggestion.category}
                        onChange={(event) => updateSuggestion(group.key, { category: event.target.value })}
                      >
                        {Object.entries(expenseCategoryLabels).map(([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      این پول کجا حساب شود؟
                      <select
                        value={suggestion.costScope}
                        onChange={(event) => {
                          const scope = event.target.value;
                          updateSuggestion(group.key, {
                            costScope: scope,
                            manufacturingSharePercent:
                              scope === "manufacturing" ? Math.max(1, suggestion.manufacturingSharePercent || 100) : 0,
                          });
                        }}
                      >
                        {scopeOptions.map((scope) => (
                          <option value={scope} key={scope}>{costScopeLabels[scope]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      نوع هزینه
                      <select
                        value={suggestion.costBehavior}
                        onChange={(event) => updateSuggestion(group.key, { costBehavior: event.target.value })}
                      >
                        {Object.entries(costBehaviorLabels).map(([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    {suggestion.costScope === "manufacturing" ? (
                      <label>
                        سهمی که وارد بهای محصول شود
                        <div className={styles.percentField}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={suggestion.manufacturingSharePercent}
                            onChange={(event) =>
                              updateSuggestion(group.key, {
                                manufacturingSharePercent: Math.min(100, Math.max(0, Number(event.target.value))),
                              })
                            }
                          />
                          <span>٪</span>
                        </div>
                      </label>
                    ) : null}
                  </div>

                  <div className={styles.reason}>
                    <strong>دلیل پیشنهاد:</strong> {suggestion.reason}
                  </div>
                </article>
              );
            })}
          </section>

          {filteredGroups.length > visibleCount ? (
            <button className={styles.moreButton} type="button" onClick={() => setVisibleCount((value) => value + 24)}>
              نمایش موارد بیشتر ({(filteredGroups.length - visibleCount).toLocaleString("fa-IR")})
            </button>
          ) : null}

          <section className={styles.finish}>
            <div>
              <h3>بعد از تأیید چه می‌شود؟</h3>
              <p>همین تصمیم‌ها روی هزینه‌های فعلی اعمال و برای فایل‌های هلو بعدی ذخیره می‌شوند. سپس می‌توانی سربار و قیمت‌ها را محاسبه کنی.</p>
            </div>
            <div>
              <button type="button" onClick={applyAll} disabled={saving || loading}>
                {saving ? "در حال ثبت…" : "تأیید همه"}
              </button>
              <Link href="/accounting/pricing/setup">ادامه به محاسبه بهای تمام‌شده</Link>
            </div>
          </section>
        </>
      ) : (
        <section className={styles.empty}>
          <h3>هنوز تحلیلی اجرا نشده است</h3>
          <p>روی «شروع بررسی هوشمند» بزن. برنامه اطلاعات قبلی هلو و هزینه‌های دستی را خودش می‌خواند.</p>
        </section>
      )}
    </div>
  );
}
