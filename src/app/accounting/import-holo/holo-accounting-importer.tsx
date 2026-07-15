"use client";

import { useMemo, useState } from "react";
import {
  costBehaviorLabels,
  expenseCategoryLabels,
} from "@/lib/accounting/constants";
import {
  type HoloAccountingEntry,
  type HoloAccountingGroup,
  type HoloAccountingKind,
  type HoloReviewKind,
  parseHoloAccountingFp3,
} from "@/lib/accounting/holo-fp3";
import styles from "./holo-accounting-importer.module.css";

type GroupChoice = {
  kind: HoloAccountingKind;
  category: string;
  costBehavior: string;
  reviewKind: HoloReviewKind;
};

type ImportResult = {
  expensesInserted: number;
  partnerWithdrawalsInserted: number;
  reviewItemsInserted: number;
  ignored: number;
  duplicates: number;
};

const kindLabels: Record<HoloAccountingKind, string> = {
  expense: "هزینه کارگاه",
  partner_withdrawal: "برداشت شریک",
  review: "نیازمند بررسی حسابداری",
  ignore: "نادیده گرفته شود",
};

const reviewLabels: Record<HoloReviewKind, string> = {
  asset_purchase: "خرید دارایی / تجهیزات",
  installment: "قسط؛ اصل و هزینه مالی باید تفکیک شود",
  ambiguous: "شرح نامشخص",
};

function money(value: number) {
  return `${Math.round(value).toLocaleString("fa-IR")} تومان`;
}

