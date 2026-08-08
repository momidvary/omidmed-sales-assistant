"use client";

import { useMemo, useRef, useState } from "react";

import { normalizeIranianMobile } from "@/lib/whatsapp/cloud-api";
import type { WhatsAppReadiness } from "@/lib/whatsapp/readiness";

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
  provider_result_unknown_at: string | null;
};

type TemplateOption = {
  id: string;
  name: string;
  status: string;
  language: string;
  category: string;
  variable_count: number;
  last_synced_at: string;
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
  provider_result_unknown: "نتیجه سرویس نامشخص",
};

export default function WhatsAppContentCard({
  itemId,
  imageUrl,
  payload,
  customers,
  history,
  readiness,
  templates: initialTemplates,
}: {
  itemId: string;
  imageUrl: string | null;
  payload: Payload;
  customers: CustomerOption[];
  history: HistoryItem[];
  readiness: WhatsAppReadiness;
  templates: TemplateOption[];
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
  const [templates, setTemplates] = useState(initialTemplates);
  const [templateKey, setTemplateKey] = useState("");
  const [templateVariables, setTemplateVariables] = useState("");
  const [windowConfirmed, setWindowConfirmed] = useState(false);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentOverride, setConsentOverride] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const [dirty, setDirty] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const selected = customers.find((customer) => customer.id === customerId);
  const consentStatus = consentOverride ?? selected?.whatsapp_consent_status ?? "unknown";
  const normalized = selected?.phone ? normalizeIranianMobile(selected.phone) : null;
  const selectedText = texts[variant];
  const selectedTemplate = templates.find(
    (template) => `${template.name}|${template.language}` === templateKey,
  );
  const statusOnly = payload.content_type === "status";
  const manualUrl = useMemo(() => {
    if (!normalized || consentStatus !== "opted_in" || statusOnly) return null;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(selectedText)}`;
  }, [normalized, consentStatus, selectedText, statusOnly]);
  const cloudSendAvailable = Boolean(
    readiness.sendReady &&
      customerId &&
      normalized &&
      consentStatus === "opted_in" &&
      finalConfirmed &&
      (messageType !== "template" || selectedTemplate) &&
      (messageType !== "image" || imageUrl) &&
      !statusOnly,
  );

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

  async function saveContent() {
    if (pending) return;
    setPending(true);
    setResult("");
    try {
      const channelPayload = {
        ...payload,
        whatsapp_short_text: texts.short.trim(),
        whatsapp_long_text: texts.long.trim(),
        whatsapp_status_text: texts.status.trim(),
      };
      const response = await fetch(`/api/content-studio/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: texts.long,
          finalText: selectedText,
          channelPayload,
          changeKind: "edit",
        }),
      });
      const data = (await response.json()) as { ok?: boolean; version?: number; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message);
      setDirty(false);
      setResult(`نسخه ${Number(data.version).toLocaleString("fa-IR")} ذخیره شد.`);
    } catch {
      setResult("ذخیره نسخه محتوا انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function syncTemplates() {
    if (pending) return;
    setPending(true);
    setResult("");
    try {
      const syncResponse = await fetch("/api/whatsapp/templates", { method: "POST" });
      if (!syncResponse.ok) throw new Error();
      const listResponse = await fetch("/api/whatsapp/templates", { cache: "no-store" });
      const data = (await listResponse.json()) as { ok?: boolean; templates?: TemplateOption[] };
      if (!listResponse.ok || !data.ok) throw new Error();
      setTemplates(data.templates ?? []);
      setResult("فهرست Templateهای Meta به‌روز شد.");
    } catch {
      setResult("همگام‌سازی Templateهای Meta انجام نشد؛ تنظیمات سرور را بررسی کنید.");
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
          templateName: selectedTemplate?.name ?? "",
          templateVariables: templateVariables.split("\n").map((item) => item.trim()).filter(Boolean),
          templateApprovedConfirmed: Boolean(selectedTemplate),
          templateLanguage: selectedTemplate?.language ?? "fa",
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
        onChange={(event) => {
          setTexts((current) => ({ ...current, [variant]: event.target.value }));
          setDirty(true);
        }}
      />
      <div className={styles.textTools}>
        <span>{selectedText.length.toLocaleString("fa-IR")} نویسه</span>
        <button type="button" disabled={pending || !dirty} onClick={saveContent}>ذخیره و ثبت نسخه</button>
        <CopyButton itemId={itemId} text={texts.short} label="کپی متن کوتاه" className={styles.copyButton} />
        <CopyButton itemId={itemId} text={texts.long} label="کپی متن کامل" className={styles.copyButton} />
        <CopyButton itemId={itemId} text={texts.status} label="کپی استاتوس" className={styles.copyButton} />
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
              <b>آمادگی اتصال واتساپ</b>
              <span>Schema و migration: {readiness.schemaReady ? "آماده" : "آماده نیست"}</span>
              <span>Meta Cloud API: {readiness.cloudApiConfigured ? "کامل" : "ناقص"}</span>
              <span>Graph API version: {readiness.graphApiVersionConfigured ? "معتبر" : "تنظیم نشده"}</span>
              <span>Webhook: {readiness.webhookConfigured ? "کامل" : "ناقص"}</span>
              <span>شماره مشتری: {normalized ? "معتبر" : "نامعتبر یا ثبت‌نشده"}</span>
              <span>رضایت: {consentStatus === "opted_in" ? "ثبت شده" : consentStatus === "opted_out" ? "انصراف" : "نامشخص"}</span>
              <span>لینک دستی wa.me: {manualUrl ? "آماده" : "غیرفعال"}</span>
              <span>ارسال رسمی Cloud API: {cloudSendAvailable ? "آماده" : "غیرفعال"}</span>
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
              <button type="button" disabled={pending || !readiness.schemaReady || !consentSource.trim()} onClick={() => saveConsent("opted_in")}>ثبت رضایت</button>
              <button type="button" disabled={pending || !readiness.schemaReady || !consentSource.trim()} onClick={() => saveConsent("opted_out")}>ثبت انصراف</button>
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
                <label>
                  Template تأییدشده Meta
                  <select value={templateKey} onChange={(event) => {
                    setTemplateKey(event.target.value);
                    const template = templates.find((item) => `${item.name}|${item.language}` === event.target.value);
                    setTemplateVariables(
                      Array.from({ length: template?.variable_count ?? 0 }, (_, index) => `مقدار ${index + 1}`).join("\n"),
                    );
                  }}>
                    <option value="">انتخاب از فهرست همگام‌شده</option>
                    {templates.map((template) => (
                      <option key={template.id} value={`${template.name}|${template.language}`}>
                        {template.name} — {template.language} — {template.category}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea value={templateVariables} onChange={(event) => setTemplateVariables(event.target.value)} placeholder="هر متغیر در یک خط" />
                <button type="button" disabled={pending || !readiness.cloudApiConfigured} onClick={syncTemplates}>همگام‌سازی از Meta</button>
                <small>فقط Templateهای APPROVED دریافت‌شده مستقیم از Meta قابل ارسال‌اند؛ نام حدسی پذیرفته نمی‌شود.</small>
              </div>
            ) : (
              <label className={styles.checkRow}><input type="checkbox" checked={windowConfirmed} onChange={(event) => setWindowConfirmed(event.target.checked)} /> مشتری در ۲۴ ساعت گذشته گفتگو را آغاز کرده و پنجره مکالمه باز است.</label>
            )}
            <label className={styles.checkRow}><input type="checkbox" checked={finalConfirmed} onChange={(event) => setFinalConfirmed(event.target.checked)} /> گیرنده و متن را بررسی کردم و ارسال واقعی را تأیید می‌کنم.</label>
            <button
              type="button"
              disabled={pending || !cloudSendAvailable}
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
                  message.provider_result_unknown_at ||
                  message.created_at,
              ).toLocaleString("fa-IR")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
