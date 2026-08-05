type ProviderJson = Record<string, unknown>;

function statusText(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function classifyDelivery(label: string, code: string | null) {
  const compact = label.replace(/\s+/g, "");

  if (
    /ارسالنشده|تحویلنشده|نرسیده|ناموفق|ردشده|مسدود|بلک.?لیست/.test(
      compact,
    )
  ) {
    return "undelivered" as const;
  }

  if (/ارسالشده|تحویلشده|رسیده/.test(compact)) {
    return "delivered" as const;
  }

  if (code === "-1") {
    return "delivered" as const;
  }

  if (code === "200") {
    return "undelivered" as const;
  }

  if (/خطا|نامشخص|یافتنشد|گزارش/.test(compact)) {
    return "unknown" as const;
  }

  return "accepted" as const;
}

export function parseMeliPayamakDeliveryResults(
  recIds: string[],
  json: ProviderJson,
) {
  const labels = Array.isArray(json.results) ? json.results : [];
  const codes = Array.isArray(json.resultsAsCode)
    ? json.resultsAsCode
    : [];
  const resultCount = Math.min(
    recIds.length,
    Math.max(labels.length, codes.length),
  );

  return recIds.slice(0, resultCount).map((recId, index) => {
    const label = statusText(labels[index]);
    const code = codes[index] == null ? null : String(codes[index]);
    const displayLabel =
      label ||
      (code
        ? `وضعیت تحویل با کد ${code}`
        : "وضعیت تحویل هنوز مشخص نشده است.");

    return {
      recId,
      label: displayLabel,
      code,
      deliveryStatus: classifyDelivery(displayLabel, code),
    };
  });
}

export async function checkMeliPayamakDelivery(recIds: string[]) {
  const token = process.env.MELIPAYAMAK_API_TOKEN?.trim();

  if (!token) {
    throw new Error("توکن ملی پیامک در Environment Variables تنظیم نشده است.");
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

    return parseMeliPayamakDeliveryResults(uniqueRecIds, json);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("بررسی وضعیت ملی پیامک بیش از ۳۰ ثانیه طول کشید.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