function createInitialChoices(groups: HoloAccountingGroup[]) {
  return Object.fromEntries(
    groups.map((group) => [
      group.key,
      {
        kind: group.suggestedKind,
        category: group.suggestedCategory ?? "other",
        costBehavior: group.suggestedCostBehavior ?? "mixed",
        reviewKind: group.suggestedReviewKind ?? "ambiguous",
      } satisfies GroupChoice,
    ]),
  );
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export default function HoloAccountingImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [checksum, setChecksum] = useState("");
  const [entries, setEntries] = useState<HoloAccountingEntry[]>([]);
  const [groups, setGroups] = useState<HoloAccountingGroup[]>([]);
  const [choices, setChoices] = useState<Record<string, GroupChoice>>({});
  const [unit, setUnit] = useState<"toman" | "rial">("toman");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const adjustedSummary = useMemo(() => {
    let expense = 0;
    let partner = 0;
    let review = 0;
    let ignored = 0;
    let expenseAmount = 0;
    let partnerAmount = 0;
    let reviewAmount = 0;
    const multiplier = unit === "rial" ? 0.1 : 1;

    for (const entry of entries) {
      const choice = choices[entry.groupKey];
      if (!choice) continue;
      const amount = Math.round(Math.max(entry.debit, entry.credit) * multiplier);
      if (choice.kind === "expense") {
        expense += 1;
        expenseAmount += amount;
      } else if (choice.kind === "partner_withdrawal") {
        partner += 1;
        partnerAmount += amount;
      } else if (choice.kind === "review") {
        review += 1;
        reviewAmount += amount;
      } else {
        ignored += 1;
      }
    }

    return { expense, partner, review, ignored, expenseAmount, partnerAmount, reviewAmount };
  }, [choices, entries, unit]);

  async function readFile(selected: File | null) {
    setFile(selected);
    setEntries([]);
    setGroups([]);
    setChoices({});
    setResult(null);
    setMessage("");
    setError("");
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".fp3")) {
      setError("فقط فایل FP3 هلو قابل انتخاب است.");
      return;
    }
    if (selected.size > 12 * 1024 * 1024) {
      setError("حجم فایل بیشتر از ۱۲ مگابایت است.");
      return;
    }

    setBusy(true);
    try {
      const buffer = await selected.arrayBuffer();
      const parsed = parseHoloAccountingFp3(buffer);
      if (!parsed.entries.length) throw new Error("هیچ ردیف مالی قابل‌خواندن پیدا نشد.");
      setChecksum(await sha256(buffer));
      setEntries(parsed.entries);
      setGroups(parsed.groups);
      setChoices(createInitialChoices(parsed.groups));
      setMessage(`${parsed.entries.length.toLocaleString("fa-IR")} ردیف از فایل خوانده شد. قبل از ثبت، گروه‌های زرد را بررسی کن.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "خواندن فایل انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function updateChoice(key: string, patch: Partial<GroupChoice>) {
    setChoices((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  }

  async function submitImport() {
    if (!file || !entries.length || !checksum) return;
    setBusy(true);
    setError("");
    setMessage("");
    setResult(null);

    try {
      const payload = {
        fileName: file.name,
        fileChecksum: checksum,
        unit,
        rows: entries.map((entry) => {
          const choice = choices[entry.groupKey];
          return {
            sourceAccount: entry.sourceAccount,
            documentNumber: entry.documentNumber,
            jalaliDate: entry.jalaliDate,
            gregorianDate: entry.gregorianDate,
            debit: entry.debit,
            credit: entry.credit,
            description: entry.description,
            normalizedDescription: entry.normalizedDescription,
            partnerName: entry.partnerName,
            kind: choice.kind,
            category: choice.category,
            costBehavior: choice.costBehavior,
            reviewKind: choice.reviewKind,
          };
        }),
      };

      const response = await fetch("/api/accounting/holo-expenses/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "ثبت اطلاعات انجام نشد.");
      setResult(json as ImportResult);
      setMessage("ورود اطلاعات هلو با موفقیت کامل شد. ردیف‌های تکراری دوباره ثبت نشده‌اند.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت اطلاعات انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      {error ? <div className={styles.alert}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <span>مرحله ۱</span>
            <h2>انتخاب فایل دفتر هزینه و جاری شرکا</h2>
            <p>فایل خام در سرور ذخیره نمی‌شود؛ فقط ردیف‌های تأییدشده وارد Supabase می‌شوند.</p>
          </div>
        </div>
        <label className={styles.dropZone}>
          <input type="file" accept=".fp3" onChange={(event) => readFile(event.target.files?.[0] ?? null)} />
          <strong>{file ? file.name : "فایل FP3 را انتخاب کن"}</strong>
          <small>{file ? `${(file.size / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 0 })} کیلوبایت` : "گزارش دفتر هزینه‌ها و جاری شرکا از هلو"}</small>
        </label>
        <div className={styles.unitRow}>
          <strong>واحد مبلغ داخل فایل:</strong>
          <label><input type="radio" checked={unit === "toman"} onChange={() => setUnit("toman")} /> تومان</label>
          <label><input type="radio" checked={unit === "rial"} onChange={() => setUnit("rial")} /> ریال؛ هنگام ثبت بر ۱۰ تقسیم شود</label>
        </div>
      </section>

      {entries.length ? (
        <>
          <section className={styles.metrics}>
            <article><span>کل ردیف‌ها</span><strong>{entries.length.toLocaleString("fa-IR")}</strong><small>{groups.length.toLocaleString("fa-IR")} شرح متفاوت</small></article>
            <article><span>هزینه قابل ثبت</span><strong>{adjustedSummary.expense.toLocaleString("fa-IR")}</strong><small>{money(adjustedSummary.expenseAmount)}</small></article>
            <article><span>برداشت شرکا</span><strong>{adjustedSummary.partner.toLocaleString("fa-IR")}</strong><small>{money(adjustedSummary.partnerAmount)}</small></article>
            <article><span>نیازمند بررسی</span><strong>{adjustedSummary.review.toLocaleString("fa-IR")}</strong><small>{money(adjustedSummary.reviewAmount)}</small></article>
          </section>

          <section className={styles.panel}>
            <div className={styles.heading}>
              <div>
                <span>مرحله ۲</span>
                <h2>کنترل دسته‌بندی شرح‌ها</h2>
                <p>هر انتخاب روی تمام ردیف‌های همان شرح اعمال می‌شود. «تاپین»، خرید دارایی و اقساط عمداً نیازمند بررسی گذاشته شده‌اند.</p>
              </div>
              <span className={styles.counter}>{adjustedSummary.ignored.toLocaleString("fa-IR")} ردیف نادیده گرفته می‌شود</span>
            </div>

            <div className={styles.groupList}>
              {groups.map((group) => {
                const choice = choices[group.key];
                return (
                  <article className={`${styles.groupCard} ${group.confidence === "low" ? styles.needsReview : ""}`} key={group.key}>
                    <div className={styles.groupInfo}>
                      <strong>{group.label}</strong>
                      <small>{group.sourceAccount} • {group.count.toLocaleString("fa-IR")} ردیف • {money(group.totalAmount * (unit === "rial" ? 0.1 : 1))}</small>
                    </div>
                    <div className={styles.controls}>
                      <label>نوع ثبت
                        <select value={choice.kind} onChange={(event) => updateChoice(group.key, { kind: event.target.value as HoloAccountingKind })}>
                          {Object.entries(kindLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                        </select>
                      </label>
                      {choice.kind === "expense" ? (
                        <>
                          <label>دسته هزینه
                            <select value={choice.category} onChange={(event) => updateChoice(group.key, { category: event.target.value })}>
                              {Object.entries(expenseCategoryLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                            </select>
                          </label>
                          <label>رفتار هزینه
                            <select value={choice.costBehavior} onChange={(event) => updateChoice(group.key, { costBehavior: event.target.value })}>
                              {Object.entries(costBehaviorLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                            </select>
                          </label>
                        </>
                      ) : null}
                      {choice.kind === "review" ? (
                        <label>دلیل بررسی
                          <select value={choice.reviewKind} onChange={(event) => updateChoice(group.key, { reviewKind: event.target.value as HoloReviewKind })}>
                            {Object.entries(reviewLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.heading}>
              <div>
                <span>مرحله ۳</span>
                <h2>ثبت نهایی</h2>
                <p>برداشت شرکا وارد هزینه تولید نمی‌شود. دارایی‌ها، اقساط و موارد مبهم در صف بررسی جدا ذخیره می‌شوند.</p>
              </div>
            </div>
            <button className={styles.primaryButton} disabled={busy} onClick={submitImport}>
              {busy ? "در حال پردازش..." : "تأیید و ثبت اطلاعات هلو"}
            </button>
            {result ? (
              <div className={styles.resultGrid}>
                <div><span>هزینه جدید</span><strong>{result.expensesInserted.toLocaleString("fa-IR")}</strong></div>
                <div><span>برداشت شریک</span><strong>{result.partnerWithdrawalsInserted.toLocaleString("fa-IR")}</strong></div>
                <div><span>صف بررسی</span><strong>{result.reviewItemsInserted.toLocaleString("fa-IR")}</strong></div>
                <div><span>تکراری / قبلاً ثبت‌شده</span><strong>{result.duplicates.toLocaleString("fa-IR")}</strong></div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
