// Melipayamak service-line patterns ("ارسال با الگو"). Pattern messages go out
// on the shared service line, which reaches numbers that have blocked
// promotional SMS. Each pattern's text is approved once in the Melipayamak
// panel; the app only sends its bodyId and the variable values.
//
// The texts below are what the user submits for approval. If Melipayamak
// approves a slightly different wording, only the in-app preview differs:
// the message actually delivered is always the approved one.

export type PatternKey = "payment" | "production" | "shipped" | "followup";

export type PatternVariable = {
  key: string;
  label: string;
  maxLength: number;
  placeholder?: string;
};

export type PatternDefinition = {
  key: PatternKey;
  button: string;
  description: string;
  envVar: string;
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
    key: "payment",
    button: "صدور فاکتور / تسویه",
    description: "فاکتور صادر شده؛ بعد از تسویه سفارش به تولید می‌رود.",
    envVar: "MELIPAYAMAK_PATTERN_PAYMENT",
    source: "accounting",
    text:
      "{0} گرامی، فاکتور شماره {1} برای سفارش شما صادر شد و پس از تسویه به مرحله تولید ارسال می‌شود.\nomidmed.com",
    variables: [
      { key: "name", label: "نام مشتری", maxLength: 40 },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20 },
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
      { key: "name", label: "نام مشتری", maxLength: 40 },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20 },
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
      { key: "name", label: "نام مشتری", maxLength: 40 },
      { key: "invoice", label: "شماره فاکتور", maxLength: 20 },
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
      { key: "name", label: "نام مشتری", maxLength: 40 },
      { key: "contact", label: "شماره تماس شرکت", maxLength: 20 },
    ],
  },
];

export function patternBodyId(pattern: PatternDefinition, env = process.env) {
  const value = env[pattern.envVar]?.trim() ?? "";
  return /^\d{1,12}$/.test(value) ? Number(value) : null;
}

/** Patterns that have an approved bodyId configured on the server. */
export function configuredPatterns(env = process.env) {
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
