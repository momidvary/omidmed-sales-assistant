const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

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

type ProviderJson = Record<string, unknown>;

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
  path: "simple" | "multiple",
  payload: unknown,
): Promise<ProviderJson> {
  const token = process.env.MELIPAYAMAK_API_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "توکن ملی پیامک در Environment Variables تنظیم نشده است.",
    );
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
      throw new Error(
        providerStatus(
          json,
          `خطای ارتباط با ملی پیامک؛ کد HTTP ${response.status}`,
        ),
      );
    }

    return json;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "پاسخ ملی پیامک بیش از ۳۰ ثانیه طول کشید. دوباره تلاش کن.",
      );
    }

    throw error;
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

  const recIds = Array.isArray(response.recIds)
    ? response.recIds
    : [];

  const successes = Array.isArray(response.success)
    ? response.success
    : [];

  const status = providerStatus(response);

  return input.to.map((to, index) => {
    const recId =
      recIds[index] == null ? null : String(recIds[index]);

    const success =
      providerBoolean(successes[index]) ||
      (successes.length === 0 && Boolean(recId));

    return {
      to,
      text: input.text[index],
      success,
      recId,
      status:
        status ||
        (success
          ? ""
          : "سرویس ملی پیامک، ارسال این گیرنده را نپذیرفت."),
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
