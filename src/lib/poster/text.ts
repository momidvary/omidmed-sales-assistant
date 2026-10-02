// Writes the short Persian copy that goes on a product poster. The image
// itself is never sent to or changed by the model; the poster is composed in
// the browser from the original photo.

export type PosterText = {
  headline: string;
  subheadline: string;
  bullets: string[];
  cta: string;
  caption: string;
};

export class PosterTextError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "PROVIDER" | "INVALID_OUTPUT",
    message: string,
  ) {
    super(message);
    this.name = "PosterTextError";
  }
}

export const MAX_DESCRIPTION_LENGTH = 1500;

const LIMITS = { headline: 40, subheadline: 80, bullet: 40, cta: 30, caption: 900 };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "subheadline", "bullets", "cta", "caption"],
  properties: {
    headline: { type: "string" },
    subheadline: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    caption: { type: "string" },
  },
};

const instructions = `تو کپی‌رایتر فروش برند «امیدمِد» هستی؛ تأمین‌کننده تخصصی پد، ملحفه، کیف و لوازم مصرفی فیزیوتراپی و کلینیک. مشتری‌ها فیزیوتراپیست‌ها، کلینیک‌ها و مطب‌ها هستند.
از روی توضیحات کاربر درباره یک عکس محصول، متن کوتاه فارسی برای پوستر استاتوس واتساپ و اینستاگرام بنویس.

قبل از نوشتن، اگر ابزار جست‌وجوی وب در دسترس است، درباره این نوع محصول جست‌وجو کن تا بفهمی خریداران معمولاً به چه چیزی اهمیت می‌دهند (مثل بهداشت، دوام، راحتی بیمار، صرفه‌جویی در زمان و هزینه، ظاهر حرفه‌ای کلینیک) و چه دغدغه‌ای دارند. از این نکته‌ها فقط برای انتخاب زاویه فروش استفاده کن، نه برای ساختن مشخصات.

- headline: تیتر کوتاه و جذاب، حداکثر ۵ کلمه؛ نام یا دسته محصول را روشن نشان بده.
- subheadline: مهم‌ترین بخش؛ یک جمله دقیق و کوتاه (حداکثر ۱۰ کلمه) که اصلی‌ترین «فایده برای خریدار» را می‌گوید، نه یک توصیف کلی. فایده‌ای را انتخاب کن که به دغدغه واقعی خریدار جواب می‌دهد. از کلمات کلی و تکراری مثل «بهترین»، «باکیفیت» و «عالی» بدون پشتوانه پرهیز کن.
- bullets: صفر تا سه ویژگی خیلی کوتاه (هرکدام حداکثر ۴ کلمه)، هرکدام یک دلیل مشخص برای خرید.
- cta: فراخوان اقدام کوتاه و مشخص، مثل «سفارش از طریق واتساپ».
- caption: کپشن اینستاگرام در دو تا چهار خط که با همان فایده اصلی شروع می‌شود، به‌همراه چند هشتگ فارسی مرتبط.

قیمت، تخفیف، ابعاد، جنس، تعداد، گارانتی، فوریت یا هر ادعای مشخصی درباره همین محصول را که در توضیحات کاربر نیامده هرگز از خودت یا از نتایج جست‌وجو نساز. اگر کاربر قیمت یا تخفیف داده، دقیقاً همان را بنویس.
فقط فارسی روان و محترمانه بنویس؛ بدون ایموجی، بدون لینک و بدون ارجاع به منبع.`;

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

function outputText(data: ResponsesPayload) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => (item.type === "message" ? item.content ?? [] : []))
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n");
}

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizePosterText(value: unknown): PosterText | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const headline = clip(raw.headline, LIMITS.headline);
  if (!headline) return null;
  return {
    headline,
    subheadline: clip(raw.subheadline, LIMITS.subheadline),
    bullets: (Array.isArray(raw.bullets) ? raw.bullets : [])
      .map((item) => clip(item, LIMITS.bullet))
      .filter(Boolean)
      .slice(0, 3),
    cta: clip(raw.cta, LIMITS.cta),
    caption: String(raw.caption ?? "").trim().slice(0, LIMITS.caption),
  };
}

export async function generatePosterText({
  apiKey,
  model,
  description,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  description: string;
  fetchImpl?: typeof fetch;
}): Promise<PosterText> {
  const brief = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (!apiKey || !model || !brief) {
    throw new PosterTextError("INVALID_INPUT", "توضیحات محصول یا تنظیمات هوش مصنوعی کامل نیست.");
  }

  const request = (withSearch: boolean) =>
    fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions,
        input: brief,
        ...(withSearch ? { tools: [{ type: "web_search" }], tool_choice: "auto" } : {}),
        text: {
          format: { type: "json_schema", name: "omidmed_poster_text", strict: true, schema },
        },
        max_output_tokens: 4000,
        store: false,
      }),
      signal: AbortSignal.timeout(withSearch ? 35_000 : 20_000),
      cache: "no-store",
    });

  // Not every configured model supports web search, and a search can be slow.
  // A rejected or timed-out search request is retried once as plain
  // generation rather than failing the poster.
  let response: Response | null = null;
  try {
    response = await request(true);
  } catch {
    response = null;
  }
  if (!response || response.status === 400) {
    try {
      response = await request(false);
    } catch {
      throw new PosterTextError("PROVIDER", "ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کن.");
    }
  }

  if (!response.ok) {
    // The provider's own error text is discarded on purpose: it can carry
    // organisation ids or key fragments.
    throw new PosterTextError("PROVIDER", `سرویس هوش مصنوعی پاسخ نداد (کد ${response.status}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText((await response.json()) as ResponsesPayload));
  } catch {
    throw new PosterTextError("INVALID_OUTPUT", "پاسخ هوش مصنوعی قابل خواندن نبود. دوباره تلاش کن.");
  }

  const text = normalizePosterText(parsed);
  if (!text) {
    throw new PosterTextError("INVALID_OUTPUT", "هوش مصنوعی متن قابل‌استفاده‌ای برنگرداند. دوباره تلاش کن.");
  }
  return text;
}
