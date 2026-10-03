const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

function latinDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

export function normalizeIranMobile(value: string | null | undefined) {
  if (!value) return null;

  let digits = latinDigits(value).replace(/\D/g, "");

  if (digits.startsWith("0098")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("98")) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = `0${digits}`;
  }

  return /^09\d{9}$/.test(digits) ? digits : null;
}

export function normalizeSender(value: string | null | undefined) {
  const raw = latinDigits(String(value ?? "")).trim();

  if (raw.startsWith("+98") && raw.slice(3).startsWith("5000")) {
    return raw.slice(3);
  }

  if (raw.startsWith("98") && raw.slice(2).startsWith("5000")) {
    return raw.slice(2);
  }

  return raw.replace(/\s/g, "");
}

export function personalizeSmsTemplate(
  template: string,
  values: {
    name?: string | null;
    product?: string | null;
    city?: string | null;
    days?: number | string | null;
  },
) {
  const replacements: Array<[RegExp, string]> = [
    [
      /{{\s*(name|customer_name|clinic|نام|نام مشتری|نام کلینیک)\s*}}/gi,
      values.name || "مشتری گرامی",
    ],
    [/{\s*(name|نام)\s*}/gi, values.name || "مشتری گرامی"],
    [/\[\s*(نام|نام مشتری|نام کلینیک)\s*\]/gi, values.name || "مشتری گرامی"],
    [
      /{{\s*(product|محصول)\s*}}/gi,
      values.product || "محصولات امیدمِد",
    ],
    [/{{\s*(city|شهر)\s*}}/gi, values.city || ""],
    [
      /{{\s*(days|روز)\s*}}/gi,
      values.days == null ? "" : String(values.days),
    ],
  ];

  return replacements
    .reduce(
      (message, [pattern, replacement]) =>
        message.replace(pattern, replacement),
      template,
    )
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function ensureSingleSmsOptOut(value: string) {
  // The opt-out may already be present written with Persian (۱۱) or
  // Arabic-Indic (١١) digits — the natural way a Persian speaker or an AI
  // suggestion types it. Matching Latin digits alone left the original in
  // place and appended a second one, so the message shipped with two opt-out
  // instructions and burned an extra SMS segment.
  const withoutDuplicates = value
    .replace(/(?:\s*لغو\s*[1۱١][1۱١]\s*)+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${withoutDuplicates}\nلغو11`.trim();
}

type ProviderJson = Record<string, unknown>;

const MISSING_TOKEN_MESSAGE =
  "توکن ملی پیامک (MELIPAYAMAK_API_TOKEN) در تنظیمات Vercel تعریف نشده است.";

export function meliPayamakConfigError() {
  if (!process.env.MELIPAYAMAK_API_TOKEN?.trim()) return MISSING_TOKEN_MESSAGE;
  if (!normalizeSender(process.env.MELIPAYAMAK_SENDER)) {
    return "شماره خط فرستنده ملی پیامک (MELIPAYAMAK_SENDER) در تنظیمات Vercel تعریف نشده است.";
  }
  return null;
}

function isSuccessStatus(status: string) {
  return /موفق|success/i.test(status) && !/ناموفق|unsuccess|fail/i.test(status);
}

// Melipayamak's REST endpoints and plans name the id field differently
// (recIds, recId, RecIds, Value) and sometimes return a comma-separated string.
function collectRecIds(response: ProviderJson): unknown[] {
  for (const key of ["recIds", "RecIds", "recId", "RecId", "Value", "value"]) {
    const value = response[key];
    if (Array.isArray(value)) return value;
    if (value != null && String(value).trim() !== "") {
      return String(value).split(",").map((item) => item.trim());
    }
  }
  return [];
}

// Real Melipayamak recIds are long numbers; small values are the provider's
// numeric error codes (wrong credentials, insufficient credit, invalid
// sender, ...), and must never be recorded as a successful send.
function isRealRecId(value: string | null) {
  if (!value) return false;
  const numeric = Number(value);
  return !Number.isFinite(numeric) || numeric > 1000;
}

function providerBoolean(value: unknown) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  );
}

function providerStatus(json: ProviderJson, fallback = "") {
  const status = json.status;

  if (typeof status === "string") {
    return status.trim();
  }

  if (status == null) {
    return fallback;
  }

  return String(status);
}

async function postToProvider(
  path: "simple" | "multiple" | "shared",
  payload: unknown,
): Promise<ProviderJson> {
  const token = process.env.MELIPAYAMAK_API_TOKEN?.trim();

  if (!token) {
    // Nothing reached the provider, so this is a definite failure: marking it
    // ambiguous would block the recipient from ever being retried.
    throw new SmsProviderError(MISSING_TOKEN_MESSAGE, false);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(
      `https://console.melipayamak.com/api/send/${path}/${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let json: ProviderJson = {};

    try {
      json = raw ? (JSON.parse(raw) as ProviderJson) : {};
    } catch {
      json = { status: raw || `HTTP ${response.status}` };
    }

    if (!response.ok) {
      throw new SmsProviderError(
        providerStatus(
          json,
          `خطای ارتباط با ملی پیامک؛ کد HTTP ${response.status}`,
        ),
      );
    }

    return json;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SmsProviderError(
        "پاسخ ملی پیامک بیش از ۳۰ ثانیه طول کشید. دوباره تلاش کن.",
        true,
      );
    }
    if (error instanceof SmsProviderError) throw error;
    throw new SmsProviderError(
      "نتیجه ارتباط با ملی پیامک مشخص نشد؛ برای جلوگیری از پیام تکراری ارسال خودکار تکرار نشد.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMultipleSms(input: {
  sender: string;
  to: string[];
  text: string[];
}) {
  if (input.to.length !== input.text.length) {
    throw new Error("تعداد شماره‌ها و متن‌ها برابر نیست.");
  }

  if (!input.to.length || input.to.length > 100) {
    throw new Error(
      "هر درخواست چندگیرنده باید بین ۱ تا ۱۰۰ مخاطب داشته باشد.",
    );
  }

  const response = await postToProvider("multiple", {
    from: normalizeSender(input.sender),
    to: input.to,
    text: input.text,
    udh: "",
  });

  const recIds = collectRecIds(response);
  const successes = Array.isArray(response.success)
    ? response.success
    : [];
  const status = providerStatus(response);
  const statusSaysSuccess = isSuccessStatus(status);

  return input.to.map((to, index) => {
    const rawRecId =
      recIds[index] == null || recIds[index] === "" ? null : String(recIds[index]);
    const recId = isRealRecId(rawRecId) ? rawRecId : null;
    const flagged = successes.length === 0 || providerBoolean(successes[index]);

    // Normally success means a real recId. Some account plans answer with a
    // success status ("عملیات موفق") but no per-recipient ids; that is still
    // an accepted send, only without delivery tracking.
    const success =
      (Boolean(recId) && flagged) ||
      (!rawRecId && recIds.length === 0 && statusSaysSuccess && flagged);

    return {
      to,
      text: input.text[index],
      success,
      recId,
      status: success
        ? status
        : rawRecId && !recId
          ? `ملی پیامک ارسال را نپذیرفت؛ کد خطا ${rawRecId}`
          : status || "سرویس ملی پیامک، ارسال این گیرنده را نپذیرفت.",
    };
  });
}

/**
 * ارسال‌های تکی برنامه نیز عمداً از متد multiple استفاده می‌کنند؛
 * چون پلن فعال این پروژه متد «چند گیرنده با متن متفاوت» است و
 * پاسخ استاندارد آن شامل recIds و success است.
 */
export async function sendSimpleSms(input: {
  sender: string;
  to: string;
  text: string;
}) {
  const [result] = await sendMultipleSms({
    sender: input.sender,
    to: [input.to],
    text: [input.text],
  });

  return {
    success: result.success,
    recId: result.recId,
    status: result.status,
    raw: result,
  };
}

/**
 * Sends an approved service-line pattern (وبسرویس خدماتی اشتراکی). The
 * provider fills the approved text with `args` in order.
 */
type PanelCredentials = { username: string; password: string };

// The legacy panel web service authenticates with the panel username and the
// panel APIKey (Developers > Web service settings) instead of the console key.
// It does not depend on console settings, so it is preferred when configured.
function panelCredentials(env: Record<string, string | undefined> = process.env): PanelCredentials | null {
  const username = env.MELIPAYAMAK_USERNAME?.trim();
  const password = env.MELIPAYAMAK_PANEL_API_KEY?.trim();
  return username && password ? { username, password } : null;
}

export function patternSendingConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(panelCredentials(env) || env.MELIPAYAMAK_API_TOKEN?.trim());
}

