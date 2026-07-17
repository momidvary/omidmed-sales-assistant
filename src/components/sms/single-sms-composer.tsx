"use client";

import { useMemo, useState } from "react";
import AiSmsSuggester from "./ai-sms-suggester";
import styles from "./sms.module.css";

type Props = {
  customerId?: string;
  customerName?: string;
  phone?: string | null;
  source?: "manual" | "customer" | "quote" | "campaign" | "accounting";
  campaignId?: string | null;
  campaignMemberId?: string | null;
  opportunityId?: string | null;
  defaultText?: string;
  compact?: boolean;
};

export default function SingleSmsComposer({
  customerId,
  customerName,
  phone,
  source = "customer",
  campaignId,
  campaignMemberId,
  opportunityId,
  defaultText,
  compact = false,
}: Props) {
  const initialText = useMemo(
    () =>
      defaultText ||
      `${customerName || "مشتری گرامی"}، وقت بخیر. برای پیگیری نیاز مجموعه شما به لوازم مصرفی فیزیوتراپی در خدمتتان هستیم. امیدمِد`,
    [customerName, defaultText],
  );

  const defaultAiPurpose =
    source === "quote"
      ? "quote"
      : source === "accounting"
        ? "payment"
        : "reorder";

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialText);
  const [manualMobile, setManualMobile] = useState(phone || "");
  const [scheduleFollowup, setScheduleFollowup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function send() {
    if (!text.trim()) {
      setMessage({ type: "error", text: "متن پیامک خالی است." });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          mobile: customerId ? undefined : manualMobile,
          text,
          source,
          campaignId,
          campaignMemberId,
          opportunityId,
          scheduleFollowup,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        success?: boolean;
        recId?: string;
        warning?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || "ارسال پیامک انجام نشد.");
      }

      setMessage({
        type: "success",
        text:
          result.warning ||
          `پیامک ارسال شد${result.recId ? `؛ شناسه ${result.recId}` : ""}.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "ارسال انجام نشد.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${styles.singleWrap} ${compact ? styles.compact : ""}`}>
      <button
        className={styles.openButton}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "بستن پیامک" : "ارسال پیامک"}
      </button>

      {open ? (
        <div className={styles.composer}>
          {!customerId ? (
            <label>
              شماره موبایل
              <input
                dir="ltr"
                value={manualMobile}
                onChange={(event) => setManualMobile(event.target.value)}
                placeholder="09xxxxxxxxx"
              />
            </label>
          ) : (
            <div className={styles.recipient}>
              گیرنده: <b>{customerName || "مشتری"}</b>
              <span dir="ltr">{phone || "بدون شماره"}</span>
            </div>
          )}

          {customerId ? (
            <AiSmsSuggester
              mode="customer"
              customerId={customerId}
              defaultPurpose={defaultAiPurpose}
              onSelect={(suggestedText) => {
                setText(suggestedText);
                setMessage(null);
              }}
            />
          ) : null}

          <label>
            متن پیامک
            <textarea
              rows={compact ? 4 : 6}
              maxLength={1500}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>

          <div className={styles.counter}>
            {new Intl.NumberFormat("fa-IR").format(text.length)} نویسه
          </div>

          {customerId ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={scheduleFollowup}
                onChange={(event) => setScheduleFollowup(event.target.checked)}
              />
              سه روز بعد برای پیگیری یادآوری شود
            </label>
          ) : null}

          {message ? (
            <div
              className={
                message.type === "success" ? styles.success : styles.error
              }
            >
              {message.text}
            </div>
          ) : null}

          <button
            className={styles.sendButton}
            type="button"
            disabled={loading}
            onClick={send}
          >
            {loading ? "در حال ارسال..." : "تأیید و ارسال پیامک"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
