// Melipayamak service-line patterns ("ارسال با الگو"). Pattern messages go out
// on the shared service line, which reaches numbers that have blocked
// promotional SMS. Each pattern's text is approved once in the Melipayamak
// panel; the app only sends its bodyId and the variable values.
//
// The texts below are what the user submits for approval. If Melipayamak
// approves a slightly different wording, only the in-app preview differs:
// the message actually delivered is always the approved one.

export type PatternKey = "order" | "payment" | "production" | "shipped" | "followup";

/** Where the profile page pre-fills a variable from. */
export type PatternFill = "name" | "title" | "lastName" | "invoice" | "amount" | "items" | "contact";

export type PatternVariable = {
  key: string;
  label: string;
  maxLength: number;
  placeholder?: string;
  /** Fixed choices, shown as a select. */
  options?: string[];
  fill?: PatternFill;
};

export type PatternDefinition = {
  key: PatternKey;
  button: string;
  description: string;
  envVar: string;
  /** bodyId to use when envVar is not set (a pattern already approved). */
  defaultBodyId?: number;
  source: "accounting" | "customer";
  /** Approved text; {0}, {1}, ... are filled from `variables` in order. */
  text: string;
  variables: PatternVariable[];
};

// Written to Melipayamak's service-line rules: no promotional wording, no
// payment links or amounts, each sentence ends with a verb, and the website
// closes the message.
export const SMS_PATTERNS: PatternDefinition[] = [
  {
    // Approved earlier in the panel (code 428045); works without setup.
    key: "order",
    button: "ثبت سفارش",
    description: "تأیید ثبت سفارش با شماره، اقلام و مبلغ فاکتور.",
    envVar: "MELIPAYAMAK_PATTERN_ORDER",
    defaultBodyId: 428045,
    source: "customer",
    text:
      "مشتری گرامی {0} ({1})، سفارش شما با شماره {2} ثبت شد و هم‌اکنون در حال پردازش است. اقلام سفارش {3} بوده و مبلغ {4} تومان می‌باشد. با تشکر از اعتماد شما.\nomidmed.com",
    variables: [
      { key: "title", label: "آقا / خانم", maxLength: 10, options: ["آقا", "خانم"], fill: "title" },
      { key: "lastName", label: "نام خانوادگی", maxLength: 30, fill: "lastName" },
      { key: "invoice", label: "شماره سفارش (فاکتور)", maxLength: 20, fill: "invoice" },
      { key: "items", label: "اقلام سفارش", maxLength: 80, fill: "items" },
      { key: "amount", label: "مبلغ (تومان)", maxLength: 20, fill: "amount" },
    ],
  },
  {
    key: "payment",
    button: "صدور فاکتور / تسویه",
    description: "فاکتور صادر شده؛ بعد از تسویه سفارش به تولید می‌رود.",
    envVar: "MELIPAYAMAK_PATTERN_PAYMENT",
    source: "accounting",
    text:
      "{0} گرامی، فاکتور شماره {1} برای سفارش شما صادر شد و پس از تسویه به مرحله تولید ارسال می‌شود.\nomidmed.com",
    variables: [
      { key: "name", label: "نام مشتری", maxLength: 40, fill: "name" },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20, fill: "invoice" },
    ],
  },
  {
    key: "production",
    button: "شروع تولید",
    description: "تسویه انجام شد و سفارش وارد تولید شد.",
    envVar: "MELIPAYAMAK_PATTERN_PRODUCTION",
    source: "customer",
    text:
      "{0} گرامی، سفارش شما با فاکتور شماره {1} وارد مرحله تولید شد.\nomidmed.com",
    variables: [
      { key: "name", label: "نام مشتری", maxLength: 40, fill: "name" },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20, fill: "invoice" },
    ],
  },
  {
    key: "shipped",
    button: "ارسال کالا",
    description: "سفارش ارسال شد؛ همراه با روش ارسال یا کد رهگیری.",
    envVar: "MELIPAYAMAK_PATTERN_SHIPPED",
    source: "customer",
    text:
      "{0} گرامی، سفارش شما با فاکتور شماره {1} از طریق {2} ارسال شد.\nomidmed.com",
    variables: [
      { key: "name", label: "نام مشتری", maxLength: 40, fill: "name" },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20, fill: "invoice" },
      { key: "tracking", label: "روش ارسال و کد رهگیری", maxLength: 40, placeholder: "مثلاً پست پیشتاز با کد ۱۲۳۴۵۶" },
    ],
  },
  {
    key: "followup",
    button: "یادآوری سفارش مجدد",
    description: "یادآوری به مشتری که موعد سفارش بعدی‌اش رسیده.",
    envVar: "MELIPAYAMAK_PATTERN_FOLLOWUP",
    source: "customer",
    text:
      "{0} گرامی، موعد سفارش مجدد لوازم مصرفی شما فرا رسیده است. برای ثبت سفارش با شماره {1} تماس بگیرید.\nomidmed.com",
    variables: [
      { key: "name", label: "نام مشتری", maxLength: 40, fill: "name" },
      { key: "contact", label: "شماره تماس شرکت", maxLength: 20, fill: "contact" },
    ],
  },
];