async function sendPatternViaPanel(
  credentials: PanelCredentials,
  input: { bodyId: number; to: string; args: string[] },
) {
  const body = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
    to: input.to,
    bodyId: String(input.bodyId),
    // Arguments travel as one ";"-separated string, so a ";" inside a value
    // would shift every later variable.
    text: input.args.map((arg) => arg.replace(/;/g, "،")).join(";"),
  });

  let response: Response;
  try {
    response = await fetch("https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SmsProviderError(
      "نتیجه ارتباط با ملی پیامک مشخص نشد؛ برای جلوگیری از پیام تکراری ارسال خودکار تکرار نشد.",
      true,
    );
  }

  const raw = await response.text();
  let json: ProviderJson = {};
  try {
    json = raw ? (JSON.parse(raw) as ProviderJson) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    throw new SmsProviderError(`خطای ارتباط با وب‌سرویس پنل ملی پیامک؛ کد HTTP ${response.status}`);
  }

  const value = json.Value == null ? null : String(json.Value).trim();
  const statusText = String(json.StrRetStatus ?? "").trim();
  const recId = isRealRecId(value) ? value : null;
  const success = Number(json.RetStatus) === 1 && Boolean(recId);
  return {
    success,
    recId,
    status: success
      ? statusText
      : `ملی پیامک ارسال را نپذیرفت؛ کد خطا ${value ?? "نامشخص"}${statusText ? ` (${statusText})` : ""}`,
  };
}

export async function sendPatternSms(input: {
  bodyId: number;
  to: string;
  args: string[];
}) {
  const credentials = panelCredentials();
  if (credentials) return sendPatternViaPanel(credentials, input);

  const response = await postToProvider("shared", {
    bodyId: input.bodyId,
    to: input.to,
    args: input.args,
  });

  const [rawRecId = null] = collectRecIds(response).map((value) =>
    value == null || value === "" ? null : String(value),
  );
  const recId = isRealRecId(rawRecId) ? rawRecId : null;
  const status = providerStatus(response);
  const success = Boolean(recId) || (!rawRecId && isSuccessStatus(status));

  return {
    success,
    recId,
    status: success
      ? status
      : rawRecId && !recId
        ? `ملی پیامک ارسال را نپذیرفت؛ کد خطا ${rawRecId}`
        : status || "سرویس ملی پیامک، ارسال با الگو را نپذیرفت.",
  };
}
