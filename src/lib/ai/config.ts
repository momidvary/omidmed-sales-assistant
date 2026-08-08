// Central AI provider configuration.
//
// Model identifiers are never guessed. Every model comes from an environment
// variable, and a missing or malformed value produces a controlled
// configuration error instead of a request against an invented model name.

export type AiFeature =
  | "assistant"
  | "content"
  | "sms_suggest"
  | "expense_classify"
  | "invoice_extract"
  | "image";

export type AiConfigErrorCode =
  | "MISSING_API_KEY"
  | "MISSING_MODEL"
  | "INVALID_MODEL";

export type EnvSource = Record<string, string | undefined>;

/** Environment variable consulted for each feature, most specific first. */
const MODEL_ENV_CHAIN: Record<AiFeature, readonly string[]> = {
  assistant: ["OPENAI_ASSISTANT_MODEL", "OPENAI_MODEL"],
  content: ["OPENAI_CONTENT_MODEL", "OPENAI_MODEL"],
  sms_suggest: ["OPENAI_SMS_MODEL", "OPENAI_MODEL"],
  expense_classify: ["OPENAI_EXPENSE_MODEL", "OPENAI_MODEL"],
  invoice_extract: ["OPENAI_INVOICE_MODEL", "OPENAI_MODEL"],
  image: ["OPENAI_IMAGE_MODEL"],
};

const FEATURE_LABEL: Record<AiFeature, string> = {
  assistant: "دستیار فروش",
  content: "استودیو محتوا",
  sms_suggest: "پیشنهاد پیامک",
  expense_classify: "دسته‌بندی هزینه",
  invoice_extract: "خواندن فاکتور",
  image: "تولید تصویر",
};

/**
 * A model id must be a single opaque token. Rejecting whitespace and secret
 * prefixes stops an API key pasted into the wrong variable from being sent as
 * a model name (and echoed back inside a provider error).
 */
export function isValidModelId(value: string) {
  if (!value || value.length > 100) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) return false;
  if (/^sk-/i.test(value)) return false;
  return true;
}

export class AiConfigError extends Error {
  readonly code: AiConfigErrorCode;
  /** Safe to render in the UI: Persian, no secrets, no provider text. */
  readonly userMessage: string;

  constructor(
    code: AiConfigErrorCode,
    message: string,
    userMessage: string,
  ) {
    super(message);
    this.name = "AiConfigError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function resolveOpenAiKey(env: EnvSource = process.env) {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new AiConfigError(
      "MISSING_API_KEY",
      "OPENAI_API_KEY is not configured",
      "سرویس هوش مصنوعی پیکربندی نشده است. مدیر سیستم باید مقدار OPENAI_API_KEY را در تنظیمات سرور ثبت کند.",
    );
  }
  return key;
}

/**
 * Resolve the model id for a feature. Throws AiConfigError when the required
 * variable is absent or malformed — never falls back to a guessed model name.
 */
export function resolveModel(
  feature: AiFeature,
  env: EnvSource = process.env,
) {
  const chain = MODEL_ENV_CHAIN[feature];
  const label = FEATURE_LABEL[feature];

  for (const name of chain) {
    const raw = env[name]?.trim();
    if (!raw) continue;

    if (!isValidModelId(raw)) {
      throw new AiConfigError(
        "INVALID_MODEL",
        `Environment variable ${name} holds a malformed model id`,
        `مقدار تنظیم‌شده برای مدل «${label}» معتبر نیست. مدیر سیستم باید مقدار ${name} را اصلاح کند.`,
      );
    }
    return raw;
  }

  throw new AiConfigError(
    "MISSING_MODEL",
    `No model configured for ${feature}; set one of ${chain.join(", ")}`,
    `مدل «${label}» تنظیم نشده است. مدیر سیستم باید مقدار ${chain[0]} یا ${chain[chain.length - 1]} را در تنظیمات سرور ثبت کند.`,
  );
}

/**
 * `gpt-image-1` is a real, published OpenAI image model and is documented in
 * the README as this project's default. It is the only model id with a
 * built-in value; every text model must be configured explicitly.
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export function resolveImageModel(env: EnvSource = process.env) {
  const raw = env.OPENAI_IMAGE_MODEL?.trim();
  if (!raw) return DEFAULT_IMAGE_MODEL;
  if (!isValidModelId(raw)) {
    throw new AiConfigError(
      "INVALID_MODEL",
      "Environment variable OPENAI_IMAGE_MODEL holds a malformed model id",
      "مقدار تنظیم‌شده برای مدل «تولید تصویر» معتبر نیست. مدیر سیستم باید مقدار OPENAI_IMAGE_MODEL را اصلاح کند.",
    );
  }
  return raw;
}

export function resolveAiConfig(
  feature: AiFeature,
  env: EnvSource = process.env,
) {
  return { apiKey: resolveOpenAiKey(env), model: resolveModel(feature, env) };
}

/** HTTP status for a configuration failure: always "server not ready". */
export function aiConfigErrorStatus(_error: AiConfigError) {
  return 503;
}

/**
 * Map a provider HTTP failure onto a safe Persian message. The provider's own
 * text is deliberately discarded so keys, prompts and internal identifiers
 * cannot leak into the UI.
 */
export function providerErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "دسترسی به سرویس هوش مصنوعی تأیید نشد. مدیر سیستم باید کلید سرویس را بررسی کند.";
  }
  if (status === 429) {
    return "سرویس هوش مصنوعی در حال حاضر ظرفیت پاسخ‌گویی ندارد. کمی بعد دوباره تلاش کن.";
  }
  if (status === 400 || status === 404 || status === 422) {
    return "درخواست برای سرویس هوش مصنوعی قابل پردازش نبود. اگر تکرار شد، تنظیمات مدل را به مدیر سیستم اطلاع بده.";
  }
  if (status >= 500) {
    return "سرویس هوش مصنوعی موقتاً در دسترس نیست. کمی بعد دوباره تلاش کن.";
  }
  return "ارتباط با سرویس هوش مصنوعی انجام نشد.";
}

/**
 * Redact anything secret-shaped before a provider failure reaches a log.
 */
export function redactForLog(value: unknown) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .slice(0, 300);
}
