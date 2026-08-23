import { removeUnsupportedMedicalClaims } from "./quality";

export const WHATSAPP_CONTENT_TYPES = [
  "whatsapp_sales",
  "whatsapp_follow_up",
  "whatsapp_quote_follow_up",
  "product_intro",
  "price_follow_up",
  "repurchase",
  "special_offer",
  "short_educational",
  "status",
  "image_product_text",
  "personalized_customer",
  "template_draft",
] as const;

export type WhatsAppContentType = (typeof WHATSAPP_CONTENT_TYPES)[number];

export type WhatsAppGeneratedContent = {
  title: string;
  whatsapp_short_text: string;
  whatsapp_long_text: string;
  whatsapp_status_text: string;
  call_to_action: string;
  image_prompt: string;
  suggested_template_name: string;
  template_variables: string[];
  compliance_note: string;
};

export type InstagramGeneratedContent = {
  title: string;
  caption: string;
  on_image_text: string | null;
  call_to_action: string | null;
  hashtags: string[];
  image_prompt: string | null;
};

export const instagramOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "caption",
    "on_image_text",
    "call_to_action",
    "hashtags",
    "image_prompt",
  ],
  properties: {
    title: { type: "string" },
    caption: { type: "string" },
    on_image_text: { type: "string" },
    call_to_action: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    image_prompt: { type: "string" },
  },
} as const;

export const whatsappOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "whatsapp_short_text",
    "whatsapp_long_text",
    "whatsapp_status_text",
    "call_to_action",
    "image_prompt",
    "suggested_template_name",
    "template_variables",
    "compliance_note",
  ],
  properties: {
    title: { type: "string" },
    whatsapp_short_text: { type: "string" },
    whatsapp_long_text: { type: "string" },
    whatsapp_status_text: { type: "string" },
    call_to_action: { type: "string" },
    image_prompt: { type: "string" },
    suggested_template_name: { type: "string" },
    template_variables: { type: "array", items: { type: "string" } },
    compliance_note: { type: "string" },
  },
} as const;

const contentTypeLabels: Record<WhatsAppContentType, string> = {
  whatsapp_sales: "پیام فروش واتساپ",
  whatsapp_follow_up: "پیگیری واتساپ",
  whatsapp_quote_follow_up: "پیگیری پیش‌فاکتور واتساپ",
  product_intro: "معرفی محصول",
  price_follow_up: "پیگیری قیمت",
  repurchase: "یادآوری خرید مجدد",
  special_offer: "پیشنهاد ویژه",
  short_educational: "نکته آموزشی کوتاه",
  status: "استاتوس واتساپ",
  image_product_text: "متن روی تصویر محصول",
  personalized_customer: "پیام شخصی‌سازی‌شده مشتری",
  template_draft: "پیش‌نویس Template واتساپ",
};

function cleanString(value: unknown, field: string, max: number) {
  if (typeof value !== "string") {
    throw new Error(`فیلد ${field} در پاسخ مدل معتبر نیست.`);
  }
  const result = value.trim().slice(0, max);
  if (!result) throw new Error(`فیلد ${field} در پاسخ مدل خالی است.`);
  return result;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error("پاسخ مدل JSON معتبر نیست؛ دوباره تلاش کنید.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("ساختار پاسخ مدل معتبر نیست؛ دوباره تلاش کنید.");
  }
  return value as Record<string, unknown>;
}

function cleanInstagramSurfaceText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, max);
  if (!cleaned) return null;

  // On-image copy and CTAs are high-visibility surfaces and are persisted before
  // the product-aware guard in the page action runs. Keep them conservative at
  // parse time: unsupported medical, price and inventory claims are removed
  // even when the model ignores its prompt. Grounded claims may still appear in
  // the caption, which is validated later with the selected product context.
  return removeUnsupportedMedicalClaims(cleaned, null).text || null;
}

export function parseInstagramContent(raw: string): InstagramGeneratedContent {
  const value = parseJsonObject(raw);
  const hashtags = value.hashtags;
  if (!Array.isArray(hashtags) || hashtags.some((item) => typeof item !== "string")) {
    throw new Error("فهرست هشتگ‌های پاسخ مدل معتبر نیست.");
  }
  return {
    title: cleanString(value.title, "title", 180),
    caption: cleanString(value.caption, "caption", 8000),
    on_image_text: cleanInstagramSurfaceText(value.on_image_text, 500),
    call_to_action: cleanInstagramSurfaceText(value.call_to_action, 500),
    hashtags: hashtags.map((item) => item.trim()).filter(Boolean).slice(0, 15),
    image_prompt:
      typeof value.image_prompt === "string"
        ? value.image_prompt.trim().slice(0, 5000) || null
        : null,
  };
}

