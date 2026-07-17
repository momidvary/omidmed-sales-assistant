import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import AppShell, { Icon } from "@/components/app-shell";
import SingleSmsComposer from "@/components/sms/single-sms-composer";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentJalaliDate,
  parseJalaliTehranDateTime,
} from "@/lib/jalali";

import CustomerFilesManager, {
  type CustomerFileRecord,
} from "./customer-files-manager";
import JalaliDateTimeField from "./jalali-date-time-field";
import styles from "./customer.module.css";

const numberFormatter = new Intl.NumberFormat("fa-IR");

type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  row_number: number | null;
  product_name: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  description: string | null;
};

type CustomerRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  preferred_products: string[] | null;
  status: string;
  priority: string;
  notes: string | null;
  next_followup_at: string | null;
  lead_stage: string | null;
  lead_source: string | null;
  potential_value: number | string | null;
  archived_at: string | null;
  last_purchase_at: string | null;
  purchase_count: number | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | string | null;
};

type FollowupRow = {
  id: string;
  followup_at: string;
  channel: string;
  outcome: string;
  notes: string | null;
  next_followup_at: string | null;
  potential_value: number | string | null;
};

type SmsRow = {
  id: string;
  message_text: string;
  request_success: boolean;
  delivery_status: string;
  provider_status: string | null;
  sent_at: string | null;
  created_at: string;
};

type OpportunityRow = {
  id: string;
  status: string;
  stage: string;
  source: string;
  product_interest: string | null;
  quoted_at: string;
  last_contact_at: string | null;
  next_followup_at: string | null;
  estimated_value: number | string | null;
  final_value: number | string | null;
  notes: string | null;
  created_at: string;
};

type ActivityItem = {
  id: string;
  type: "followup" | "sms" | "opportunity";
  date: string;
  title: string;
  detail: string | null;
  meta: string;
  success?: boolean;
};

type SmartRecommendation = {
  level: "urgent" | "important" | "normal";
  title: string;
  reason: string;
  channel: string;
  defaultMessage: string;
  nextStep: string;
};

const outcomeLabels: Record<string, string> = {
  no_answer: "پاسخ نداد",
  requested_price: "قیمت خواست",
  no_need: "فعلاً نیاز ندارد",
  order_placed: "سفارش ثبت شد",
  follow_up_later: "بعداً پیگیری شود",
  payment_pending: "پیگیری تسویه",
  lost: "مشتری از دست رفته",
  other: "سایر",
};

const channelLabels: Record<string, string> = {
  phone: "تماس تلفنی",
  sms: "پیامک",
  whatsapp: "واتساپ",
  in_person: "حضوری",
  other: "سایر",
};

const priorityLabels: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

const statusLabels: Record<string, string> = {
  active: "مشتری فعال",
  inactive: "مشتری غیرفعال",
  prospect: "مشتری بالقوه",
  lost: "از دست رفته",
};

const leadStageLabels: Record<string, string> = {
  new: "جدید",
  contacted: "تماس گرفته شد",
  interested: "علاقه‌مند",
  quoted: "قیمت ارسال شد",
  decision: "در حال تصمیم‌گیری",
  converted: "تبدیل به مشتری",
  lost: "از دست رفته",
};

const opportunityStageLabels: Record<string, string> = {
  quote_sent: "قیمت ارسال شده",
  followup_1: "پیگیری اول",
  followup_2: "پیگیری دوم",
  final_followup: "پیگیری نهایی",
};

const opportunityStatusLabels: Record<string, string> = {
  open: "باز",
  on_hold: "تعلیق موقت",
  won: "تبدیل به سفارش",
  lost: "از دست رفته",
};

const balanceLabels: Record<string, string> = {
  debtor: "بدهکار",
  creditor: "بستانکار",
  zero: "تسویه",
  unknown: "نامشخص",
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined) {
  return numberFormatter.format(Math.round(numeric(value)));
}

function formatQuantity(value: number | string | null | undefined) {
  const valueNumber = numeric(value);
  return numberFormatter.format(
    Number.isInteger(valueNumber)
      ? valueNumber
      : Number(valueNumber.toFixed(3)),
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function normalizePhoneForLink(phone: string | null) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("98")) return `+${digits}`;
  if (digits.startsWith("0")) return `+98${digits.slice(1)}`;
  return digits;
}

