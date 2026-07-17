import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import AppShell, { Icon } from "@/components/app-shell";
import SingleSmsComposer from "@/components/sms/single-sms-composer";
import { createClient } from "@/lib/supabase/server";
import {
  buildFollowupCandidates,
  type CustomerForFollowup,
  type FollowupForScoring,
} from "@/lib/sales/followup-priority";
import styles from "./today.module.css";

const number = new Intl.NumberFormat("fa-IR");
const DAILY_TARGET = 15;

const allowedViews = new Set([
  "all",
  "today",
  "overdue",
  "quote",
  "reorder",
  "prospect",
  "debt",
]);

const allowedOutcomes = new Set([
  "no_answer",
  "requested_price",
  "no_need",
  "order_placed",
  "payment_pending",
  "follow_up_later",
  "lost",
]);

type WorkspaceCustomer = CustomerForFollowup & {
  lead_stage: string | null;
  potential_value: number | string | null;
  archived_at: string | null;
  city: string | null;
};

type ExtendedFollowup = FollowupForScoring & {
  potential_value: number | string | null;
};

type OpportunityRow = {
  id: string;
  customer_id: string;
  status: string;
  stage: string;
  product_interest: string | null;
  next_followup_at: string | null;
  estimated_value: number | string | null;
};

type DebtRow = {
  customer_id: string;
  account_balance_amount: number | string;
};

type Candidate = ReturnType<
  typeof buildFollowupCandidates
>[number];

type WorkspaceItem = {
  customer: WorkspaceCustomer;
  score: number;
  reasons: string[];
  isToday: boolean;
  isOverdue: boolean;
  isReorder: boolean;
  isQuote: boolean;
  isProspect: boolean;
  isDebt: boolean;
  debtAmount: number;
  opportunity: OpportunityRow | null;
};

const priorityLabels: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

const leadStageLabels: Record<string, string> = {
  new: "سرنخ جدید",
  contacted: "تماس گرفته شد",
  interested: "علاقه‌مند",
  quoted: "قیمت دریافت کرده",
  decision: "در حال تصمیم‌گیری",
  converted: "تبدیل شده",
  lost: "از دست رفته",
};

