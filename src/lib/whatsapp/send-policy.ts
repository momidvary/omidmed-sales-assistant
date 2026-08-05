import {
  normalizeIranianMobile,
  validateTemplateName,
  type WhatsAppMessageType,
} from "./cloud-api";

export type SendPolicyInput = {
  confirmed: boolean;
  consentStatus: string;
  mobile: string;
  messageType: WhatsAppMessageType;
  conversationWindowConfirmed?: boolean;
  templateName?: string;
  templateVariables?: string[];
  templateApprovedConfirmed?: boolean;
};

export type SendPolicyResult =
  | { ok: true; normalizedMobile: string }
  | { ok: false; code: string; message: string };

export function validateSendPolicy(input: SendPolicyInput): SendPolicyResult {
  if (!input.confirmed) {
    return { ok: false, code: "CONFIRMATION_REQUIRED", message: "تأیید نهایی ارسال لازم است." };
  }
  if (input.consentStatus !== "opted_in") {
    return { ok: false, code: "CONSENT_REQUIRED", message: "رضایت واتساپ مشتری ثبت نشده است." };
  }
  const normalizedMobile = normalizeIranianMobile(input.mobile);
  if (!normalizedMobile) {
    return { ok: false, code: "INVALID_MOBILE", message: "شماره موبایل ایرانی معتبر نیست." };
  }
  if (input.messageType === "template") {
    if (!input.templateApprovedConfirmed) {
      return {
        ok: false,
        code: "TEMPLATE_APPROVAL_REQUIRED",
        message: "باید تأیید کنید Template قبلاً در Meta تأیید شده است.",
      };
    }
    if (!input.templateName || !validateTemplateName(input.templateName)) {
      return { ok: false, code: "INVALID_TEMPLATE", message: "نام Template تأییدشده معتبر نیست." };
    }
    if (
      !Array.isArray(input.templateVariables) ||
      input.templateVariables.some((value) => typeof value !== "string" || !value.trim())
    ) {
      return { ok: false, code: "INVALID_TEMPLATE", message: "مقادیر Template معتبر نیستند." };
    }
  } else if (!input.conversationWindowConfirmed) {
    return {
      ok: false,
      code: "WINDOW_REQUIRED",
      message: "برای متن آزاد باید پنجره مکالمه ۲۴ ساعته تأیید شود.",
    };
  }
  return { ok: true, normalizedMobile };
}