function isPast(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function buildRecommendation(input: {
  customer: CustomerRow;
  openOpportunity: OpportunityRow | null;
  debtAmount: number;
  topProduct: string | null;
}) {
  const { customer, openOpportunity, debtAmount, topProduct } = input;
  const customerName = customer.name || "مشتری گرامی";
  const daysSinceLastPurchase = numeric(
    customer.days_since_last_purchase,
  );
  const averageGap = numeric(customer.avg_purchase_gap_days);
  const nextFollowupIsDue = isPast(customer.next_followup_at);

  if (customer.archived_at) {
    return {
      level: "important",
      title: "ابتدا مشتری را از بایگانی خارج کن",
      reason:
        "پرونده بایگانی‌شده است و بهتر است قبل از تماس یا ثبت اقدام جدید بازیابی شود.",
      channel: "مدیریت پرونده",
      nextStep: "بازیابی مشتری و بررسی آخرین سابقه",
      defaultMessage: `${customerName} گرامی، وقت بخیر. برای پیگیری نیاز مجموعه شما به لوازم مصرفی فیزیوتراپی در خدمتتان هستیم. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  if (debtAmount > 0) {
    return {
      level: "urgent",
      title: "پیگیری مودبانه تسویه در اولویت است",
      reason: `در فاکتورهای ثبت‌شده، حدود ${formatMoney(
        debtAmount,
      )} تومان مانده بدهی دیده می‌شود.`,
      channel: "پیامک رسمی، سپس تماس",
      nextStep: "ارسال یادآوری تسویه و ثبت وعده پرداخت",
      defaultMessage: `${customerName} گرامی، مانده حساب مجموعه شما مبلغ ${formatMoney(
        debtAmount,
      )} تومان است. لطفاً در اولین فرصت نسبت به تسویه اقدام فرمایید. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  if (
    openOpportunity &&
    (isPast(openOpportunity.next_followup_at) ||
      openOpportunity.stage === "final_followup")
  ) {
    return {
      level: "urgent",
      title: "قیمت اعلام‌شده نیازمند پیگیری است",
      reason: `فرصت فروش ${
        openOpportunity.product_interest || "محصول موردنظر"
      } هنوز باز است و موعد پیگیری آن رسیده است.`,
      channel: "تماس کوتاه و پیامک شخصی",
      nextStep: "ثبت نتیجه قیمت: سفارش، تعویق یا عدم خرید",
      defaultMessage: `${customerName} گرامی، وقت بخیر. برای پیگیری قیمت ${
        openOpportunity.product_interest || "محصول موردنظر"
      } و بررسی نیاز فعلی مجموعه شما در خدمتتان هستیم. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  if (customer.status === "prospect") {
    if (
      customer.lead_stage === "quoted" ||
      customer.lead_stage === "decision"
    ) {
      return {
        level: "important",
        title: "سرنخ آماده پیگیری تصمیم خرید است",
        reason:
          "این مشتری بالقوه قبلاً قیمت دریافت کرده یا در مرحله تصمیم‌گیری قرار دارد.",
        channel: "تماس مشاوره‌ای",
        nextStep: "رفع مانع خرید و تعیین زمان تصمیم نهایی",
        defaultMessage: `${customerName} گرامی، وقت بخیر. برای پیگیری قیمت‌های اعلام‌شده و پاسخ به پرسش‌های شما درباره محصولات امیدمِد در خدمتتان هستیم.`,
      } satisfies SmartRecommendation;
    }

    return {
      level: "important",
      title: "آشنایی اولیه و کشف نیاز",
      reason:
        "این پرونده هنوز مشتری بالقوه است و سابقه خرید قطعی ندارد.",
      channel: "تماس معرفی، سپس پیامک",
      nextStep: "شناخت مصرف ماهانه و محصول اصلی کلینیک",
      defaultMessage: `${customerName} گرامی، وقت بخیر. امیدمِد تأمین‌کننده تخصصی پد، ملحفه، کیف و لوازم مصرفی فیزیوتراپی است. برای آشنایی با نیاز مجموعه شما در خدمتتان هستیم.`,
    } satisfies SmartRecommendation;
  }

  if (nextFollowupIsDue) {
    return {
      level: "urgent",
      title: "موعد پیگیری ثبت‌شده رسیده است",
      reason: `پیگیری بعدی برای ${formatDateTime(
        customer.next_followup_at,
      )} ثبت شده است.`,
      channel: "همان کانال ارتباط قبلی",
      nextStep: "تماس، ثبت نتیجه و تعیین اقدام بعدی",
      defaultMessage: `${customerName} گرامی، وقت بخیر. طبق پیگیری قبلی برای بررسی نیاز فعلی مجموعه شما در خدمتتان هستیم. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  if (
    daysSinceLastPurchase > 0 &&
    averageGap > 0 &&
    daysSinceLastPurchase >= averageGap
  ) {
    return {
      level: "important",
      title: "زمان احتمالی خرید مجدد رسیده است",
      reason: `از آخرین خرید ${numberFormatter.format(
        Math.round(daysSinceLastPurchase),
      )} روز گذشته و میانگین فاصله خرید این مشتری حدود ${numberFormatter.format(
        Math.round(averageGap),
      )} روز است.`,
      channel: "پیامک شخصی و تماس کوتاه",
      nextStep: `پیشنهاد خرید مجدد ${
        topProduct || "محصولات مصرفی قبلی"
      }`,
      defaultMessage: `${customerName} گرامی، وقت بخیر. با توجه به زمان آخرین سفارش شما، برای تأمین مجدد ${
        topProduct || "لوازم مصرفی فیزیوتراپی"
      } در خدمتتان هستیم. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  if (numeric(customer.purchase_count) === 0) {
    return {
      level: "important",
      title: "پرونده بدون خرید؛ نیاز به فعال‌سازی دارد",
      reason:
        "برای این مشتری هنوز خرید ثبت نشده و بهتر است نیاز اصلی او مشخص شود.",
      channel: "تماس کشف نیاز",
      nextStep: "ثبت محصول موردعلاقه و ارزش احتمالی سفارش",
      defaultMessage: `${customerName} گرامی، وقت بخیر. برای معرفی شرایط تأمین لوازم مصرفی فیزیوتراپی و بررسی نیاز مجموعه شما در خدمتتان هستیم. امیدمِد`,
    } satisfies SmartRecommendation;
  }

  return {
    level: "normal",
    title: "حفظ ارتباط و فروش مکمل",
    reason:
      "این مشتری اقدام فوری ندارد؛ ارتباط دوره‌ای و پیشنهاد محصول مکمل مناسب است.",
    channel: "پیامک کوتاه یا تماس دوره‌ای",
    nextStep: `بررسی نیاز به ${
      topProduct || "محصولات پرمصرف"
    } و محصولات مکمل`,
    defaultMessage: `${customerName} گرامی، وقت بخیر. برای اطلاع از موجودی و شرایط روز محصولات مصرفی فیزیوتراپی در خدمتتان هستیم. امیدمِد`,
  } satisfies SmartRecommendation;
}

async function saveFollowup(formData: FormData) {
  "use server";

  const customerId = String(
    formData.get("customer_id") ?? "",
  ).trim();
  const channel = String(
    formData.get("channel") ?? "phone",
  ).trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const notes = String(formData.get("notes") ?? "")
    .trim()
    .slice(0, 2000);
  const potentialValue = Math.max(
    0,
    Number(formData.get("potential_value") ?? 0) || 0,
  );

  const nextFollowupResult = parseJalaliTehranDateTime({
    year: String(formData.get("next_followup_year") ?? ""),
    month: String(formData.get("next_followup_month") ?? ""),
    day: String(formData.get("next_followup_day") ?? ""),
    time: String(formData.get("next_followup_time") ?? ""),
  });

  if (!customerId || !outcome) {
    redirect(`/customers/${customerId}?error=required#followup-form`);
  }

  if (nextFollowupResult.error) {
    redirect(`/customers/${customerId}?error=invaliddate#followup-form`);
  }

  const supabase = await createClient();
  const nextFollowupAt = nextFollowupResult.value;

  const { error: insertError } = await supabase
    .from("followups")
    .insert({
      customer_id: customerId,
      channel,
      outcome,
      notes: notes || null,
      next_followup_at: nextFollowupAt,
      potential_value: potentialValue || null,
    });

  if (insertError) {
    redirect(`/customers/${customerId}?error=save#followup-form`);
  }

  const customerUpdate: Record<string, unknown> = {
    next_followup_at: nextFollowupAt,
  };

  if (outcome === "lost") {
    customerUpdate.status = "lost";
    customerUpdate.lead_stage = "lost";
  } else if (outcome === "order_placed") {
    customerUpdate.status = "active";
    customerUpdate.lead_stage = "converted";
  } else if (outcome === "requested_price") {
    customerUpdate.lead_stage = "quoted";
  } else if (channel === "phone") {
    customerUpdate.lead_stage = "contacted";
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update(customerUpdate)
    .eq("id", customerId);

  if (updateError) {
    redirect(`/customers/${customerId}?error=nextdate#followup-form`);
  }


  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/quotes");
  revalidatePath(`/customers/${customerId}`);

  redirect(`/customers/${customerId}?saved=1#activity`);
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    created?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const [
    customerResult,
    followupsResult,
    customerFilesResult,
    salesResult,
    invoicesResult,
    productSummaryResult,
    smsResult,
    opportunitiesResult,
  ] = await Promise.all([
    supabase
      .from("customer_crm_summary")
      .select(
        "id,name,contact_name,phone,province,city,address,preferred_products,status,priority,notes,next_followup_at,lead_stage,lead_source,potential_value,archived_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("followups")
      .select(
        "id,followup_at,channel,outcome,notes,next_followup_at,potential_value",
      )
      .eq("customer_id", id)
      .order("followup_at", { ascending: false })
      .limit(40),
    supabase
      .from("customer_files")
      .select(
        "id,file_type,title,invoice_number,storage_path,original_name,mime_type,size_bytes,created_at",
      )
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("sales")
      .select(
        "id,invoice_number,document_number,sale_date,amount,description",
      )
      .eq("customer_id", id)
      .order("sale_date", { ascending: false })
      .limit(100),
    supabase
      .from("invoices")
      .select(
        "id,invoice_number,document_number,invoice_date,due_date,total_quantity,total_amount,cash_amount,check_amount,card_amount,account_balance_amount,account_balance_status,discount_amount,discount_percent,transaction_status",
      )
      .eq("customer_id", id)
      .order("invoice_date", { ascending: false })
      .limit(50),
    supabase
      .from("customer_product_summary")
      .select(
        "product_name,invoice_count,total_quantity,total_amount,last_purchase_at",
      )
      .eq("customer_id", id)
      .order("total_amount", { ascending: false })
      .limit(12),
    supabase
      .from("sms_messages")
      .select(
        "id,message_text,request_success,delivery_status,provider_status,sent_at,created_at",
      )
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("sales_opportunities")
      .select(
        "id,status,stage,source,product_interest,quoted_at,last_contact_at,next_followup_at,estimated_value,final_value,notes,created_at",
      )
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const customer = customerResult.data as CustomerRow | null;

  if (customerResult.error || !customer) {
    notFound();
  }

  const followups = (followupsResult.data ?? []) as FollowupRow[];
  const smsMessages = (smsResult.data ?? []) as SmsRow[];
  const opportunities = (
    opportunitiesResult.data ?? []
  ) as OpportunityRow[];
  const invoices = invoicesResult.data ?? [];
  const sales = salesResult.data ?? [];
  const productSummary = productSummaryResult.data ?? [];
  const customerFiles = customerFilesResult.data ?? [];

  const invoiceIds = invoices.map((invoice) => invoice.id);

  const invoiceItemsResult = invoiceIds.length
    ? await supabase
        .from("invoice_items")
        .select(
          "id,invoice_id,row_number,product_name,quantity,unit_price,line_total,description",
        )
        .in("invoice_id", invoiceIds)
        .order("row_number", { ascending: true })
    : { data: [], error: null };

  const typedInvoiceItems = (
    invoiceItemsResult.data ?? []
  ) as InvoiceItemRow[];

  const itemsByInvoice = new Map<string, InvoiceItemRow[]>();

  for (const item of typedInvoiceItems) {
    const current = itemsByInvoice.get(item.invoice_id) ?? [];
    current.push(item);
    itemsByInvoice.set(item.invoice_id, current);
  }

  const openOpportunity =
    opportunities.find(
      (item) =>
        item.status === "open" || item.status === "on_hold",
    ) ?? null;

  const debtAmount = invoices
    .filter(
      (invoice) => invoice.account_balance_status === "debtor",
    )
    .reduce(
      (sum, invoice) =>
        sum + numeric(invoice.account_balance_amount),
      0,
    );

  const topProduct =
    productSummary[0]?.product_name ??
    customer.preferred_products?.[0] ??
    null;

  const recommendation = buildRecommendation({
    customer,
    openOpportunity,
    debtAmount,
    topProduct,
  });

  const activities: ActivityItem[] = [
    ...followups.map((item) => ({
      id: `followup-${item.id}`,
      type: "followup" as const,
      date: item.followup_at,
      title: outcomeLabels[item.outcome] ?? item.outcome,
      detail: item.notes,
      meta: `${channelLabels[item.channel] ?? item.channel}${
        item.next_followup_at
          ? ` · پیگیری بعدی ${formatDateTime(
              item.next_followup_at,
            )}`
          : ""
      }`,
    })),
    ...smsMessages.map((item) => ({
      id: `sms-${item.id}`,
      type: "sms" as const,
      date: item.sent_at || item.created_at,
      title: item.request_success
        ? "پیامک ارسال شد"
        : "ارسال پیامک ناموفق بود",
      detail: item.message_text,
      meta:
        item.provider_status ||
        (item.request_success
          ? "پذیرفته‌شده توسط سرویس پیامک"
          : item.delivery_status),
      success: item.request_success,
    })),
    ...opportunities.map((item) => ({
      id: `opportunity-${item.id}`,
      type: "opportunity" as const,
      date: item.last_contact_at || item.quoted_at || item.created_at,
      title: `${
        opportunityStatusLabels[item.status] ?? item.status
      } · ${opportunityStageLabels[item.stage] ?? item.stage}`,
      detail:
        item.notes ||
        (item.product_interest
          ? `محصول: ${item.product_interest}`
          : null),
      meta: `ارزش احتمالی ${formatMoney(
        item.estimated_value,
      )} تومان${
        item.next_followup_at
          ? ` · پیگیری ${formatDateTime(
              item.next_followup_at,
            )}`
          : ""
      }`,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    .slice(0, 50);

  const phoneLink = normalizePhoneForLink(customer.phone);
  const currentJalaliYear = getCurrentJalaliDate().year;
  const nextFollowupDue = isPast(customer.next_followup_at);

  const errorMessage =
    query.error === "required"
      ? "نتیجه پیگیری را انتخاب کن."
      : query.error === "save"
        ? "ثبت پیگیری انجام نشد. دوباره تلاش کن."
        : query.error === "nextdate"
          ? "پیگیری ثبت شد، اما پرونده مشتری به‌روزرسانی نشد."
          : query.error === "invaliddate"
            ? "تاریخ پیگیری بعدی کامل یا معتبر نیست."
            : null;

  return (
    <AppShell
      active="customers"
      title="پرونده مشتری"
      subtitle="خرید، تماس، پیامک، فرصت فروش و اقدام بعدی در یک صفحه"
    >
      <div className={styles.backRow}>
        <Link href="/customers">← بازگشت به بانک مشتریان</Link>

        <div className={styles.backActions}>
          <Link href={`/customers/${customer.id}/manage`}>
            ویرایش و مدیریت
          </Link>

          <Link href="/quotes">قیمت‌های باز</Link>
        </div>
      </div>

      {query.created ? (
        <div className={styles.success}>
          مشتری با موفقیت ثبت شد.
        </div>
      ) : null}

      {query.saved ? (
        <div className={styles.success}>
          نتیجه پیگیری با موفقیت ثبت شد.
        </div>
      ) : null}

      {errorMessage ? (
        <div className={styles.error}>{errorMessage}</div>
      ) : null}

      {followupsResult.error ? (
        <div className={styles.error}>
          خطا در خواندن سابقه پیگیری:{" "}
          {followupsResult.error.message}
        </div>
      ) : null}

      <section className={styles.profileHero} id="overview">
        <div className={styles.profileIdentity}>
          <div className={styles.profileAvatar}>
            {customer.name.trim().slice(0, 1)}
          </div>

          <div>
            <div className={styles.badges}>
              <span
                className={`${styles.statusBadge} ${
                  customer.archived_at
                    ? styles.archived
                    : styles[customer.status]
                }`}
              >
                {customer.archived_at
                  ? "بایگانی‌شده"
                  : statusLabels[customer.status] ??
                    customer.status}
              </span>

              <span
                className={`${styles.priorityBadge} ${
                  styles[customer.priority]
                }`}
              >
                اولویت{" "}
                {priorityLabels[customer.priority] ??
                  customer.priority}
              </span>

              {customer.lead_stage ? (
                <span className={styles.stageBadge}>
                  {leadStageLabels[customer.lead_stage] ??
                    customer.lead_stage}
                </span>
              ) : null}
            </div>

            <h2>{customer.name}</h2>

            <p>
              {customer.contact_name
                ? `مسئول خرید: ${customer.contact_name}`
                : "مسئول خرید ثبت نشده"}
              {" · "}
              {[customer.province, customer.city]
                .filter(Boolean)
                .join("، ") || "شهر ثبت نشده"}
            </p>
          </div>
        </div>

        <div className={styles.quickActions}>
          {phoneLink ? (
            <a
              className={styles.callButton}
              href={`tel:${phoneLink}`}
            >
              <Icon name="phone" size={18} />
              تماس
            </a>
          ) : (
            <span className={styles.disabledAction}>
              شماره تماس ندارد
            </span>
          )}

          <SingleSmsComposer
            customerId={customer.id}
            customerName={customer.name}
            phone={customer.phone}
            source="customer"
            defaultText={recommendation.defaultMessage}
          />

          <a
            className={styles.followupButton}
            href="#followup-form"
          >
            <Icon name="check" size={18} />
            ثبت نتیجه
          </a>
        </div>
      </section>

      <nav className={styles.profileNav}>
        <a href="#overview">نمای کلی</a>
        <a href="#activity">تایم‌لاین</a>
        <a href="#products">محصولات</a>
        <a href="#files">فایل‌ها</a>
        <a href="#invoices">فاکتورها</a>
      </nav>

      <section
        className={`${styles.recommendation} ${
          styles[recommendation.level]
        }`}
      >
        <div className={styles.recommendationIcon}>
          <Icon name="assistant" size={24} />
        </div>

        <div className={styles.recommendationBody}>
          <span>پیشنهاد اقدام بعدی</span>
          <h3>{recommendation.title}</h3>
          <p>{recommendation.reason}</p>

          <div className={styles.recommendationMeta}>
            <span>
              کانال پیشنهادی: <b>{recommendation.channel}</b>
            </span>
            <span>
              اقدام: <b>{recommendation.nextStep}</b>
            </span>
          </div>
        </div>

        <div className={styles.recommendationAction}>
          <SingleSmsComposer
            customerId={customer.id}
            customerName={customer.name}
            phone={customer.phone}
            source={
              debtAmount > 0
                ? "accounting"
                : openOpportunity
                  ? "quote"
                  : "customer"
            }
            opportunityId={openOpportunity?.id}
            defaultText={recommendation.defaultMessage}
            compact
          />
        </div>
      </section>

      <section className={styles.metrics}>
        <article>
          <span>جمع فروش</span>
          <strong>{formatMoney(customer.total_sales)}</strong>
          <small>تومان</small>
        </article>

        <article>
          <span>تعداد خرید</span>
          <strong>
            {numberFormatter.format(customer.purchase_count ?? 0)}
          </strong>
          <small>فاکتور ثبت‌شده</small>
        </article>

        <article>
          <span>آخرین خرید</span>
          <strong className={styles.compactMetric}>
            {formatDate(customer.last_purchase_at)}
          </strong>
          <small>
            {customer.days_since_last_purchase == null
              ? "بدون سابقه خرید"
              : `${numberFormatter.format(
                  Math.round(
                    numeric(customer.days_since_last_purchase),
                  ),
                )} روز قبل`}
          </small>
        </article>

        <article
          className={
            nextFollowupDue ? styles.dueMetric : undefined
          }
        >
          <span>پیگیری بعدی</span>
          <strong className={styles.compactMetric}>
            {formatDateTime(customer.next_followup_at)}
          </strong>
          <small>
            {nextFollowupDue
              ? "موعد پیگیری رسیده است"
              : "برنامه تماس بعدی"}
          </small>
        </article>

        <article>
          <span>مانده بدهی</span>
          <strong>{formatMoney(debtAmount)}</strong>
          <small>تومان</small>
        </article>
      </section>

      <section className={styles.overviewGrid}>
        <article className={styles.infoCard}>
          <div className={styles.sectionHeading}>
            <div className={styles.sectionIcon}>
              <Icon name="users" size={20} />
            </div>

            <div>
              <h3>اطلاعات ارتباطی</h3>
              <p>مشخصات اصلی و زمینه رابطه فروش</p>
            </div>
          </div>

          <dl className={styles.details}>
            <div>
              <dt>شماره تماس</dt>
              <dd dir="ltr">{customer.phone || "ثبت نشده"}</dd>
            </div>

            <div>
              <dt>مسئول خرید</dt>
              <dd>{customer.contact_name || "ثبت نشده"}</dd>
            </div>

            <div>
              <dt>منبع آشنایی</dt>
              <dd>{customer.lead_source || "ثبت نشده"}</dd>
            </div>

            <div>
              <dt>ارزش احتمالی</dt>
              <dd>
                {customer.potential_value
                  ? `${formatMoney(
                      customer.potential_value,
                    )} تومان`
                  : "ثبت نشده"}
              </dd>
            </div>

            <div className={styles.fullDetail}>
              <dt>آدرس</dt>
              <dd>{customer.address || "ثبت نشده"}</dd>
            </div>
          </dl>

          {customer.notes ? (
            <div className={styles.noteBox}>
              <span>یادداشت کلی</span>
              <p>{customer.notes}</p>
            </div>
          ) : null}
        </article>

        <article className={styles.pipelineCard}>
          <div className={styles.sectionHeading}>
            <div className={styles.pipelineIcon}>
              <Icon name="chart" size={20} />
            </div>

            <div>
              <h3>وضعیت فروش</h3>
              <p>قیف فروش، قیمت باز و چرخه خرید</p>
            </div>
          </div>

          <div className={styles.pipelineRows}>
            <div>
              <span>مرحله مشتری</span>
              <strong>
                {customer.lead_stage
                  ? leadStageLabels[customer.lead_stage] ??
                    customer.lead_stage
                  : "بدون مرحله"}
              </strong>
            </div>

            <div>
              <span>فرصت فروش باز</span>
              <strong>
                {openOpportunity
                  ? opportunityStageLabels[
                      openOpportunity.stage
                    ] ?? openOpportunity.stage
                  : "وجود ندارد"}
              </strong>
            </div>

            <div>
              <span>محصول هدف</span>
              <strong>
                {openOpportunity?.product_interest ||
                  topProduct ||
                  "ثبت نشده"}
              </strong>
            </div>

            <div>
              <span>میانگین فاصله خرید</span>
              <strong>
                {customer.avg_purchase_gap_days == null
                  ? "—"
                  : `${numberFormatter.format(
                      Math.round(
                        numeric(
                          customer.avg_purchase_gap_days,
                        ),
                      ),
                    )} روز`}
              </strong>
            </div>
          </div>

          <Link
            className={styles.manageLink}
            href={`/customers/${customer.id}/manage`}
          >
            ویرایش وضعیت و اطلاعات
          </Link>
        </article>
      </section>

      <section className={styles.activityGrid} id="activity">
        <article
          className={styles.followupCard}
          id="followup-form"
        >
          <div className={styles.sectionHeading}>
            <div className={styles.sectionIcon}>
              <Icon name="check" size={20} />
            </div>

            <div>
              <h3>ثبت اقدام فروش</h3>
              <p>
                تماس، پیام یا نتیجه مذاکره را ثبت کن.
              </p>
            </div>
          </div>

          <form className={styles.followupForm} action={saveFollowup}>
            <input
              type="hidden"
              name="customer_id"
              value={customer.id}
            />

            <label>
              روش ارتباط
              <select name="channel" defaultValue="phone">
                <option value="phone">تماس تلفنی</option>
                <option value="whatsapp">واتساپ</option>
                <option value="sms">پیامک</option>
                <option value="in_person">حضوری</option>
                <option value="other">سایر</option>
              </select>
            </label>

            <label>
              نتیجه پیگیری *
              <select name="outcome" defaultValue="" required>
                <option value="">انتخاب نتیجه...</option>
                <option value="no_answer">پاسخ نداد</option>
                <option value="requested_price">قیمت خواست</option>
                <option value="no_need">
                  فعلاً نیاز ندارد
                </option>
                <option value="order_placed">
                  سفارش ثبت شد
                </option>
                <option value="follow_up_later">
                  بعداً پیگیری شود
                </option>
                <option value="payment_pending">
                  پیگیری تسویه
                </option>
                <option value="lost">
                  مشتری از دست رفته
                </option>
                <option value="other">سایر</option>
              </select>
            </label>

            <label>
              ارزش احتمالی، تومان
              <input
                name="potential_value"
                inputMode="numeric"
                dir="ltr"
                placeholder="مثلاً 10000000"
              />
            </label>

            <JalaliDateTimeField
              currentYear={currentJalaliYear}
            />

            <label>
              یادداشت تماس
              <textarea
                name="notes"
                rows={5}
                maxLength={2000}
                placeholder="نیاز مشتری، اعتراض قیمتی، محصول مدنظر یا وعده تماس..."
              />
            </label>

            <button type="submit">
              <Icon name="check" size={18} />
              ثبت نتیجه و اقدام بعدی
            </button>
          </form>
        </article>

        <article className={styles.timelineCard}>
          <div className={styles.sectionHeading}>
            <div className={styles.timelineIcon}>
              <Icon name="calendar" size={20} />
            </div>

            <div>
              <h3>تایم‌لاین یکپارچه</h3>
              <p>
                تماس‌ها، پیامک‌ها و فرصت‌های فروش
              </p>
            </div>
          </div>

          {activities.length === 0 ? (
            <div className={styles.emptyState}>
              هنوز فعالیتی برای این مشتری ثبت نشده است.
            </div>
          ) : (
            <div className={styles.timeline}>
              {activities.map((item) => (
                <div
                  className={styles.timelineItem}
                  key={item.id}
                >
                  <span
                    className={`${styles.timelineDot} ${
                      styles[item.type]
                    }`}
                  />

                  <div className={styles.timelineContent}>
                    <div className={styles.timelineTop}>
                      <strong>{item.title}</strong>
                      <time>{formatDateTime(item.date)}</time>
                    </div>

                    <span className={styles.activityType}>
                      {item.type === "followup"
                        ? "پیگیری"
                        : item.type === "sms"
                          ? "پیامک"
                          : "فرصت فروش"}
                    </span>

                    {item.detail ? <p>{item.detail}</p> : null}

                    <small
                      className={
                        item.success === false
                          ? styles.failedMeta
                          : undefined
                      }
                    >
                      {item.meta}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className={styles.sectionCard} id="products">
        <div className={styles.sectionHeading}>
          <div className={styles.productIcon}>کالا</div>

          <div>
            <h3>محصولات و سابقه علاقه‌مندی</h3>
            <p>
              خریدهای قبلی و محصولاتی که برای فروش بعدی مناسب‌اند
            </p>
          </div>
        </div>

        {productSummary.length ? (
          <div className={styles.productGrid}>
            {productSummary.map((product) => (
              <article
                className={styles.productCard}
                key={product.product_name}
              >
                <strong>{product.product_name}</strong>

                <div>
                  <span>تعداد کل</span>
                  <b>{formatQuantity(product.total_quantity)}</b>
                </div>

                <div>
                  <span>مبلغ کل</span>
                  <b>{formatMoney(product.total_amount)}</b>
                </div>

                <small>
                  آخرین خرید:{" "}
                  {formatDate(product.last_purchase_at)}
                </small>
              </article>
            ))}
          </div>
        ) : customer.preferred_products?.length ? (
          <div className={styles.preferenceList}>
            {customer.preferred_products.map((product) => (
              <span key={product}>{product}</span>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            هنوز محصول خریداری‌شده یا موردعلاقه‌ای ثبت نشده است.
          </div>
        )}
      </section>

      <div id="files">
        {!customerFilesResult.error ? (
          <CustomerFilesManager
            customerId={customer.id}
            initialFiles={
              customerFiles as CustomerFileRecord[]
            }
          />
        ) : (
          <div className={styles.error}>
            بخش فایل‌ها هنوز آماده نیست:{" "}
            {customerFilesResult.error.message}
          </div>
        )}
      </div>

      <section
        className={styles.sectionCard}
        id="opportunities"
      >
        <div className={styles.sectionHeading}>
          <div className={styles.pipelineIcon}>
            <Icon name="chart" size={20} />
          </div>

          <div>
            <h3>قیمت‌ها و فرصت‌های فروش</h3>
            <p>
              درخواست قیمت، پیگیری‌های بعدی و نتیجه نهایی
            </p>
          </div>
        </div>

        {opportunitiesResult.error ? (
          <div className={styles.inlineError}>
            خواندن فرصت‌های فروش انجام نشد:{" "}
            {opportunitiesResult.error.message}
          </div>
        ) : opportunities.length === 0 ? (
          <div className={styles.emptyState}>
            هنوز درخواست قیمت یا فرصت فروشی ثبت نشده است.
          </div>
        ) : (
          <div className={styles.opportunityGrid}>
            {opportunities.map((item) => (
              <article
                className={styles.opportunityCard}
                key={item.id}
              >
                <div className={styles.opportunityHeader}>
                  <strong>
                    {item.product_interest ||
                      "فرصت فروش عمومی"}
                  </strong>

                  <span
                    className={`${styles.opportunityStatus} ${
                      styles[item.status]
                    }`}
                  >
                    {opportunityStatusLabels[item.status] ??
                      item.status}
                  </span>
                </div>

                <dl>
                  <div>
                    <dt>مرحله</dt>
                    <dd>
                      {opportunityStageLabels[item.stage] ??
                        item.stage}
                    </dd>
                  </div>

                  <div>
                    <dt>ارزش احتمالی</dt>
                    <dd>
                      {formatMoney(item.estimated_value)} تومان
                    </dd>
                  </div>

                  <div>
                    <dt>تاریخ قیمت</dt>
                    <dd>{formatDateTime(item.quoted_at)}</dd>
                  </div>

                  <div>
                    <dt>پیگیری بعدی</dt>
                    <dd>
                      {formatDateTime(item.next_followup_at)}
                    </dd>
                  </div>
                </dl>

                {item.notes ? <p>{item.notes}</p> : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.sectionCard} id="invoices">
        <div className={styles.sectionHeading}>
          <div className={styles.invoiceIcon}>فاکتور</div>

          <div>
            <h3>فاکتورها و اقلام خریداری‌شده</h3>
            <p>
              آخرین ۵۰ فاکتور؛ هر فاکتور را باز کن تا کالاها
              نمایش داده شوند.
            </p>
          </div>
        </div>

        {invoicesResult.error ? (
          <div className={styles.inlineError}>
            خواندن جزئیات فاکتورها انجام نشد:{" "}
            {invoicesResult.error.message}
          </div>
        ) : invoices.length === 0 ? (
          salesResult.error ? (
            <div className={styles.inlineError}>
              خواندن فاکتورها انجام نشد:{" "}
              {salesResult.error.message}
            </div>
          ) : sales.length === 0 ? (
            <div className={styles.emptyState}>
              هنوز فاکتور هلو برای این مشتری وارد نشده است.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>تاریخ</th>
                    <th>شماره فاکتور</th>
                    <th>شماره سند</th>
                    <th>مبلغ</th>
                    <th>توضیحات</th>
                  </tr>
                </thead>

                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDate(sale.sale_date)}</td>
                      <td dir="ltr">
                        {sale.invoice_number || "—"}
                      </td>
                      <td dir="ltr">
                        {sale.document_number || "—"}
                      </td>
                      <td>{formatMoney(sale.amount)}</td>
                      <td>{sale.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className={styles.invoiceList}>
            {invoices.map((invoice, index) => {
              const items =
                itemsByInvoice.get(invoice.id) ?? [];

              return (
                <details
                  className={styles.invoiceDetails}
                  key={invoice.id}
                  open={index === 0}
                >
                  <summary>
                    <div>
                      <strong>
                        فاکتور {invoice.invoice_number}
                      </strong>

                      <span>
                        سند {invoice.document_number || "—"} ·{" "}
                        {formatDate(invoice.invoice_date)}
                      </span>
                    </div>

                    <div
                      className={styles.invoiceSummaryNumbers}
                    >
                      <b>{formatMoney(invoice.total_amount)}</b>
                      <span>
                        {formatQuantity(
                          invoice.total_quantity,
                        )}{" "}
                        واحد
                      </span>
                    </div>
                  </summary>

                  <div className={styles.invoiceMeta}>
                    <span>
                      وضعیت:{" "}
                      <b>
                        {invoice.transaction_status ||
                          "نامشخص"}
                      </b>
                    </span>

                    <span>
                      تخفیف:{" "}
                      <b>
                        {formatMoney(invoice.discount_amount)}
                      </b>
                    </span>

                    <span>
                      سررسید:{" "}
                      <b>{formatDate(invoice.due_date)}</b>
                    </span>

                    <span>
                      مانده:{" "}
                      <b>
                        {formatMoney(
                          invoice.account_balance_amount,
                        )}{" "}
                        (
                        {balanceLabels[
                          invoice.account_balance_status
                        ] ??
                          invoice.account_balance_status}
                        )
                      </b>
                    </span>
                  </div>

                  {items.length ? (
                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th>ردیف</th>
                            <th>نام کالا</th>
                            <th>تعداد</th>
                            <th>قیمت واحد</th>
                            <th>جمع</th>
                            <th>توضیحات</th>
                          </tr>
                        </thead>

                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.row_number ?? "—"}</td>
                              <td>
                                <strong>
                                  {item.product_name}
                                </strong>
                              </td>
                              <td>
                                {formatQuantity(item.quantity)}
                              </td>
                              <td>
                                {formatMoney(item.unit_price)}
                              </td>
                              <td>
                                {formatMoney(item.line_total)}
                              </td>
                              <td>
                                {item.description || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyItems}>
                      اقلام این فاکتور هنوز وارد نشده‌اند.
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