export function patternBodyId(
  pattern: PatternDefinition,
  env: Record<string, string | undefined> = process.env,
) {
  const value = env[pattern.envVar]?.trim() ?? "";
  if (/^\d{1,12}$/.test(value)) return Number(value);
  return value ? null : pattern.defaultBodyId ?? null;
}

/** Patterns that have an approved bodyId configured on the server. */
export function configuredPatterns(env: Record<string, string | undefined> = process.env) {
  return SMS_PATTERNS.filter((pattern) => patternBodyId(pattern, env) !== null);
}

export function fillPatternText(pattern: PatternDefinition, args: string[]) {
  return pattern.text.replace(/\{(\d+)\}/g, (_, index: string) => args[Number(index)] ?? "");
}

/** Clean, ordered argument list, or an error message for the user. */
export function patternArgs(
  pattern: PatternDefinition,
  values: Record<string, unknown>,
): { args: string[] } | { error: string } {
  const args: string[] = [];
  for (const variable of pattern.variables) {
    const value = String(values[variable.key] ?? "").replace(/\s+/g, " ").trim();
    if (!value) return { error: `«${variable.label}» را وارد کنید.` };
    if (value.length > variable.maxLength) {
      return { error: `«${variable.label}» حداکثر ${variable.maxLength} کاراکتر می‌تواند باشد.` };
    }
    if (/https?:|www\./i.test(value)) {
      return { error: "در متغیرهای الگو لینک مجاز نیست." };
    }
    args.push(value);
  }
  return { args };
}

/** Short "item ×qty، ..." list that fits a pattern variable. */
export function patternItemsSummary(
  items: Array<{ product_name: string | null; quantity: number | string | null }>,
  maxLength = 80,
) {
  const number = new Intl.NumberFormat("fa-IR");
  const parts = items
    .filter((item) => String(item.product_name ?? "").trim())
    .map((item) => {
      const quantity = Number(item.quantity ?? 0);
      const name = String(item.product_name).replace(/\s+/g, " ").trim();
      return quantity > 0 ? `${name} ${number.format(quantity)} عدد` : name;
    });
  let summary = "";
  for (const [index, part] of parts.entries()) {
    const next = summary ? `${summary}، ${part}` : part;
    const rest = parts.length - index - 1;
    const suffix = rest > 0 ? ` و ${number.format(rest)} قلم دیگر` : "";
    if ((next + suffix).length > maxLength) {
      const remaining = parts.length - index;
      return summary
        ? `${summary} و ${number.format(remaining)} قلم دیگر`
        : `${part.slice(0, maxLength - 3)}…`;
    }
    summary = next;
  }
  return summary;
}
