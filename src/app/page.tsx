import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import AppShell, { Icon } from "@/components/app-shell";
import SingleSmsComposer from "@/components/sms/single-sms-composer";
import { createClient } from "@/lib/supabase/server";
import {
  classifyFollowupNeed,
  latestContactByCustomer,
  RECENT_CONTACT_DAYS,
  SINGLE_PURCHASE_FOLLOWUP_DAYS,
  type FollowupNeed,
} from "@/lib/sales/followup-need";
import styles from "./today.module.css";
import { tehranDateKey as sharedTehranDateKey } from "@/lib/finance/metrics";

const number = new Intl.NumberFormat("fa-IR");
const DAILY_TARGET = 15;

const allowedViews = new Set(["needs", "ok"]);

const allowedOutcomes = new Set([
  "no_answer",
  "requested_price",
  "no_need",
  "order_placed",
  "payment_pending",
  "follow_up_later",
  "lost",
]);

type WorkspaceCustomer = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  status: string;
  next_followup_at: string | null;
  last_purchase_at: string | null;
  purchase_count: number | string | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | string | null;
  holo_balance_amount: number | string | null;
  holo_balance_status: string | null;
  holo_last_synced_at: string | null;
};

type FollowupRow = {
  customer_id: string;
  followup_at: string;
  outcome: string;
  potential_value: number | string | null;
};

type DailySalesRow = {
  invoice_count: number | string;
  invoiced_sales_amount: number | string;
};

type WorkspaceItem = {
  customer: WorkspaceCustomer;
  need: FollowupNeed;
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

function normalizePhoneForLink(phone: string | null) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("98")) return `+${digits}`;
  if (digits.startsWith("0")) return `+98${digits.slice(1)}`;
  return digits;
}

function tehranDateKey(date = new Date()) {
  return sharedTehranDateKey(date);
}

function addTehranDaysAtTen(days: number) {
  const target = new Date(Date.now() + days * 86_400_000);
  return `${tehranDateKey(target)}T10:00:00+03:30`;
}

function safeView(value: string | null | undefined) {
  return value && allowedViews.has(value) ? value : "needs";
}

async function collectAllRows<T>(
  load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
) {
  const data: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await load(from, from + 999);
    if (result.error) return { data, error: result.error };
    const rows = result.data ?? [];
    data.push(...rows);
    if (rows.length < 1000) return { data, error: null };
  }
}

