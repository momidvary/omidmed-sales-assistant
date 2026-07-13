import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  buildFollowupCandidates,
  makeAutomaticNextFollowup,
  type CustomerForFollowup,
  type FollowupForScoring,
} from "@/lib/sales/followup-priority";
import styles from "./today.module.css";

const number = new Intl.NumberFormat("fa-IR");
const allowedViews = new Set([
  "all",
  "scheduled",
  "overdue",
  "smart",
  "price",
  "priority",
]);
const allowedOutcomes = new Set([
  "no_answer",
  "requested_price",
  "no_need",
  "order_placed",
]);

const savedMessages: Record<string, string> = {
  no_answer: "عدم پاسخ ثبت شد و پیگیری بعدی برای فردا ساعت ۱۰ تنظیم شد.",
  requested_price: "درخواست قیمت ثبت شد و پیگیری بعدی برای سه روز دیگر تنظیم شد.",
  no_need: "فعلاً نیاز ندارد ثبت شد و پیگیری بعدی برای ۳۰ روز دیگر تنظیم شد.",
  order_placed: "ثبت سفارش ثبت شد و پیگیری زمان‌بندی‌شده قبلی بسته شد.",
};

const priorityLabels: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null) {
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

function safeView(value: string | null | undefined) {
  return value && allowedViews.has(value) ? value : "all";
}

async function saveQuickFollowup(formData: FormData) {
  "use server";

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const returnView = safeView(String(formData.get("return_view") ?? "all"));

  if (!customerId || !allowedOutcomes.has(outcome)) {
    redirect(`/?view=${returnView}&error=invalid`);
  }

  const nextFollowupAt = makeAutomaticNextFollowup(outcome);
  const notesByOutcome: Record<string, string> = {
    no_answer: "ثبت سریع از صفحه امروز: مشتری پاسخ نداد.",
    requested_price: "ثبت سریع از صفحه امروز: مشتری قیمت خواست.",
    no_need: "ثبت سریع از صفحه امروز: مشتری فعلاً نیاز ندارد.",
    order_placed: "ثبت سریع از صفحه امروز: مشتری اعلام کرد سفارش ثبت شده است.",
  };

  const supabase = await createClient();
  const { error: insertError } = await supabase.from("followups").insert({
    customer_id: customerId,
    channel: "phone",
    outcome,
    notes: notesByOutcome[outcome],
    next_followup_at: nextFollowupAt,
  });

  if (insertError) {
    redirect(`/?view=${returnView}&error=save`);
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update({ next_followup_at: nextFollowupAt })
    .eq("id", customerId);

  if (updateError) {
    redirect(`/?view=${returnView}&error=update`);
  }

  revalidatePath("/");
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
  }>;
}) {
  const params = await searchParams;
  const view = safeView(params.view);
  const supabase = await createClient();

  const [customerResult, followupResult] = await Promise.all([
    supabase
      .from("customer_sales_summary")
      .select(
        "id,name,phone,status,priority,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
      )
      .limit(1500),
    supabase
      .from("followups")
      .select("customer_id,followup_at,outcome,next_followup_at,notes")
      .order("followup_at", { ascending: false })
      .limit(5000),
  ]);

  const customers = (customerResult.data ?? []) as CustomerForFollowup[];
  const followups = (followupResult.data ?? []) as FollowupForScoring[];
  const candidates = buildFollowupCandidates({ customers, followups });

  const dueToday = candidates.filter(
    (customer) => customer.isScheduled && !customer.isOverdue,
  );
  const overdue = candidates.filter((customer) => customer.isOverdue);
  const smartDue = candidates.filter((customer) => customer.isPurchaseDue);
  const requestedPrice = candidates.filter(
    (customer) => customer.isRequestedPrice,
  );
  const priorityCustomers = candidates.filter(
    (customer) => customer.isPriorityCustomer,
  );

  const filteredCandidates = candidates.filter((customer) => {
    if (view === "scheduled") return customer.isScheduled;
    if (view === "overdue") return customer.isOverdue;
    if (view === "smart") return customer.isPurchaseDue;
    if (view === "price") return customer.isRequestedPrice;
    if (view === "priority") return customer.isPriorityCustomer;
    return true;
  });

  const visibleCandidates = filteredCandidates.slice(0, 50);
  const suggestedToday = candidates.slice(0, 10);
  const queryError = customerResult.error || followupResult.error;
  const actionError =
    params.error === "save"
      ? "ثبت نتیجه تماس انجام نشد. دوباره تلاش کن."
      : params.error === "update"
        ? "نتیجه تماس ثبت شد، اما زمان پیگیری مشتری به‌روزرسانی نشد."
        : params.error === "invalid"
          ? "اطلاعات نتیجه تماس معتبر نبود."
          : null;

  return (
    <AppShell
      active="home"
      title="پیگیری‌های امروز"
      subtitle="فهرست تماس‌ها با استفاده از زمان پیگیری، سابقه خرید و ارزش مشتری مرتب شده است."
    >
      {params.saved && savedMessages[params.saved] ? (
        <div className={styles.notice}>{savedMessages[params.saved]}</div>
      ) : null}
      {actionError ? <div className={styles.error}>{actionError}</div> : null}
      {queryError ? (
        <div className={styles.error}>
          خواندن اطلاعات پیگیری با خطا روبه‌رو شد: {queryError.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.heroEyebrow}>برنامه پیشنهادی فروش</span>
          <h2>
            {suggestedToday.length
              ? `امروز از ${number.format(suggestedToday.length)} تماس اول شروع کن`
              : "برای امروز پیگیری فوری باقی نمانده است"}
          </h2>
          <p>
            مشتریان بر اساس موعد ثبت‌شده، رسیدن زمان سفارش مجدد، درخواست قیمت،
            اولویت و سابقه خرید امتیاز گرفته‌اند. ثبت سریع نتیجه تماس، فهرست را
            همان لحظه به‌روزرسانی می‌کند.
          </p>
        </div>
        <div className={styles.heroActions}>
          <a className={styles.heroPrimary} href="#followup-list">
            <Icon name="phone" size={17} /> شروع پیگیری
          </a>
          <Link className={styles.heroSecondary} href="/import/holo">
            <Icon name="upload" size={17} /> به‌روزرسانی از هلو
          </Link>
        </div>
      </section>

      <section className="stats-grid" aria-label="خلاصه پیگیری‌های امروز">
        <Link className={styles.statLink} href="/?view=scheduled">
          <article className={`stat-card ${styles.scoreCard}`}>
            <div className="stat-icon"><Icon name="calendar" /></div>
            <div>
              <span>موعد امروز</span>
              <strong>{number.format(dueToday.length)}</strong>
              <p>زمان پیگیری آن‌ها برای امروز تعیین شده است</p>
            </div>
          </article>
        </Link>
        <Link className={styles.statLink} href="/?view=overdue">
          <article className={`stat-card ${styles.scoreCard}`}>
            <div className="stat-icon"><Icon name="followup" /></div>
            <div>
              <span>عقب‌افتاده</span>
              <strong>{number.format(overdue.length)}</strong>
              <p>تاریخ پیگیری گذشته و هنوز بسته نشده‌اند</p>
            </div>
          </article>
        </Link>
        <Link className={styles.statLink} href="/?view=smart">
          <article className={`stat-card ${styles.scoreCard}`}>
            <div className="stat-icon"><Icon name="chart" /></div>
            <div>
              <span>موعد خرید مجدد</span>
              <strong>{number.format(smartDue.length)}</strong>
              <p>بر اساس فاصله خریدهای قبلی پیشنهاد شده‌اند</p>
            </div>
          </article>
        </Link>
        <Link className={styles.statLink} href="/?view=price">
          <article className={`stat-card ${styles.scoreCard}`}>
            <div className="stat-icon"><Icon name="phone" /></div>
            <div>
              <span>قیمت خواسته‌اند</span>
              <strong>{number.format(requestedPrice.length)}</strong>
              <p>بعد از درخواست قیمت، خرید جدید ثبت نشده است</p>
            </div>
          </article>
        </Link>
      </section>

      <section className={styles.workspace}>
        <article className={styles.mainPanel} id="followup-list">
          <div className={styles.panelHeader}>
            <div>
              <span>فهرست اولویت‌بندی‌شده</span>
              <h3>مشتریان مناسب تماس</h3>
            </div>
            <span className={styles.resultCount}>
              {number.format(filteredCandidates.length)} نتیجه
            </span>
          </div>

          <nav className={styles.tabs} aria-label="فیلتر پیگیری‌ها">
            {[
              ["all", "همه"],
              ["scheduled", "زمان‌بندی‌شده"],
              ["overdue", "عقب‌افتاده"],
              ["smart", "موعد خرید"],
              ["price", "درخواست قیمت"],
              ["priority", "ویژه و مهم"],
            ].map(([key, label]) => (
              <Link
                className={`${styles.tab} ${view === key ? styles.tabActive : ""}`}
                href={key === "all" ? "/" : `/?view=${key}`}
                key={key}
              >
                {label}
              </Link>
            ))}
          </nav>

          {visibleCandidates.length ? (
            <div className={styles.list}>
              {visibleCandidates.map((customer) => {
                const phoneLink = normalizePhoneForLink(customer.phone);
                const averageGap = numeric(customer.avg_purchase_gap_days);
                const daysSince = numeric(customer.days_since_last_purchase);

                return (
                  <div className={styles.item} key={customer.id}>
                    <div className={styles.itemTop}>
                      <div className={styles.score}>
                        <div>{number.format(customer.score)}<small>امتیاز</small></div>
                      </div>
                      <div className={styles.identity}>
                        <h4>
                          <Link href={`/customers/${customer.id}`}>
                            {customer.name}
                          </Link>
                        </h4>
                        <p dir={customer.phone ? "ltr" : undefined}>
                          {customer.phone || "شماره تماس ثبت نشده"}
                        </p>
                      </div>
                      <div className={styles.badges}>
                        {customer.isOverdue ? (
                          <span className={`${styles.badge} ${styles.badgeUrgent}`}>
                            عقب‌افتاده
                          </span>
                        ) : customer.isScheduled ? (
                          <span className={`${styles.badge} ${styles.badgeDue}`}>
                            موعد امروز
                          </span>
                        ) : null}
                        {customer.isRequestedPrice ? (
                          <span className={`${styles.badge} ${styles.badgePrice}`}>
                            قیمت خواسته
                          </span>
                        ) : null}
                        <span
                          className={`${styles.badge} ${customer.priority === "vip" ? styles.badgeVip : ""}`}
                        >
                          اولویت {priorityLabels[customer.priority] ?? customer.priority}
                        </span>
                      </div>
                    </div>

                    <div className={styles.meta}>
                      <div>
                        <span>آخرین خرید</span>
                        <strong>{formatDate(customer.last_purchase_at)}</strong>
                      </div>
                      <div>
                        <span>روز از آخرین خرید</span>
                        <strong>{daysSince ? number.format(daysSince) : "—"}</strong>
                      </div>
                      <div>
                        <span>چرخه معمول خرید</span>
                        <strong>
                          {averageGap ? `${number.format(Math.round(averageGap))} روز` : "نامشخص"}
                        </strong>
                      </div>
                      <div>
                        <span>جمع خرید</span>
                        <strong>{formatMoney(customer.total_sales)}</strong>
                      </div>
                    </div>

                    <div className={styles.reasons}>
                      {customer.reasons.map((reason) => (
                        <span className={styles.reason} key={reason}>{reason}</span>
                      ))}
                      {customer.next_followup_at ? (
                        <span className={styles.reason}>
                          پیگیری ثبت‌شده: {formatDateTime(customer.next_followup_at)}
                        </span>
                      ) : null}
                    </div>

                    <div className={styles.actions}>
                      {phoneLink ? (
                        <a className={styles.call} href={`tel:${phoneLink}`}>
                          <Icon name="phone" size={14} /> تماس
                        </a>
                      ) : null}
                      <Link className={styles.profile} href={`/customers/${customer.id}`}>
                        مشاهده پرونده
                      </Link>
                      {[
                        ["no_answer", "پاسخ نداد"],
                        ["requested_price", "قیمت خواست"],
                        ["no_need", "فعلاً نیاز ندارد"],
                        ["order_placed", "سفارش داد"],
                      ].map(([outcome, label]) => (
                        <form action={saveQuickFollowup} className={styles.quickForm} key={outcome}>
                          <input name="customer_id" type="hidden" value={customer.id} />
                          <input name="return_view" type="hidden" value={view} />
                          <button className={styles.quickButton} name="outcome" type="submit" value={outcome}>
                            {label}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}><Icon name="check" size={29} /></div>
              <h4>در این دسته پیگیری باقی نمانده است</h4>
              <p>
                یک فیلتر دیگر را انتخاب کن یا پس از ثبت خریدهای جدید، اطلاعات هلو
                را به‌روزرسانی کن.
              </p>
            </div>
          )}
        </article>

        <aside className={styles.sidePanel}>
          <section className={styles.sideSection}>
            <h3>برنامه پیشنهادی امروز</h3>
            <div className={styles.planList}>
              <div className={styles.planRow}>
                <span>۱۰ تماس اول</span>
                <strong>{number.format(suggestedToday.length)}</strong>
              </div>
              <div className={styles.planRow}>
                <span>مشتریان عقب‌افتاده</span>
                <strong>{number.format(overdue.length)}</strong>
              </div>
              <div className={styles.planRow}>
                <span>مشتریان ویژه و مهم</span>
                <strong>{number.format(priorityCustomers.length)}</strong>
              </div>
              <div className={styles.planRow}>
                <span>درخواست قیمت باز</span>
                <strong>{number.format(requestedPrice.length)}</strong>
              </div>
            </div>
            <Link className={styles.syncLink} href="/import/holo">
              به‌روزرسانی آخرین فاکتورها از هلو
            </Link>
          </section>

          <section className={styles.sideSection}>
            <h3>امتیاز چگونه محاسبه می‌شود؟</h3>
            <ul className={styles.tipList}>
              <li>پیگیری عقب‌افتاده بیشترین امتیاز را می‌گیرد.</li>
              <li>رسیدن به چرخه معمول سفارش مجدد امتیاز را بالا می‌برد.</li>
              <li>مشتری ویژه، خرید بالا و درخواست قیمت در اولویت قرار می‌گیرند.</li>
              <li>این پیشنهادها از داده واقعی هلو و تماس‌های ثبت‌شده ساخته می‌شوند.</li>
            </ul>
            <p className={styles.muted}>
              دکمه‌های ثبت سریع، زمان بعدی را خودکار می‌گذارند. برای یادداشت و
              تاریخ دقیق‌تر وارد پرونده مشتری شو.
            </p>
          </section>
        </aside>
      </section>
    </AppShell>
  );
}
