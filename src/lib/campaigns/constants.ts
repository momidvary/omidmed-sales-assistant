export const campaignTypeLabels: Record<string, string> = {
  reactivation: "بازگشت مشتریان غیرفعال",
  product: "فروش محصول مشخص",
  price_followup: "پیگیری قیمت‌های بدون سفارش",
  seasonal: "کمپین مناسبتی",
  custom: "کمپین سفارشی",
};

export const campaignChannelLabels: Record<string, string> = {
  phone: "تماس تلفنی",
  sms: "پیامک",
  whatsapp: "واتساپ",
  mixed: "ترکیبی",
};

export const campaignStatusLabels: Record<string, string> = {
  draft: "پیش‌نویس",
  active: "فعال",
  completed: "تکمیل‌شده",
  archived: "بایگانی",
};

export const memberStatusLabels: Record<string, string> = {
  pending: "اقدام نشده",
  contacted: "پیام یا تماس انجام شد",
  requested_price: "قیمت خواست",
  ordered: "سفارش داد",
  no_answer: "پاسخ نداد",
  no_need: "فعلاً نیاز ندارد",
  follow_up: "نیازمند پیگیری",
  lost: "از دست رفت",
};

export const priorityLabels: Record<string, string> = {
  all: "همه اولویت‌ها",
  urgent: "ویژه و زیاد",
  vip: "فقط ویژه",
  high: "فقط اولویت زیاد",
  normal: "فقط اولویت متوسط",
  low: "فقط اولویت کم",
};

export const lostReasonLabels: Record<string, string> = {
  price: "قیمت بالا بود",
  shipping: "هزینه یا شرایط ارسال",
  timing: "زمان خرید مناسب نبود",
  competitor: "از رقیب خرید کرد",
  quality: "نگرانی درباره کیفیت",
  stock_available: "هنوز موجودی دارد",
  no_answer: "پاسخ نداد",
  other: "سایر",
};

export const opportunityStageLabels: Record<string, string> = {
  quote_sent: "قیمت ارسال شده",
  followup_1: "پیگیری اول",
  followup_2: "پیگیری دوم",
  final_followup: "پیگیری نهایی",
};

export const opportunityStatusLabels: Record<string, string> = {
  open: "باز",
  on_hold: "تعلیق موقت",
  won: "تبدیل به سفارش",
  lost: "از دست رفته",
};

export function normalizePhoneForLink(phone: string | null | undefined) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("98")) return `+${digits}`;
  if (digits.startsWith("0")) return `+98${digits.slice(1)}`;
  return digits;
}

export function addTehranDaysAtTen(days: number, now = new Date()) {
  const target = new Date(now.getTime() + days * 86_400_000);
  const key = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(target);
  return `${key}T10:00:00+03:30`;
}

export function nextOpportunityStep(stage: string) {
  if (stage === "quote_sent") {
    return { stage: "followup_1", nextFollowupAt: addTehranDaysAtTen(2) };
  }
  if (stage === "followup_1") {
    return { stage: "followup_2", nextFollowupAt: addTehranDaysAtTen(4) };
  }
  return { stage: "final_followup", nextFollowupAt: addTehranDaysAtTen(7) };
}
