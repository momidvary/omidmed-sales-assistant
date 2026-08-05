"use client";

import { useMemo, useRef, useState } from "react";

import { normalizeIranianMobile } from "@/lib/whatsapp/cloud-api";

import CopyButton from "./copy-button";
import styles from "./content-studio.module.css";

type CustomerOption = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  whatsapp_consent_status: string;
  whatsapp_consent_at: string | null;
};

type HistoryItem = {
  id: string;
  status: string;
  message_type: string;
  created_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
};

type Payload = {
  content_type: string;
  whatsapp_short_text: string;
  whatsapp_long_text: string;
  whatsapp_status_text: string;
  call_to_action: string;
  suggested_template_name: string;
  template_variables: string[];
  compliance_note: string;
};

const statusLabels: Record<string, string> = {
  draft: "پیش‌نویس",
  pending_confirmation: "منتظر تأیید",
  accepted: "پذیرفته‌شده توسط Meta",
  sent: "ارسال‌شده",
  delivered: "تحویل‌شده",
  read: "خوانده‌شده",
  failed: "ناموفق",
};

export default function WhatsAppContentCard({
  itemId,
  imageUrl,
  payload,
  customers,
  history,
  apiConfigured,
}: {
  itemId: string;
  imageUrl: string | null;
  payload: Payload;
  customers: CustomerOption[];
  history: HistoryItem[];
  apiConfigured: boolean;
}) {
  const [variant, setVariant] = useState<"short" | "long" | "status">(
    payload.content_type === "status" ? "status" : "short",
  );
  const [texts, setTexts] = useState({
    short: payload.whatsapp_short_text,
    long: payload.whatsapp_long_text,
    status: payload.whatsapp_status_text,
  });
  const [customerId, setCustomerId] = useState("");
  const [messageType, setMessageType] = useState<"text" | "image" | "template">("text");
  const [templateName, setTemplateName] = useState(payload.suggested_template_name);
  const [templateVariables, setTemplateVariables] = useState(payload.template_variables.join("\n"));
  const [templateApproved, setTemplateApproved] = useState(false);
  const [windowConfirmed, setWindowConfirmed] = useState(false);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentOverride, setConsentOverride] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const requestIdRef = useRef<string | null>(null);

  const selected = customers.find((customer) => customer.id === customerId);
  const consentStatus = consentOverride ?? selected?.whatsapp_consent_status ?? "unknown";
  const normalized = selected?.phone ? normalizeIranianMobile(selected.phone) : null;
  const selectedText = texts[variant];
  const statusOnly = payload.content_type === "status";
  const manualUrl = useMemo(() => {
    if (!normalized || consentStatus !== "opted_in" || statusOnly) return null;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(selectedText)}`;
  }, [normalized, consentStatus, selectedText, statusOnly]);

  async function downloadImage() {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error();
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `omidmed-whatsapp-${itemId}.png`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setResult("دانلود تصویر انجام نشد؛ تصویر را در صفحه باز و ذخیره کنید.");
    }
  }

  async function saveConsent(status: "opted_in" | "opted_out") {
    if (!customerId || !consentSource.trim() || pending) return;
    setPending(true);
    setResult("");
    try {
      const response = await fetch("/api/whatsapp/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, status, source: consentSource }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message);
      setConsentOverride(status);
      setResult(status === "opted_in" ? "رضایت مشتری ثبت شد." : "انصراف مشتری ثبت شد.");
    } catch (error) {
      setResult(error instanceof Error && error.message ? error.message : "ثبت رضایت انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (pending || statusOnly) return;
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    setPending(true);
    setResult("");
    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentItemId: itemId,
          customerId,
          clientRequestId,
          confirmed: finalConfirmed,
          messageType,
          messageText: selectedText,
          imageUrl,
          conversationWindowConfirmed: windowConfirmed,
          templateName,
          templateVariables: templateVariables.split("\n").map((item) => item.trim()).filter(Boolean),
          templateApprovedConfirmed: templateApproved,
          templateLanguage: "fa",
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        notice?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.message);
      setResult(data.notice || "درخواست توسط Meta پذیرفته شد؛ تحویل هنوز تأیید نشده است.");
      setFinalConfirmed(false);
      requestIdRef.current = null;
    } catch (error) {
      setResult(error instanceof Error && error.message ? error.message : "ارسال انجام نشد.");
      setFinalConfirmed(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.whatsappPanel}>
      <div className={styles.variantTabs}>
        {(["short", "long", "status"] as const).map((key) => (
          <button
            className={variant === key ? styles.activeVariant : undefined}
            key={key}
            type="button"
            onClick={() => setVariant(key)}
          >
            {key === "short" ? "متن کوتاه" : key === "long" ? "متن کامل" : "استاتوس"}
          </button>
        ))}
      </div>
      <textarea
        aria-label="متن قابل ویرایش واتساپ"
        maxLength={variant === "long" ? 4000 : 1000}
        value={selectedText}
        onChange={(event) => setTexts((current) => ({ ...current, [variant]: event.target.value }))}
      />
      <div className={styles.textTools}>
        <span>{selectedText.length.toLocaleString("fa-IR")} نویسه</span>
        <CopyButton text={selectedText} label="کپی همین متن" className={styles.copyButton} />
        {imageUrl ? <button type="button" onClick={downloadImage}>دانلود تصویر</button> : null}
      </div>
      <p className={styles.compliance}>{payload.compliance_note}</p>

      {statusOnly ? (
        <div className={styles.manualReady}>
          <b>آماده ارسال دستی</b> — استاتوس خودکار ارسال نمی‌شود؛ فقط متن را کپی و تصویر را دانلود کنید.
        </div>
      ) : (
        <>
          <div className={styles.customerControls}>
            <label>
              مشتری CRM
              <select value={customerId} onChange={(event) => {
                setCustomerId(event.target.value);
                setConsentOverride(null);
                setFinalConfirmed(false);
              }}>
                <option value="">انتخاب مشتری</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} — {customer.contact_name || customer.city || "بدون مخاطب"}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.apiStatus}>
              <b>{apiConfigured ? "Cloud API تنظیم شده" : "Cloud API تنظیم نشده"}</b>
              <span>وضعیت رضایت: {consentStatus === "opted_in" ? "ثبت شده" : consentStatus === "opted_out" ? "انصراف" : "نامشخص"}</span>
              <span>شماره: {normalized ? "معتبر" : "نامعتبر یا ثبت‌نشده"}</span>
            </div>
          </div>

          {customerId ? (
            <div className={styles.consentBox}>
              <input
                value={consentSource}
                onChange={(event) => setConsentSource(event.target.value)}
                placeholder="منبع رضایت (مثلاً فرم حضوری یا تماس ثبت‌شده)"
                maxLength={200}
              />
              <button type="button" disabled={pending || !consentSource.trim()} onClick={() => saveConsent("opted_in")}>ثبت رضایت</button>
              <button type="button" disabled={pending || !consentSource.trim()} onClick={() => saveConsent("opted_out")}>ثبت انصراف</button>
            </div>
          ) : null}

          <div className={styles.manualReady}>
            <b>آماده ارسال دستی:</b> کپی و لینک امن wa.me فقط پیام را در واتساپ باز می‌کند و به معنی ارسال نیست.
            {manualUrl ? <a href={manualUrl} target="_blank" rel="noreferrer">باز کردن واتساپ</a> : <span>برای فعال‌شدن، مشتری با شماره معتبر و رضایت ثبت‌شده انتخاب کنید.</span>}
          </div>

          <div className={styles.sendBox}>
            <label>
              روش ارسال رسمی
              <select value={messageType} onChange={(event) => setMessageType(event.target.value as "text" | "image" | "template")}>
                <option value="text">متن آزاد در پنجره ۲۴ ساعته</option>
                <option value="image" disabled={!imageUrl}>تصویر در پنجره ۲۴ ساعته</option>
                <option value="template">Template تأییدشده Meta</option>
              </select>
            </label>
            {messageType === "template" ? (
              <div className={styles.templateFields}>
                <input dir="ltr" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="approved_template_name" />
                <textarea value={templateVariables} onChange={(event) => setTemplateVariables(event.target.value)} placeholder="هر متغیر در یک خط" />
                <label><input type="checkbox" checked={templateApproved} onChange={(event) => setTemplateApproved(event.target.checked)} /> این Template قبلاً در Meta تأیید شده است.</label>
                <small>نام و متغیر پیشنهادی AI فقط پیش‌نویس‌اند و تأیید Meta محسوب نمی‌شوند.</small>
              </div>
            ) : (
              <label className={styles.checkRow}><input type="checkbox" checked={windowConfirmed} onChange={(event) => setWindowConfirmed(event.target.checked)} /> مشتری در ۲۴ ساعت گذشته گفتگو را آغاز کرده و پنجره مکالمه باز است.</label>
            )}
            <label className={styles.checkRow}><input type="checkbox" checked={finalConfirmed} onChange={(event) => setFinalConfirmed(event.target.checked)} /> گیرنده و متن را بررسی کردم و ارسال واقعی را تأیید می‌کنم.</label>
            <button
              type="button"
              disabled={pending || !apiConfigured || !customerId || consentStatus !== "opted_in" || !normalized || !finalConfirmed}
              onClick={send}
            >
              {pending ? "در حال پردازش…" : "ارسال به یک مشتری با Cloud API"}
            </button>
          </div>
        </>
      )}

      {result ? <div className={styles.resultNotice}>{result}</div> : null}
      {history.length ? (
        <div className={styles.messageHistory}>
          <strong>تاریخچه ارسال این محتوا</strong>
          {history.map((message) => (
            <span key={message.id}>
              {statusLabels[message.status] || message.status} · {message.message_type} · {new Date(
                message.read_at ||
                  message.delivered_at ||
                  message.sent_at ||
                  message.accepted_at ||
                  message.failed_at ||
                  message.created_at,
              ).toLocaleString("fa-IR")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
