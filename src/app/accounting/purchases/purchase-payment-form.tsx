"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import styles from "../accounting.module.css";

const faDigits = "۰۱۲۳۴۵۶۷۸۹";

function amountValue(value: string) {
  const parsed = Number(
    value
      .replace(/[۰-۹]/g, (digit) => String(faDigits.indexOf(digit)))
      .replace(/[٬,\s]/g, ""),
  );
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export default function PurchasePaymentForm({
  invoiceId,
  outstanding,
  totalAmount,
}: {
  invoiceId: string;
  outstanding: number | null;
  totalAmount: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = amountValue(String(data.get("amount") ?? ""));
    const isOpeningReview = outstanding === null;
    const maximum = isOpeningReview ? totalAmount : outstanding;
    if (amount <= 0 || amount > maximum) {
      setMessage("مبلغ پرداخت باید مثبت و حداکثر برابر مانده باشد.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = isOpeningReview
      ? await supabase.rpc("set_purchase_opening_paid_amount", {
          p_purchase_invoice_id: invoiceId,
          p_opening_paid_amount: amount,
        })
      : await supabase.rpc("record_purchase_payment", {
          p_purchase_invoice_id: invoiceId,
          p_request_id: requestId.current,
          p_amount: amount,
          p_payment_date: null,
          p_payment_method: String(data.get("payment_method") ?? "bank_transfer"),
          p_reference: String(data.get("reference") ?? "").trim() || null,
          p_notes: null,
        });
    if (error) {
      setMessage("ثبت پرداخت انجام نشد؛ شناسه خطا: PURCHASE_PAYMENT_SAVE_FAILED");
      setBusy(false);
      return;
    }
    requestId.current = crypto.randomUUID();
    form.reset();
    setMessage(isOpeningReview ? "مبلغ پرداخت‌شده قبلی ثبت شد." : "پرداخت ثبت شد.");
    setBusy(false);
    router.refresh();
  }

  if (outstanding !== null && outstanding <= 0) return <span className={styles.status}>تسویه کامل</span>;
  return (
    <form className={styles.form} onSubmit={submit}>
      {outstanding === null ? <small>برای جلوگیری از نمایش بدهی اشتباه، مبلغی را که قبلاً پرداخت شده وارد کن.</small> : null}
      <input name="amount" inputMode="decimal" placeholder={outstanding === null ? "پرداخت‌شده قبلی" : "مبلغ پرداخت"} aria-label={outstanding === null ? "پرداخت‌شده قبلی" : "مبلغ پرداخت"} />
      {outstanding !== null ? <select name="payment_method" defaultValue="bank_transfer" aria-label="روش پرداخت">
        <option value="bank_transfer">واریز بانکی</option>
        <option value="cash">نقد</option>
        <option value="card">کارت</option>
        <option value="cheque">چک</option>
        <option value="other">سایر</option>
      </select> : null}
      {outstanding !== null ? <input name="reference" maxLength={200} placeholder="شماره پیگیری (اختیاری)" /> : null}
      <button type="submit" disabled={busy}>{busy ? "در حال ثبت…" : outstanding === null ? "ثبت مانده افتتاحیه" : "ثبت پرداخت"}</button>
      {message ? <small>{message}</small> : null}
    </form>
  );
}