function defaultSmsText(customer: WorkspaceCustomer) {
  return `${customer.name} گرامی، وقت بخیر. با توجه به زمان آخرین سفارش شما، برای تأمین مجدد لوازم مصرفی فیزیوتراپی در خدمتتان هستیم. امیدمِد`;
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
    String(formData.get("return_view") ?? "needs"),
  );
  const requestId = String(formData.get("request_id") ?? "").trim();

  if (!customerId || !allowedOutcomes.has(outcome) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    redirect(`/?view=${returnView}&error=invalid`);
  }

  const supabase = await createClient();
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

  const { error: mutationError } = await supabase.rpc("record_customer_followup", {
    p_request_id: requestId,
    p_customer_id: customerId,
    p_channel: "phone",
    p_outcome: outcome,
    p_notes: notesByOutcome[outcome],
    p_next_followup_at: nextFollowupAt,
    p_potential_value: null,
  });

  if (mutationError) {
    redirect(`/?view=${returnView}&error=save`);
  }

  revalidatePath("/");
  revalidatePath("/sales");
  revalidatePath("/quotes");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  redirect(`/?view=${returnView}&saved=${outcome}`);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    saved?: string;
    error?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const view = safeView(params.view);
  const currentPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();
  const todayKey = tehranDateKey();

  const [customerResult, followupResult, dailySalesResult] = await Promise.all([
    collectAllRows<WorkspaceCustomer>((from, to) =>
      supabase
        .from("customer_crm_summary")
        .select("id,name,phone,city,status,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase,holo_balance_amount,holo_balance_status,holo_last_synced_at")
        .is("archived_at", null)
        .order("id")
        .range(from, to) as unknown as Promise<{ data: WorkspaceCustomer[] | null; error: { message: string } | null }>,
    ),
    collectAllRows<FollowupRow>((from, to) =>
      supabase
        .from("followups")
        .select("customer_id,followup_at,outcome,potential_value")
        .order("followup_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as Promise<{ data: FollowupRow[] | null; error: { message: string } | null }>,
    ),
    supabase
      .from("owner_sales_daily")
      .select("invoice_count,invoiced_sales_amount")
      .eq("invoice_date", todayKey)
      .maybeSingle(),
  ]);

  const customers = customerResult.data;
  const followups = followupResult.data;
  const dailySales = dailySalesResult.data as DailySalesRow | null;
  const lastContact = latestContactByCustomer(followups);

  const items: WorkspaceItem[] = customers.map((customer) => ({
    customer,
    need: classifyFollowupNeed(customer, lastContact.get(customer.id) ?? null),
  }));
  const byValue = (a: WorkspaceItem, b: WorkspaceItem) =>
    numeric(b.customer.total_sales) - numeric(a.customer.total_sales);
  const needsItems = items.filter((item) => item.need.needsFollowup).sort(byValue);
  const okItems = items.filter((item) => !item.need.needsFollowup).sort(byValue);
  const listItems = view === "ok" ? okItems : needsItems;

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(listItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visibleItems = listItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  const todayStart = new Date(`${todayKey}T00:00:00+03:30`).getTime();
  const todayEnd = new Date(`${todayKey}T23:59:59.999+03:30`).getTime();
  const todayFollowups = followups.filter((item) => {
    const value = new Date(item.followup_at).getTime();
    return value >= todayStart && value <= todayEnd;
  });

  const lastSyncedAt = customers.reduce<string | null>((latest, customer) => {
    const value = customer.holo_last_synced_at;
    return value && (!latest || value > latest) ? value : latest;
  }, null);

  const totalDebt = customers
    .filter((customer) => customer.holo_balance_status === "debtor")
    .reduce((sum, customer) => sum + numeric(customer.holo_balance_amount), 0);

  const queryError =
    customerResult.error || followupResult.error || dailySalesResult.error;

  const actionError =
    params.error === "save"
      ? "ثبت نتیجه انجام نشد. دوباره تلاش کن."
      : params.error === "invalid"
        ? "اطلاعات نتیجه تماس معتبر نبود."
        : null;

  return (
    <AppShell
      active="home"
      title="پیگیری مشتریان"
      subtitle="مشتری‌ها بر اساس فاکتورهای قبلی‌شان در هلو به دو گروه تقسیم شده‌اند."
    >
      {params.saved && savedMessages[params.saved] ? (
        <div className={styles.notice}>{savedMessages[params.saved]}</div>
      ) : null}

      {actionError ? <div className={styles.error}>{actionError}</div> : null}

      {queryError ? (
        <div className={styles.error}>
          خواندن اطلاعات فروش کامل نشد. دوباره تلاش کنید؛ شناسه خطا: DASHBOARD_READ_FAILED
        </div>
      ) : null}

      <section className={styles.statsGrid}>
        <article>
          <span>نیاز به پیگیری</span>
          <strong>{number.format(needsItems.length)}</strong>
          <small>مشتری</small>
        </article>

        <article>
          <span>نیاز به پیگیری ندارد</span>
          <strong>{number.format(okItems.length)}</strong>
          <small>مشتری</small>
        </article>

        <article>
          <span>تماس‌های ثبت‌شده امروز</span>
          <strong>{number.format(todayFollowups.length)}</strong>
          <small>از هدف روزانه {number.format(DAILY_TARGET)}</small>
        </article>

        <article>
          <span>فروش فاکتورشده امروز</span>
          <strong>{number.format(numeric(dailySales?.invoice_count))}</strong>
          <small>{formatMoney(dailySales?.invoiced_sales_amount)} تومان</small>
        </article>

        <article>
          <span>مانده بدهکاران</span>
          <strong className={styles.compactValue}>{formatMoney(totalDebt)}</strong>
          <small>تومان طبق مانده حساب هلو</small>
        </article>
      </section>

      <section className={styles.workspace} id="work-queue">
        <article className={styles.mainPanel}>
          <header className={styles.panelHeader}>
            <div>
              <span>مرتب‌شده از بیشترین خرید قبلی</span>
              <h3>{view === "ok" ? "مشتریانی که فعلاً نیاز به پیگیری ندارند" : "مشتریانی که باید پیگیری شوند"}</h3>
            </div>

            <span className={styles.resultCount}>
              {number.format(listItems.length)} مشتری
            </span>
          </header>

          <nav className={styles.tabs}>
            {[
              ["needs", `نیاز به پیگیری (${number.format(needsItems.length)})`],
              ["ok", `نیاز به پیگیری ندارد (${number.format(okItems.length)})`],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/?view=${key}`}
                className={`${styles.tab} ${view === key ? styles.tabActive : ""}`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {visibleItems.length ? (
            <div className={styles.list}>
              {visibleItems.map(({ customer, need }) => {
                const phoneLink = normalizePhoneForLink(customer.phone);
                const daysSince = customer.days_since_last_purchase;

                return (
                  <article className={styles.item} key={customer.id}>
                    <div className={styles.itemTop}>
                      <div className={styles.identity}>
                        <h4>
                          <Link href={`/customers/${customer.id}`}>{customer.name}</Link>
                        </h4>
                        <p>
                          {customer.phone || "شماره تماس ثبت نشده"}
                          {customer.city ? ` · ${customer.city}` : ""}
                        </p>
                      </div>

                      <div className={styles.badges}>
                        <span
                          className={`${styles.badge} ${
                            need.needsFollowup ? styles.badgeUrgent : styles.badgeDue
                          }`}
                        >
                          {need.needsFollowup ? "نیاز به پیگیری" : "فعلاً نیاز ندارد"}
                        </span>
                      </div>
                    </div>

                    <div className={styles.meta}>
                      <div>
                        <span>آخرین خرید</span>
                        <strong>{formatDate(customer.last_purchase_at)}</strong>
                      </div>
                      <div>
                        <span>روز از خرید</span>
                        <strong>{daysSince == null ? "—" : number.format(numeric(daysSince))}</strong>
                      </div>
                      <div>
                        <span>تعداد فاکتور</span>
                        <strong>{number.format(numeric(customer.purchase_count))}</strong>
                      </div>
                      <div>
                        <span>جمع خرید</span>
                        <strong>{formatMoney(customer.total_sales)}</strong>
                      </div>
                    </div>

                    <div className={styles.reasons}>
                      <span className={styles.reason}>{need.reason}</span>
                    </div>

                    <div className={styles.actions}>
                      {phoneLink ? (
                        <a className={styles.call} href={`tel:${phoneLink}`}>
                          <Icon name="phone" size={15} />
                          تماس
                        </a>
                      ) : null}

                      <SingleSmsComposer
                        customerId={customer.id}
                        customerName={customer.name}
                        phone={customer.phone}
                        source="customer"
                        defaultText={defaultSmsText(customer)}
                        compact
                      />

                      <Link className={styles.profile} href={`/customers/${customer.id}`}>
                        پرونده
                      </Link>

                      {[
                        ["no_answer", "پاسخ نداد"],
                        ["requested_price", "قیمت خواست"],
                        ["order_placed", "سفارش شد"],
                        ["no_need", "فعلاً نیاز ندارد"],
                      ].map(([outcome, label]) => (
                        <form className={styles.quickForm} action={saveQuickFollowup} key={outcome}>
                          <input type="hidden" name="customer_id" value={customer.id} />
                          <input type="hidden" name="request_id" value={crypto.randomUUID()} />
                          <input type="hidden" name="outcome" value={outcome} />
                          <input type="hidden" name="return_view" value={view} />
                          <button className={styles.quickButton} type="submit">
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
              <h4>
                {view === "ok" ? "مشتری‌ای در این گروه نیست" : "فعلاً مشتری‌ای نیاز به پیگیری ندارد"}
              </h4>
            </div>
          )}

          {totalPages > 1 ? (
            <nav className={styles.tabs} aria-label="صفحه‌بندی">
              {safePage > 1 ? <Link href={`/?view=${view}&page=${safePage - 1}`}>صفحه قبل</Link> : null}
              <span>صفحه {number.format(safePage)} از {number.format(totalPages)}</span>
              {safePage < totalPages ? <Link href={`/?view=${view}&page=${safePage + 1}`}>صفحه بعد</Link> : null}
            </nav>
          ) : null}
        </article>

        <aside className={styles.sidePanel}>
          <section className={styles.sideSection}>
            <h3>قانون تقسیم‌بندی</h3>
            <ol className={styles.tipList}>
              <li>اگر خودتان تاریخ پیگیری گذاشته‌اید و آن تاریخ رسیده، نیاز به پیگیری دارد.</li>
              <li>مشتری با چند خرید: وقتی از آخرین خریدش به اندازه فاصله معمول خریدهایش گذشته باشد.</li>
              <li>مشتری با یک خرید: وقتی {number.format(SINGLE_PURCHASE_FOLLOWUP_DAYS)} روز از خریدش گذشته باشد.</li>
              <li>هر تماسی که ثبت کنید، مشتری را تا {number.format(RECENT_CONTACT_DAYS)} روز (یا تا تاریخ پیگیری بعدی) از این فهرست خارج می‌کند.</li>
            </ol>
          </section>

          <section className={styles.sideSection}>
            <h3>داده‌ها</h3>
            <p className={styles.muted}>
              آخرین همگام‌سازی هلو:{" "}
              {lastSyncedAt
                ? new Intl.DateTimeFormat("fa-IR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Tehran",
                  }).format(new Date(lastSyncedAt))
                : "ثبت نشده"}
            </p>
            <Link className={styles.syncLink} href="/settings/holo-sync">
              وضعیت اتصال هلو
            </Link>
          </section>
        </aside>
      </section>
    </AppShell>
  );
}
