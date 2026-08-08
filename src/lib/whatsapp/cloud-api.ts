export type WhatsAppMessageType = "text" | "image" | "template";

export type WhatsAppCloudConfig = {
  token: string;
  phoneNumberId: string;
  businessAccountId: string;
  graphApiVersion: string;
};

export type WhatsAppProviderResult = {
  messageId: string;
  accepted: true;
};

export type WhatsAppTemplate = {
  id: string;
  name: string;
  status: string;
  language: string;
  category: string;
  components: unknown[];
  variableCount: number;
};

export class WhatsAppCloudError extends Error {
  constructor(
    message: string,
    readonly providerCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "WhatsAppCloudError";
  }
}

export function isAmbiguousWhatsAppProviderError(error: unknown) {
  if (!(error instanceof WhatsAppCloudError)) return true;
  return !error.httpStatus || error.httpStatus >= 500;
}

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeIranianMobile(value: string) {
  let digits = value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[^0-9+]/g, "");

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0098")) digits = digits.slice(2);
  if (digits.startsWith("09")) digits = `98${digits.slice(1)}`;
  if (!/^989[0-9]{9}$/.test(digits)) return null;
  return digits;
}

export function loadWhatsAppCloudConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppCloudConfig | null {
  const token = env.WHATSAPP_CLOUD_API_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const businessAccountId = env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const graphApiVersion = env.WHATSAPP_GRAPH_API_VERSION?.trim();
  if (!token || !phoneNumberId || !businessAccountId || !graphApiVersion) {
    return null;
  }
  if (!/^v[0-9]+(?:\.[0-9]+)?$/.test(graphApiVersion)) return null;
  return { token, phoneNumberId, businessAccountId, graphApiVersion };
}

export function buildTextPayload(to: string, text: string) {
  const normalized = normalizeIranianMobile(to);
  const body = text.trim();
  if (!normalized || !body || body.length > 4096) {
    throw new WhatsAppCloudError("شماره یا متن پیام معتبر نیست.");
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalized,
    type: "text",
    text: { preview_url: false, body },
  } as const;
}

export function buildImagePayload(to: string, imageUrl: string, caption?: string) {
  const normalized = normalizeIranianMobile(to);
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new WhatsAppCloudError("نشانی تصویر معتبر نیست.");
  }
  if (!normalized || url.protocol !== "https:") {
    throw new WhatsAppCloudError("شماره یا نشانی امن تصویر معتبر نیست.");
  }
  const cleanCaption = caption?.trim();
  if (cleanCaption && cleanCaption.length > 1024) {
    throw new WhatsAppCloudError("متن همراه تصویر بیش از حد طولانی است.");
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalized,
    type: "image",
    image: {
      link: url.toString(),
      ...(cleanCaption ? { caption: cleanCaption } : {}),
    },
  } as const;
}

export function validateTemplateName(value: string) {
  return /^[a-z0-9_]{1,512}$/.test(value);
}

export function buildTemplatePayload(
  to: string,
  templateName: string,
  variables: string[],
  languageCode = "fa",
) {
  const normalized = normalizeIranianMobile(to);
  const name = templateName.trim();
  if (
    !normalized ||
    !validateTemplateName(name) ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)
  ) {
    throw new WhatsAppCloudError("شماره یا نام Template معتبر نیست.");
  }
  if (
    variables.length > 20 ||
    variables.some((value) => !value.trim() || value.trim().length > 1024)
  ) {
    throw new WhatsAppCloudError("متغیرهای Template معتبر نیستند.");
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalized,
    type: "template",
    template: {
      name,
      language: { code: languageCode },
      ...(variables.length
        ? {
            components: [
              {
                type: "body",
                parameters: variables.map((value) => ({
                  type: "text",
                  text: value.trim(),
                })),
              },
            ],
          }
        : {}),
    },
  } as const;
}

export function parseWhatsAppProviderResponse(value: unknown): WhatsAppProviderResult {
  if (!value || typeof value !== "object") {
    throw new WhatsAppCloudError("پاسخ سرویس واتساپ معتبر نیست.");
  }
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages[0] || typeof messages[0] !== "object") {
    throw new WhatsAppCloudError("شناسه پیام از سرویس واتساپ دریافت نشد.");
  }
  const messageId = (messages[0] as { id?: unknown }).id;
  if (typeof messageId !== "string" || !messageId.startsWith("wamid.")) {
    throw new WhatsAppCloudError("شناسه پیام واتساپ معتبر نیست.");
  }
  return { messageId, accepted: true };
}

function parseProviderError(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return {};
  const providerCode = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return {
    providerCode:
      typeof providerCode === "number" || typeof providerCode === "string"
        ? String(providerCode)
        : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function countTemplateVariables(components: unknown[]) {
  const matches = JSON.stringify(components).match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return new Set(matches.map((match) => match.replace(/\s/g, ""))).size;
}

export function parseWhatsAppTemplates(value: unknown): WhatsAppTemplate[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    throw new WhatsAppCloudError("پاسخ فهرست Templateهای Meta معتبر نیست.");
  }
  return ((value as { data: unknown[] }).data)
    .map((item): WhatsAppTemplate | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const components = Array.isArray(row.components) ? row.components : [];
      if (
        typeof row.id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.status !== "string" ||
        typeof row.language !== "string" ||
        typeof row.category !== "string" ||
        !validateTemplateName(row.name)
      ) {
        return null;
      }
      return {
        id: row.id.slice(0, 512),
        name: row.name,
        status: row.status.slice(0, 64).toUpperCase(),
        language: row.language.slice(0, 32),
        category: row.category.slice(0, 64).toUpperCase(),
        components,
        variableCount: Math.min(20, countTemplateVariables(components)),
      };
    })
    .filter((item): item is WhatsAppTemplate => item !== null);
}

export async function fetchWhatsAppTemplates(input: {
  config: WhatsAppCloudConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const templates: WhatsAppTemplate[] = [];
  let after: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(
      `https://graph.facebook.com/${encodeURIComponent(input.config.graphApiVersion)}/${encodeURIComponent(input.config.businessAccountId)}/message_templates`,
    );
    url.searchParams.set("fields", "id,name,status,language,category,components");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${input.config.token}` },
        signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
        cache: "no-store",
      });
    } catch {
      throw new WhatsAppCloudError("ارتباط با فهرست Templateهای Meta برقرار نشد.");
    }
    const data = (await response.json().catch(() => ({}))) as {
      data?: unknown[];
      paging?: { cursors?: { after?: unknown }; next?: unknown };
    };
    if (!response.ok) {
      const parsed = parseProviderError(data);
      throw new WhatsAppCloudError(
        "همگام‌سازی Templateهای Meta انجام نشد.",
        parsed.providerCode,
        response.status,
      );
    }
    templates.push(...parseWhatsAppTemplates(data));
    const nextAfter = data.paging?.cursors?.after;
    if (!data.paging?.next || typeof nextAfter !== "string" || !nextAfter) break;
    after = nextAfter.slice(0, 2000);
  }
  return templates;
}

export async function sendWhatsAppMessage(input: {
  config: WhatsAppCloudConfig;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const { config } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.payload),
        signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
        cache: "no-store",
      },
    );
  } catch {
    throw new WhatsAppCloudError("ارتباط با سرویس واتساپ برقرار نشد.");
  }

  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const parsed = parseProviderError(data);
    throw new WhatsAppCloudError(
      parsed.message ? "سرویس واتساپ پیام را نپذیرفت." : "ارسال واتساپ ناموفق بود.",
      parsed.providerCode,
      response.status,
    );
  }
  return parseWhatsAppProviderResponse(data);
}
