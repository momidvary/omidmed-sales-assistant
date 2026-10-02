type ProviderJson = Record<string, unknown>;

function statusText(value: unknown) {
  return value == null ? "" : String(value).trim();
}

// Melipayamak delivery codes: 1 reached the handset, 2 did not reach the
// handset, 16 did not reach the operator, 35 recipient is on the blacklist.
const DELIVERED_CODES = new Set(["1"]);
const UNDELIVERED_CODES = new Set(["2", "16", "35"]);

export function classifyDelivery(label: string, code: string | null = null) {
  if (code && DELIVERED_CODES.has(code)) return "delivered" as const;
  if (code && UNDELIVERED_CODES.has(code)) return "undelivered" as const;

  const compact = label.replace(/\s+/g, "");

  if (
    /ارسالنشده|تحویلنشده|نرسیده|ناموفق|ردشده|مسدود|بلک.?لیست|لیستسیاه/.test(
      compact,
    )
  ) {
    return "undelivered" as const;
  }

  if (/تحویلشده|بهگوشیرسیده|رسیدهبهگوشی/.test(compact)) {
    return "delivered" as const;
  }

  return "accepted" as const;
}

export async function checkMeliPayamakDelivery(recIds: string[]) {
  const token = process.env.MELIPAYAMAK_API_TOKEN?.trim();

  if (!token) {
    throw new Error("توکن ملی پیامک (MELIPAYAMAK_API_TOKEN) در تنظیمات Vercel تعریف نشده است.");
  }

  const uniqueRecIds = Array.from(
    new Set(recIds.map((value) => String(value).trim()).filter(Boolean)),
  );

  if (!uniqueRecIds.length || uniqueRecIds.length > 100) {
    throw new Error("برای هر بررسی تحویل باید بین ۱ تا ۱۰۰ شناسه ارسال شود.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(
      `https://console.melipayamak.com/api/receive/status/${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify({ recIds: uniqueRecIds }),
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
        statusText(json.status) ||
          `خطای بررسی تحویل ملی پیامک؛ کد HTTP ${response.status}`,
      );
    }

    const labels = Array.isArray(json.results) ? json.results : [];
    const codes = Array.isArray(json.resultsAsCode)
      ? json.resultsAsCode
      : [];
    const providerStatus = statusText(json.status);

    return uniqueRecIds.map((recId, index) => {
      const label = statusText(labels[index]) || providerStatus;
      const code = codes[index] == null ? null : String(codes[index]);

      return {
        recId,
        label: label || "وضعیت تحویل هنوز مشخص نشده است.",
        code,
        deliveryStatus: classifyDelivery(label, code),
      };
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("بررسی وضعیت ملی پیامک بیش از ۳۰ ثانیه طول کشید.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