const savedMessages: Record<string, string> = {
  no_answer: "عدم پاسخ ثبت شد و پیگیری بعدی برای فردا تنظیم شد.",
  requested_price:
    "درخواست قیمت ثبت شد و به قیف فروش و قیمت‌های باز اضافه شد.",
  no_need:
    "فعلاً نیاز ندارد ثبت شد و پیگیری بعدی برای ۳۰ روز دیگر تنظیم شد.",
  order_placed:
    "سفارش ثبت شد و فرصت فروش باز این مشتری بسته شد.",
  payment_pending:
    "پیگیری تسویه ثبت شد و یادآوری بعدی سه روز دیگر است.",
  follow_up_later:
    "نیازمند پیگیری ثبت شد و یادآوری بعدی هفت روز دیگر است.",
  lost: "مشتری از دست رفته ثبت شد.",
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(
  value: number | string | null | undefined,
) {
  return number.format(Math.round(numeric(value)));
}

function formatDate(value: string | null) {
  if (!value) return "ثبت نشده";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value}T12:00:00+03:30`));
}

function formatDateTime(value: string | null) {
  if (!value) return "تعیین نشده";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

function normalizePhoneForLink(phone: string | null) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("98")) return `+${digits}`;
  if (digits.startsWith("0")) return `+98${digits.slice(1)}`;
  return digits;
}

function tehranDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function addTehranDaysAtTen(days: number) {
  const target = new Date(Date.now() + days * 86_400_000);
  return `${tehranDateKey(target)}T10:00:00+03:30`;
}

function safeView(value: string | null | undefined) {
  return value && allowedViews.has(value) ? value : "all";
}

function isDue(value: string | null | undefined) {
  return Boolean(
    value && new Date(value).getTime() <= Date.now(),
  );
}

function defaultSmsText(item: WorkspaceItem) {
  const name = item.customer.name;

  if (item.isDebt) {
    return `${name} گرامی، وقت بخیر. مانده حساب مجموعه شما مبلغ ${formatMoney(
      item.debtAmount,
    )} تومان است. لطفاً در اولین فرصت نسبت به تسویه اقدام فرمایید. امیدمِد`;
  }

  if (item.isQuote) {
    return `${name} گرامی، وقت بخیر. برای پیگیری قیمت ${
      item.opportunity?.product_interest || "محصول موردنظر"
    } و بررسی نیاز فعلی مجموعه شما در خدمتتان هستیم. امیدمِد`;
  }

  if (item.isProspect) {
    return `${name} گرامی، وقت بخیر. امیدمِد تأمین‌کننده تخصصی پد، ملحفه، کیف و لوازم مصرفی فیزیوتراپی است. برای بررسی نیاز مجموعه شما در خدمتتان هستیم.`;
  }

  if (item.isReorder) {
    return `${name} گرامی، وقت بخیر. با توجه به زمان آخرین سفارش شما، برای تأمین مجدد لوازم مصرفی فیزیوتراپی در خدمتتان هستیم. امیدمِد`;
  }

  return `${name} گرامی، وقت بخیر. طبق پیگیری قبلی برای بررسی نیاز فعلی مجموعه شما در خدمتتان هستیم. امیدمِد`;
}

function outcomeNextFollowup(outcome: string) {
  if (outcome === "no_answer") return addTehranDaysAtTen(1);
  if (outcome === "requested_price")
    return addTehranDaysAtTen(1);
  if (outcome === "payment_pending")
    return addTehranDaysAtTen(3);
  if (outcome === "follow_up_later")
    return addTehranDaysAtTen(7);
  if (outcome === "no_need") return addTehranDaysAtTen(30);
  return null;
}

async function saveQuickFollowup(formData: FormData) {
  "use server";

  const customerId = String(
    formData.get("customer_id") ?? "",
  ).trim();
  const outcome = String(
    formData.get("outcome") ?? "",
  ).trim();
  const returnView = safeView(
    String(formData.get("return_view") ?? "all"),
  );

  if (!customerId || !allowedOutcomes.has(outcome)) {
    redirect(`/?view=${returnView}&error=invalid`);
  }

  const supabase = await createClient();
  const { data: customer, error: customerError } =
    await supabase
      .from("customers")
      .select("status,lead_stage")
      .eq("id", customerId)
      .single();

  if (customerError || !customer) {
    redirect(`/?view=${returnView}&error=customer`);
  }

  const nextFollowupAt = outcomeNextFollowup(outcome);

  const notesByOutcome: Record<string, string> = {
    no_answer:
      "ثبت سریع از مرکز فروش روزانه: مشتری پاسخ نداد.",
    requested_price:
      "ثبت سریع از مرکز فروش روزانه: مشتری قیمت خواست.",
    no_need:
      "ثبت سریع از مرکز فروش روزانه: مشتری فعلاً نیاز ندارد.",
    order_placed:
      "ثبت سریع از مرکز فروش روزانه: سفارش قطعی شد.",
    payment_pending:
      "ثبت سریع از مرکز فروش روزانه: پیگیری تسویه انجام شد.",
    follow_up_later:
      "ثبت سریع از مرکز فروش روزانه: نیازمند پیگیری بعدی است.",
    lost:
      "ثبت سریع از مرکز فروش روزانه: مشتری از دست رفت.",
  };

  const { error: insertError } = await supabase
    .from("followups")
    .insert({
      customer_id: customerId,
      channel: "phone",
      outcome,
      notes: notesByOutcome[outcome],
      next_followup_at: nextFollowupAt,
    });

  if (insertError) {
    redirect(`/?view=${returnView}&error=save`);
  }

  const customerUpdate: Record<string, unknown> = {
    next_followup_at: nextFollowupAt,
  };

  if (outcome === "order_placed") {
    customerUpdate.status = "active";
    customerUpdate.lead_stage = "converted";
  } else if (outcome === "lost") {
    customerUpdate.status = "lost";
    customerUpdate.lead_stage = "lost";
  } else if (outcome === "requested_price") {
    customerUpdate.lead_stage = "quoted";
  } else if (
    customer.status === "prospect" &&
    outcome === "follow_up_later"
  ) {
    customerUpdate.lead_stage =
      customer.lead_stage === "interested"
        ? "decision"
        : "contacted";
  } else if (
    customer.status === "prospect" &&
    outcome === "no_answer"
  ) {
    customerUpdate.lead_stage = "contacted";
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update(customerUpdate)
    .eq("id", customerId);

  if (updateError) {
    redirect(`/?view=${returnView}&error=update`);
  }

  revalidatePath("/");
  revalidatePath("/sales");
  revalidatePath("/quotes");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  redirect(`/?view=${returnView}&saved=${outcome}`);
}

function mergeWorkspaceItem(
  map: Map<string, WorkspaceItem>,
  customer: WorkspaceCustomer,
  patch: Partial<WorkspaceItem> & {
    score?: number;
    reasons?: string[];
  },
) {
  const current = map.get(customer.id) ?? {
    customer,
    score: 0,
    reasons: [],
    isToday: false,
    isOverdue: false,
    isReorder: false,
    isQuote: false,
    isProspect: false,
    isDebt: false,
    debtAmount: 0,
    opportunity: null,
  };

  map.set(customer.id, {
    ...current,
    ...patch,
    customer,
    score: Math.max(current.score, patch.score ?? 0),
    reasons: Array.from(
      new Set([
        ...current.reasons,
        ...(patch.reasons ?? []),
      ]),
    ).slice(0, 4),
    isToday: current.isToday || Boolean(patch.isToday),
    isOverdue: current.isOverdue || Boolean(patch.isOverdue),
    isReorder: current.isReorder || Boolean(patch.isReorder),
    isQuote: current.isQuote || Boolean(patch.isQuote),
    isProspect:
      current.isProspect || Boolean(patch.isProspect),
    isDebt: current.isDebt || Boolean(patch.isDebt),
    debtAmount: Math.max(
      current.debtAmount,
      patch.debtAmount ?? 0,
    ),
    opportunity:
      patch.opportunity ?? current.opportunity ?? null,
  });
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const view = safeView(params.view);
  const supabase = await createClient();

  const [
    customerResult,
    followupResult,
    opportunityResult,
    debtorResult,
  ] = await Promise.all([
    supabase
      .from("customer_crm_summary")
      .select(
        "id,name,phone,status,priority,lead_stage,potential_value,archived_at,city,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
      )
      .is("archived_at", null)
      .limit(2000),
    supabase
      .from("followups")
      .select(
        "customer_id,followup_at,outcome,next_followup_at,notes,potential_value",
      )
      .order("followup_at", { ascending: false })
      .limit(6000),
    supabase
      .from("sales_opportunities")
      .select(
        "id,customer_id,status,stage,product_interest,next_followup_at,estimated_value",
      )
      .in("status", ["open", "on_hold"])
      .limit(2500),
    supabase
      .from("invoices")
      .select("customer_id,account_balance_amount")
      .eq("account_balance_status", "debtor")
      .gt("account_balance_amount", 0)
      .limit(5000),
  ]);

  const customers = (customerResult.data ??
    []) as WorkspaceCustomer[];
  const followups = (followupResult.data ??
    []) as ExtendedFollowup[];
  const opportunities = (opportunityResult.data ??
    []) as OpportunityRow[];
  const debtRows = (debtorResult.data ?? []) as DebtRow[];

  const customerMap = new Map(
    customers.map((customer) => [customer.id, customer]),
  );

  const scoredCandidates = buildFollowupCandidates({
    customers,
    followups,
  }) as Candidate[];

  const itemMap = new Map<string, WorkspaceItem>();

  for (const candidate of scoredCandidates) {
    const customer = customerMap.get(candidate.id);
    if (!customer) continue;

    mergeWorkspaceItem(itemMap, customer, {
      score: candidate.score,
      reasons: candidate.reasons,
      isToday:
        candidate.isScheduled && !candidate.isOverdue,
      isOverdue: candidate.isOverdue,
      isReorder: candidate.isPurchaseDue,
      isQuote: candidate.isRequestedPrice,
    });
  }

  for (const customer of customers) {
    if (customer.status !== "prospect") continue;

    const stage = customer.lead_stage || "new";
    const stageScore: Record<string, number> = {
      new: 62,
      contacted: 68,
      interested: 76,
      quoted: 84,
      decision: 90,
    };

    mergeWorkspaceItem(itemMap, customer, {
      score:
        stageScore[stage] ??
        (customer.priority === "vip" ? 75 : 58),
      reasons: [
        leadStageLabels[stage] || "مشتری بالقوه",
        customer.next_followup_at &&
        isDue(customer.next_followup_at)
          ? "موعد پیگیری سرنخ رسیده است"
          : "باید به مرحله بعدی قیف فروش منتقل شود",
      ],
      isToday: Boolean(
        customer.next_followup_at &&
          isDue(customer.next_followup_at),
      ),
      isProspect: true,
    });
  }

  for (const opportunity of opportunities) {
    const customer = customerMap.get(opportunity.customer_id);
    if (!customer) continue;

    const due = isDue(opportunity.next_followup_at);
    mergeWorkspaceItem(itemMap, customer, {
      score:
        (due ? 102 : 78) +
        (opportunity.stage === "final_followup" ? 12 : 0),
      reasons: [
        due
          ? "موعد پیگیری قیمت رسیده است"
          : "فرصت فروش باز دارد",
        opportunity.product_interest
          ? `محصول هدف: ${opportunity.product_interest}`
          : "محصول هدف ثبت نشده است",
      ],
      isToday: due,
      isQuote: true,
      opportunity,
    });
  }

  const debtByCustomer = new Map<string, number>();

  for (const row of debtRows) {
    debtByCustomer.set(
      row.customer_id,
      (debtByCustomer.get(row.customer_id) ?? 0) +
        numeric(row.account_balance_amount),
    );
  }

  for (const [customerId, debtAmount] of debtByCustomer) {
    const customer = customerMap.get(customerId);
    if (!customer) continue;

    mergeWorkspaceItem(itemMap, customer, {
      score: 94 + Math.min(20, Math.floor(debtAmount / 5_000_000)),
      reasons: [
        `مانده بدهی ${formatMoney(debtAmount)} تومان`,
        "نیازمند پیگیری مودبانه تسویه",
      ],
      isDebt: true,
      debtAmount,
    });
  }

  const allItems = Array.from(itemMap.values()).sort(
    (a, b) =>
      b.score - a.score ||
      numeric(b.customer.total_sales) -
        numeric(a.customer.total_sales),
  );

  const filteredItems = allItems.filter((item) => {
    if (view === "today") return item.isToday;
    if (view === "overdue") return item.isOverdue;
    if (view === "quote") return item.isQuote;
    if (view === "reorder") return item.isReorder;
    if (view === "prospect") return item.isProspect;
    if (view === "debt") return item.isDebt;
    return true;
  });

  const visibleItems = filteredItems.slice(0, 60);

  const todayKey = tehranDateKey();
  const todayStart = new Date(
    `${todayKey}T00:00:00+03:30`,
  ).getTime();
  const todayEnd = new Date(
    `${todayKey}T23:59:59.999+03:30`,
  ).getTime();

  const todayFollowups = followups.filter((item) => {
    const value = new Date(item.followup_at).getTime();
    return value >= todayStart && value <= todayEnd;
  });

  const ordersToday = todayFollowups.filter(
    (item) => item.outcome === "order_placed",
  );

  const salesValueToday = ordersToday.reduce(
    (sum, item) => sum + numeric(item.potential_value),
    0,
  );

  const activePipelineValue = opportunities.reduce(
    (sum, item) => sum + numeric(item.estimated_value),
    0,
  );

  const dueTodayCount = allItems.filter(
    (item) => item.isToday,
  ).length;
  const overdueCount = allItems.filter(
    (item) => item.isOverdue,
  ).length;
  const quoteCount = allItems.filter(
    (item) => item.isQuote,
  ).length;
  const prospectCount = customers.filter(
    (item) => item.status === "prospect",
  ).length;
  const totalDebt = Array.from(debtByCustomer.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  const progress = Math.min(
    100,
    Math.round(
      (todayFollowups.length / DAILY_TARGET) * 100,
    ),
  );

  const queryError =
    customerResult.error ||
    followupResult.error ||
    opportunityResult.error;

  const actionError =
    params.error === "save"
      ? "ثبت نتیجه انجام نشد. دوباره تلاش کن."
      : params.error === "update"
        ? "نتیجه ثبت شد، اما پرونده مشتری به‌روزرسانی نشد."
        : params.error === "customer"
          ? "پرونده مشتری پیدا نشد."
          : params.error === "invalid"
            ? "اطلاعات نتیجه تماس معتبر نبود."
            : null;

  return (
    <AppShell
      active="home"
      title="مرکز فرمان فروش امروز"
      subtitle="هر روز از همین صفحه شروع کن؛ اولویت‌ها، سرنخ‌ها، قیمت‌ها، خرید مجدد و وصول مطالبات کنار هم هستند."
    >
      {params.saved && savedMessages[params.saved] ? (
        <div className={styles.notice}>
          {savedMessages[params.saved]}
        </div>
      ) : null}

      {actionError ? (
        <div className={styles.error}>{actionError}</div>
      ) : null}

      {queryError ? (
        <div className={styles.error}>
          خواندن اطلاعات فروش با خطا روبه‌رو شد:{" "}
          {queryError.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.heroEyebrow}>
            برنامه عملیاتی امروز
          </span>

          <h2>
            {visibleItems.length
              ? `از ${number.format(
                  Math.min(10, visibleItems.length),
                )} اقدام اول شروع کن`
              : "صف فوری امروز خالی است"}
          </h2>

          <p>
            فهرست براساس پیگیری عقب‌افتاده، قیمت باز،
            چرخه خرید، مشتری بالقوه، مانده حساب و ارزش
            مشتری امتیازدهی شده است.
          </p>
        </div>

        <div className={styles.heroActions}>
          <a className={styles.heroPrimary} href="#work-queue">
            <Icon name="phone" size={18} />
            شروع پیگیری
          </a>

          <Link className={styles.heroSecondary} href="/sales">
            <Icon name="followup" size={18} />
            مشاهده قیف فروش
          </Link>

          <Link
            className={styles.heroSecondary}
            href="/customers/new?type=prospect"
          >
            + افزودن سرنخ
          </Link>
        </div>
      </section>

      <section className={styles.statsGrid}>
        <article>
          <span>اقدام‌های امروز</span>
          <strong>{number.format(todayFollowups.length)}</strong>
          <small>از هدف روزانه {number.format(DAILY_TARGET)}</small>
        </article>

        <article>
          <span>موعد امروز</span>
          <strong>{number.format(dueTodayCount)}</strong>
          <small>{number.format(overdueCount)} مورد عقب‌افتاده</small>
        </article>

        <article>
          <span>قیمت‌های باز</span>
          <strong>{number.format(quoteCount)}</strong>
          <small>
            ارزش قیف {formatMoney(activePipelineValue)} تومان
          </small>
        </article>

        <article>
          <span>مشتریان بالقوه</span>
          <strong>{number.format(prospectCount)}</strong>
          <small>در مراحل مختلف قیف فروش</small>
        </article>

        <article>
          <span>سفارش امروز</span>
          <strong>{number.format(ordersToday.length)}</strong>
          <small>{formatMoney(salesValueToday)} تومان ثبت‌شده</small>
        </article>

        <article>
          <span>مانده قابل پیگیری</span>
          <strong className={styles.compactValue}>
            {formatMoney(totalDebt)}
          </strong>
          <small>تومان طبق آخرین فایل هلو</small>
        </article>
      </section>

      <section className={styles.progressCard}>
        <div>
          <span>پیشرفت برنامه تماس امروز</span>
          <strong>
            {number.format(todayFollowups.length)} از{" "}
            {number.format(DAILY_TARGET)} اقدام
          </strong>
        </div>

        <div className={styles.progressTrack}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <b>{number.format(progress)}٪</b>
      </section>

      <section className={styles.workspace} id="work-queue">
        <article className={styles.mainPanel}>
          <header className={styles.panelHeader}>
            <div>
              <span>صف کار فروش</span>
              <h3>مشتریان مناسب اقدام بعدی</h3>
            </div>

            <span className={styles.resultCount}>
              {number.format(filteredItems.length)} نتیجه
            </span>
          </header>

          <nav className={styles.tabs}>
            {[
              ["all", "همه"],
              ["today", "موعد امروز"],
              ["overdue", "عقب‌افتاده"],
              ["quote", "قیمت باز"],
              ["reorder", "خرید مجدد"],
              ["prospect", "بالقوه"],
              ["debt", "تسویه"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/?view=${key}`}
                className={`${styles.tab} ${
                  view === key ? styles.tabActive : ""
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {visibleItems.length ? (
            <div className={styles.list}>
              {visibleItems.map((item) => {
                const customer = item.customer;
                const phoneLink = normalizePhoneForLink(
                  customer.phone,
                );
                const daysSince = numeric(
                  customer.days_since_last_purchase,
                );
                const averageGap = numeric(
                  customer.avg_purchase_gap_days,
                );

                return (
                  <article
                    className={styles.item}
                    key={customer.id}
                  >
                    <div className={styles.itemTop}>
                      <div className={styles.score}>
                        {number.format(item.score)}
                        <small>امتیاز</small>
                      </div>

                      <div className={styles.identity}>
                        <h4>
                          <Link
                            href={`/customers/${customer.id}`}
                          >
                            {customer.name}
                          </Link>
                        </h4>

                        <p>
                          {customer.phone ||
                            "شماره تماس ثبت نشده"}
                          {customer.city
                            ? ` · ${customer.city}`
                            : ""}
                        </p>
                      </div>

                      <div className={styles.badges}>
                        {item.isOverdue ? (
                          <span
                            className={`${styles.badge} ${styles.badgeUrgent}`}
                          >
                            عقب‌افتاده
                          </span>
                        ) : item.isToday ? (
                          <span
                            className={`${styles.badge} ${styles.badgeDue}`}
                          >
                            موعد اقدام
                          </span>
                        ) : null}

                        {item.isQuote ? (
                          <span
                            className={`${styles.badge} ${styles.badgePrice}`}
                          >
                            قیمت باز
                          </span>
                        ) : null}

                        {item.isProspect ? (
                          <span
                            className={`${styles.badge} ${styles.badgeProspect}`}
                          >
                            {leadStageLabels[
                              customer.lead_stage || "new"
                            ] || "بالقوه"}
                          </span>
                        ) : null}

                        {item.isDebt ? (
                          <span
                            className={`${styles.badge} ${styles.badgeDebt}`}
                          >
                            تسویه
                          </span>
                        ) : null}

                        <span
                          className={`${styles.badge} ${styles.badgeVip}`}
                        >
                          اولویت{" "}
                          {priorityLabels[customer.priority] ??
                            customer.priority}
                        </span>
                      </div>
                    </div>

                    <div className={styles.meta}>
                      <div>
                        <span>آخرین خرید</span>
                        <strong>
                          {formatDate(customer.last_purchase_at)}
                        </strong>
                      </div>

                      <div>
                        <span>روز از خرید</span>
                        <strong>
                          {daysSince
                            ? number.format(daysSince)
                            : "—"}
                        </strong>
                      </div>

                      <div>
                        <span>چرخه معمول</span>
                        <strong>
                          {averageGap
                            ? `${number.format(
                                Math.round(averageGap),
                              )} روز`
                            : "نامشخص"}
                        </strong>
                      </div>

                      <div>
                        <span>ارزش مشتری / سرنخ</span>
                        <strong>
                          {formatMoney(
                            customer.status === "prospect"
                              ? customer.potential_value
                              : customer.total_sales,
                          )}
                        </strong>
                      </div>

                      {item.isDebt ? (
                        <div>
                          <span>مانده حساب</span>
                          <strong>
                            {formatMoney(item.debtAmount)}
                          </strong>
                        </div>
                      ) : null}
                    </div>

                    <div className={styles.reasons}>
                      {item.reasons.map((reason) => (
                        <span
                          className={styles.reason}
                          key={reason}
                        >
                          {reason}
                        </span>
                      ))}
                    </div>

                    <div className={styles.actions}>
                      {phoneLink ? (
                        <a
                          className={styles.call}
                          href={`tel:${phoneLink}`}
                        >
                          <Icon name="phone" size={15} />
                          تماس
                        </a>
                      ) : null}

                      <SingleSmsComposer
                        customerId={customer.id}
                        customerName={customer.name}
                        phone={customer.phone}
                        source={
                          item.isDebt
                            ? "accounting"
                            : item.isQuote
                              ? "quote"
                              : "customer"
                        }
                        opportunityId={item.opportunity?.id}
                        defaultText={defaultSmsText(item)}
                        compact
                      />

                      <Link
                        className={styles.profile}
                        href={`/customers/${customer.id}`}
                      >
                        پرونده
                      </Link>

                      {[
                        ["no_answer", "پاسخ نداد"],
                        ["requested_price", "قیمت خواست"],
                        ["order_placed", "سفارش شد"],
                        ["payment_pending", "تسویه"],
                        ["no_need", "فعلاً نیاز ندارد"],
                      ].map(([outcome, label]) => (
                        <form
                          className={styles.quickForm}
                          action={saveQuickFollowup}
                          key={outcome}
                        >
                          <input
                            type="hidden"
                            name="customer_id"
                            value={customer.id}
                          />
                          <input
                            type="hidden"
                            name="outcome"
                            value={outcome}
                          />
                          <input
                            type="hidden"
                            name="return_view"
                            value={view}
                          />
                          <button
                            className={styles.quickButton}
                            type="submit"
                          >
                            {label}
                          </button>
                        </form>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Icon name="check" size={29} />
              </div>
              <h4>در این دسته اقدام بازی باقی نمانده است</h4>
              <p>
                فیلتر دیگری را انتخاب کن یا مشتری بالقوه
                جدیدی به قیف فروش اضافه کن.
              </p>
            </div>
          )}
        </article>

        <aside className={styles.sidePanel}>
          <section className={styles.sideSection}>
            <h3>اولویت شروع امروز</h3>

            <div className={styles.planList}>
              <div className={styles.planRow}>
                <span>عقب‌افتاده‌ها</span>
                <strong>{number.format(overdueCount)}</strong>
              </div>

              <div className={styles.planRow}>
                <span>قیمت‌های موعددار</span>
                <strong>
                  {number.format(
                    allItems.filter(
                      (item) =>
                        item.isQuote && item.isToday,
                    ).length,
                  )}
                </strong>
              </div>

              <div className={styles.planRow}>
                <span>سرنخ‌های بالقوه</span>
                <strong>{number.format(prospectCount)}</strong>
              </div>

              <div className={styles.planRow}>
                <span>پیگیری تسویه</span>
                <strong>
                  {number.format(debtByCustomer.size)}
                </strong>
              </div>
            </div>
          </section>

          <section className={styles.sideSection}>
            <h3>مسیر کار پیشنهادی</h3>

            <ol className={styles.tipList}>
              <li>اول پیگیری‌های عقب‌افتاده و قیمت‌های باز.</li>
              <li>بعد مشتریان موعد خرید مجدد و ویژه.</li>
              <li>سپس سرنخ‌های بالقوه و فروش مکمل.</li>
              <li>نتیجه هر تماس را همان لحظه ثبت کن.</li>
            </ol>

            <Link className={styles.syncLink} href="/sales">
              بازکردن قیف کامل فروش
            </Link>

            <Link className={styles.syncLink} href="/import/holo">
              به‌روزرسانی اطلاعات هلو
            </Link>
          </section>

          <section className={styles.sideSection}>
            <h3>نکته داده</h3>
            <p className={styles.muted}>
              مانده حساب و خریدهای جدید فقط به اندازه آخرین
              همگام‌سازی هلو به‌روز هستند. قیف فروش و تماس‌ها
              بلافاصله با ثبت نتیجه تغییر می‌کنند.
            </p>
          </section>
        </aside>
      </section>
    </AppShell>
  );
}