export function parseWhatsAppContent(raw: string): WhatsAppGeneratedContent {
  const value = parseJsonObject(raw);
  if (
    !Array.isArray(value.template_variables) ||
    value.template_variables.some((item) => typeof item !== "string")
  ) {
    throw new Error("فهرست متغیرهای Template در پاسخ مدل معتبر نیست.");
  }

  const parsed: WhatsAppGeneratedContent = {
    title: cleanString(value.title, "title", 180),
    whatsapp_short_text: cleanString(
      value.whatsapp_short_text,
      "whatsapp_short_text",
      1000,
    ),
    whatsapp_long_text: cleanString(
      value.whatsapp_long_text,
      "whatsapp_long_text",
      4000,
    ),
    whatsapp_status_text: cleanString(
      value.whatsapp_status_text,
      "whatsapp_status_text",
      700,
    ),
    call_to_action: cleanString(value.call_to_action, "call_to_action", 500),
    image_prompt: cleanString(value.image_prompt, "image_prompt", 5000),
    suggested_template_name: cleanString(
      value.suggested_template_name,
      "suggested_template_name",
      512,
    )
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "omidmed_content_draft",
    template_variables: value.template_variables
      .map((item) => item.trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 10),
    compliance_note: cleanString(value.compliance_note, "compliance_note", 1000),
  };

  if (parsed.whatsapp_status_text.length > parsed.whatsapp_long_text.length) {
    throw new Error("متن استاتوس باید از متن کامل کوتاه‌تر باشد.");
  }
  return parsed;
}

export function buildWhatsAppPrompt(input: {
  topic: string;
  productName?: string;
  objective: string;
  contentType: WhatsAppContentType;
  customerName?: string;
  clinicName?: string;
  city?: string;
  contactName?: string;
}) {
  const personalization = [
    input.customerName && `نام مشتری: ${input.customerName}`,
    input.clinicName && `نام کلینیک: ${input.clinicName}`,
    input.city && `شهر: ${input.city}`,
    input.contactName && `نام مخاطب: ${input.contactName}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `برای برند «امیدمِد» محتوای واتساپ فارسی B2B تولید کن.
نوع محتوا: ${contentTypeLabels[input.contentType]}
موضوع: ${input.topic}
محصول: ${input.productName || "محصولات مصرفی فیزیوتراپی"}
هدف: ${input.objective}
${personalization || "شخصی‌سازی: اطلاعات مشخصی ارائه نشده است."}

مخاطب فیزیوتراپیست یا مدیر کلینیک است. لحن طبیعی، حرفه‌ای، کوتاه و غیرتهاجمی باشد. از هشتگ غیرضروری، ادعای اثبات‌نشده پزشکی، قیمت، تخفیف، موجودی یا مشخصات ساخته‌شده استفاده نکن. هرگز ادعا نکن پیام ارسال یا سفارش ثبت شده است. متن استاتوس باید از متن کامل کوتاه‌تر باشد. image_prompt انگلیسی، بدون نوشته داخل تصویر و بدون لوگوی ساختگی باشد. suggested_template_name فقط حروف کوچک انگلیسی، عدد و underscore داشته باشد. Template پیشنهادی صرفاً پیش‌نویس است و تأیید Meta را تضمین نمی‌کند. تمام کلیدهای schema را پر کن.`;
}

export function buildInstagramPrompt(input: {
  topic: string;
  productName?: string;
  objective: string;
  formatLabel: string;
}) {
  return `برای برند «امیدمِد» یک محتوای اینستاگرام فارسی تولید کن.
مخاطب: فیزیوتراپیست و مدیر کلینیک فیزیوتراپی
موضوع: ${input.topic}
محصول: ${input.productName || "محصولات مصرفی فیزیوتراپی"}
هدف: ${input.objective}
قالب: ${input.formatLabel}

هویت برند: تأمین‌کننده تخصصی و اقتصادی لوازم مصرفی کلینیک با کیفیت مطمئن و قیمت منصفانه. ادعای پزشکی، قیمت یا مشخصات اختراع نکن. لحن حرفه‌ای و طبیعی و مناسب فروش B2B باشد. image_prompt انگلیسی، بدون نوشته داخل تصویر و بدون لوگوی ساختگی باشد.`;
}
