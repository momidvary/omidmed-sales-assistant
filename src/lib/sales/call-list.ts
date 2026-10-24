// Who to phone today. SMS is the main channel: physiotherapists are often
// with a patient and a call interrupts them, while a message waits until
// they are free. A call is only for the cases a message cannot cover.

import { RECENT_CONTACT_DAYS, tehranDayBounds } from "./followup-need";

const DAY_MS = 86_400_000;
/** SMS outcomes older than this no longer put anyone on the call list. */
export const CALL_SMS_WINDOW_DAYS = 30;
/** A valuable customer who got an SMS this long ago without a response is called. */
export const NO_REPLY_DAYS = 7;

export type CallKind = "scheduled" | "undelivered" | "no_mobile" | "no_reply";

export const CALL_KIND_LABELS: Record<CallKind, string> = {
  scheduled: "پیگیری تعیین‌شده",
  undelivered: "پیامک نرسید",
  no_mobile: "موبایل ندارد",
  no_reply: "بی‌پاسخ به پیامک",
};

const RANK: Record<CallKind, number> = { scheduled: 0, undelivered: 1, no_mobile: 2, no_reply: 3 };

export type LastSms = {
  at: string;
  deliveryStatus: string | null;
  providerStatus: string | null;
  mode: string | null;
};

export type CallNeed = { kind: CallKind; rank: number; reason: string };

const persianNumber = new Intl.NumberFormat("fa-IR");

function undeliveredWhy(sms: LastSms) {
  const code = sms.providerStatus?.match(/کد\s*(\d+)/)?.[1] ?? null;
  if (code === "35") {
    return sms.mode === "pattern"
      ? "شماره در فهرست سیاه است"
      : "شماره پیامک تبلیغاتی را بسته؛ می‌توانید اول الگوی «یادآوری سفارش مجدد» را بفرستید";
  }
  if (code === "2" || code === "16") return "به گوشی نرسید (خاموش یا خارج از دسترس)";
  return "نرسید";
}

export function callNeed(input: {
  customer: { status: string; next_followup_at: string | null; last_purchase_at: string | null; phone: string | null };
  hasMobile: boolean;
  /** First reason from today's SMS scoring, when the customer has one. */
  smsReason: string | null;
  lastSms: LastSms | null;
  lastContactAt: string | null;
  highValue: boolean;
  now: Date;
}): CallNeed | null {
  const { customer, now } = input;
  if (customer.status === "lost") return null;
  const need = (kind: CallKind, reason: string) => ({ kind, rank: RANK[kind], reason });

  // A date the user chose always counts.
  if (customer.next_followup_at && Date.parse(customer.next_followup_at) <= tehranDayBounds(now).end) {
    return need("scheduled", "موعد پیگیری‌ای که تعیین کرده‌اید رسیده");
  }

  const contactAge = input.lastContactAt ? (now.getTime() - Date.parse(input.lastContactAt)) / DAY_MS : Infinity;
  if (contactAge < RECENT_CONTACT_DAYS) return null;

  const sms = input.lastSms;
  const smsAge = sms ? (now.getTime() - Date.parse(sms.at)) / DAY_MS : Infinity;
  // A purchase or a logged contact after the SMS is its answer.
  const answered =
    sms &&
    ((customer.last_purchase_at && customer.last_purchase_at >= sms.at.slice(0, 10)) ||
      (input.lastContactAt && input.lastContactAt > sms.at));

  if (sms && smsAge < CALL_SMS_WINDOW_DAYS && !answered) {
    if (["undelivered", "failed", "rejected"].includes(sms.deliveryStatus ?? "")) {
      return need("undelivered", `پیامک ${persianNumber.format(Math.floor(smsAge))} روز پیش ${undeliveredWhy(sms)}`);
    }
  }

  if (!input.hasMobile && input.smsReason) {
    return need(
      "no_mobile",
      `${customer.phone?.trim() ? "موبایل ثبت نشده" : "هیچ شماره‌ای ثبت نشده"}؛ ${input.smsReason}`,
    );
  }

  if (input.highValue && sms && smsAge >= NO_REPLY_DAYS && smsAge < CALL_SMS_WINDOW_DAYS && !answered) {
    return need(
      "no_reply",
      `پیامک ${persianNumber.format(Math.floor(smsAge))} روز پیش رفت؛ بعد از آن خرید یا تماسی ثبت نشده`,
    );
  }
  return null;
}
