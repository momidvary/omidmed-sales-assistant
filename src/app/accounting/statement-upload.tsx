"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./accounting.module.css";

type PreviewRow = {
  fingerprint: string;
  jalaliDate: string;
  time: string;
  kind: "deposit" | "withdrawal";
  amountRial: number;
  isFee: boolean;
  counterpartyName: string | null;
  duplicate: boolean;
};

type Preview = {
  accountNo: string;
  fromDate: string | null;
  toDate: string | null;
  totals: { depositRial: number; withdrawalRial: number };
  transactions: PreviewRow[];
};

type Failure = { error?: string; problems?: string[] };

const number = new Intl.NumberFormat("fa-IR");
const toman = (rial: number) => number.format(Math.round(rial / 10));

async function post(file: File, mode: "preview" | "import") {
  const body = new FormData();
  body.set("file", file);
  body.set("mode", mode);
  const response = await fetch("/api/bank/statements", { method: "POST", body });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw data as Failure;
  return data;
}

export default function StatementUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setFailure(null);
    setDone(null);
    if (!selected) return;
    setBusy(true);
    try {
      setPreview((await post(selected, "preview")) as unknown as Preview);
    } catch (caught) {
      setFailure(caught && typeof caught === "object" ? (caught as Failure) : { error: "خواندن فایل انجام نشد." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = (await post(file, "import")) as { inserted: number; duplicates: number; autoCategorized: number };
      setDone(
        `${number.format(result.inserted)} تراکنش جدید ثبت شد` +
          (result.duplicates ? `، ${number.format(result.duplicates)} تراکنش تکراری بود و دوباره ثبت نشد` : "") +
          (result.autoCategorized ? `، ${number.format(result.autoCategorized)} برداشت خودکار دسته‌بندی شد` : "") +
          ".",
      );
      setPreview(null);
      setFile(null);
      router.refresh();
    } catch (caught) {
      setFailure(caught && typeof caught === "object" ? (caught as Failure) : { error: "ثبت انجام نشد." });
    } finally {
      setBusy(false);
    }
  }

  const fresh = preview?.transactions.filter((tx) => !tx.duplicate) ?? [];

  return (
    <section className={styles.upload}>
      <div>
        <h3>بارگذاری صورت‌حساب بانک رسالت</h3>
        <p>
          از همراه‌بانک رسالت «صورت‌حساب سپرده» را به صورت PDF بگیرید و اینجا انتخاب کنید. تراکنش‌هایی که قبلاً ثبت
          شده‌اند دوباره ثبت نمی‌شوند، پس بازه‌های هم‌پوشان مشکلی ندارند.
        </p>
      </div>

      <label className={styles.fileButton}>
        {busy ? "در حال خواندن…" : "انتخاب فایل PDF"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            void choose(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </label>

      {failure ? (
        <div className={styles.alert}>
          <b>{failure.error ?? "خطا در خواندن فایل."}</b>
          {failure.problems?.length ? (
            <ul>
              {failure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {done ? <div className={styles.success}>{done}</div> : null}

      {preview ? (
        <div className={styles.preview}>
          <div className={styles.previewHead}>
            <span>
              حساب <b dir="ltr">{preview.accountNo}</b> از {preview.fromDate} تا {preview.toDate}
            </span>
            <span>
              واریز <b>{toman(preview.totals.depositRial)}</b> · برداشت <b>{toman(preview.totals.withdrawalRial)}</b> تومان
            </span>
            <span className={styles.checked}>مانده‌ها و جمع‌ها با صورت‌حساب می‌خواند ✓</span>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>تاریخ</th>
                <th>نوع</th>
                <th>طرف حساب</th>
                <th>مبلغ (تومان)</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {preview.transactions.map((tx) => (
                <tr key={tx.fingerprint} className={tx.duplicate ? styles.muted : undefined}>
                  <td>
                    {tx.jalaliDate} <small>{tx.time}</small>
                  </td>
                  <td>{tx.kind === "deposit" ? "واریز" : tx.isFee ? "کارمزد" : "برداشت"}</td>
                  <td>{tx.counterpartyName ?? "—"}</td>
                  <td className={tx.kind === "deposit" ? styles.in : styles.out}>{toman(tx.amountRial)}</td>
                  <td>{tx.duplicate ? "قبلاً ثبت شده" : "جدید"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.formActions}>
            <button type="button" className={styles.primary} disabled={busy || !fresh.length} onClick={confirm}>
              {fresh.length ? `ثبت ${number.format(fresh.length)} تراکنش جدید` : "همه تراکنش‌ها قبلاً ثبت شده‌اند"}
            </button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void choose(null)}>
              انصراف
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
