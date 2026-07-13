import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  addTehranDaysAtTen,
  lostReasonLabels,
  nextOpportunityStep,
  normalizePhoneForLink,
  opportunityStageLabels,
  opportunityStatusLabels,
} from "@/lib/campaigns/constants";
import styles from "./quotes.module.css";

const number = new Intl.NumberFormat("fa-IR");

type OpportunityRow = {
  id: string;
  customer_id: string;
  campaign_id: string | null;
  campaign_member_id: string | null;
  status: string;
  stage: string;
  source: string;
  product_interest: string | null;
  quoted_at: string;
  last_contact_at: string | null;
  next_followup_at: string | null;
  estimated_value: number | string | null;
  final_value: number | string | null;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
};

type OpportunityCustomer = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  priority: string;
  last_purchase_at: string | null;
  days_since_last_purchase: number | string | null;
  total_sales: number | string | null;
};

type CampaignLite = { id: string; name: string };
const allowedViews = new Set(["active", "due", "open", "hold", "won", "lost"]);
const allowedActions = new Set(["contacted", "no_answer", "won", "lost", "hold"]);

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined) {
  return number.format(Math.round(numeric(value)));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

function clean(value: FormDataEntryValue | null, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isDue(value: string | null | undefined) {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

async function updateOpportunity(formData: FormData) {
  "use server";

  const opportunityId = clean(formData.get("opportunity_id"), 80);
  const customerId = clean(formData.get("customer_id"), 80);
  const action = clean(formData.get("action"), 30);
  const returnView = allowedViews.has(clean(formData.get("return_view"), 20))
    ? clean(formData.get("return_view"), 20)
    : "active";
  const lostReason = clean(formData.get("lost_reason"), 40);
  const notes = clean(formData.get("notes"), 1500);
  const value = Math.max(0, Number(formData.get("value") ?? 0) || 0);

  if (!opportunityId || !customerId || !allowedActions.has(action)) {
    redirect(`/quotes?view=${returnView}&error=invalid`);
  }

  const supabase = await createClient();
  const { data: opportunity, error: readError } = await supabase
    .from("sales_opportunities")
    .select("id,status,stage,campaign_id,campaign_member_id,estimated_value")
    .eq("id", opportunityId)
    .single();

  if (readError || !opportunity) {
    redirect(`/quotes?view=${returnView}&error=missing`);
  }

  const now = new Date().toISOString();
  let status = opportunity.status as string;
  let stage = opportunity.stage as string;
  let nextFollowupAt: string | null = null;
  let followupOutcome = "follow_up_later";
  let memberStatus = "follow_up";

  if (action === "contacted" || action === "no_answer") {
    const next = nextOpportunityStep(stage);
    status = "open";
    stage = next.stage;
    nextFollowupAt = next.nextFollowupAt;
    followupOutcome = action === "no_answer" ? "no_answer" : "follow_up_later";
    memberStatus = action === "no_answer" ? "no_answer" : "follow_up";
  } else if (action === "won") {
    status = "won";
    nextFollowupAt = null;
    followupOutcome = "order_placed";
    memberStatus = "ordered";
  } else if (action === "lost") {
    status = "lost";
    nextFollowupAt = null;
    followupOutcome = "lost";
    memberStatus = "lost";
  } else if (action === "hold") {
    status = "on_hold";
    nextFollowupAt = addTehranDaysAtTen(30);
    followupOutcome = "no_need";
    memberStatus = "no_need";
  }

  const { error: updateError } = await supabase
    .from("sales_opportunities")
    .update({
      status,
      stage,
      last_contact_at: now,
      next_followup_at: nextFollowupAt,
      estimated_value: value || opportunity.estimated_value || null,
      final_value: action === "won" ? value || opportunity.estimated_value || null : null,
      lost_reason: action === "lost" ? lostReason || "other" : null,
      notes: notes || null,
    })
    .eq("id", opportunityId);

  if (updateError) redirect(`/quotes?view=${returnView}&error=save`);

  const { error: followupError } = await supabase.from("followups").insert({
    customer_id: customerId,
    channel: "phone",
    outcome: followupOutcome,
    notes: notes || `ثبت از پیگیری قیمت: ${action}`,
    next_followup_at: nextFollowupAt,
    potential_value: value || null,
    campaign_id: opportunity.campaign_id,
    campaign_member_id: opportunity.campaign_member_id,
    opportunity_id: opportunityId,
  });

  if (followupError) redirect(`/quotes?view=${returnView}&error=followup`);

  if (opportunity.campaign_member_id) {
    await supabase
      .from("campaign_members")
      .update({
        status: memberStatus,
        contacted_at: now,
        responded_at: action === "no_answer" ? null : now,
        ordered_at: action === "won" ? now : null,
        next_followup_at: nextFollowupAt,
        order_value: action === "won" ? value || opportunity.estimated_value || null : null,
        lost_reason: action === "lost" ? lostReason || "other" : null,
        notes: notes || null,
      })
      .eq("id", opportunity.campaign_member_id);
  }

  const { error: customerError } = await supabase
    .from("customers")
    .update({ next_followup_at: nextFollowupAt })
    .eq("id", customerId);

  if (customerError) redirect(`/quotes?view=${returnView}&error=customer`);

  revalidatePath("/quotes");
  revalidatePath("/campaigns");
  revalidatePath("/");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/quotes?view=${returnView}&saved=${action}`);
}

async function fetchCustomersByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
) {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index += 400) {
    const { data, error } = await supabase
      .from("customer_sales_summary")
      .select("id,name,phone,city,priority,last_purchase_at,days_since_last_purchase,total_sales")
      .in("id", ids.slice(index, index + 400));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const view = allowedViews.has(params.view ?? "") ? params.view ?? "active" : "active";
  const search = (params.q ?? "").trim().slice(0, 80);
  const supabase = await createClient();

  const [{ data: opportunities, error }, { data: campaigns }] = await Promise.all([
    supabase
      .from("sales_opportunities")
      .select(
        "id,customer_id,campaign_id,campaign_member_id,status,stage,source,product_interest,quoted_at,last_contact_at,next_followup_at,estimated_value,final_value,lost_reason,notes,created_at",
      )
      .order("next_followup_at", { ascending: true, nullsFirst: false })
      .limit(2500),
    supabase.from("campaigns").select("id,name").limit(500),
  ]);

  const rows = (opportunities ?? []) as OpportunityRow[];
  const customerIds: string[] = Array.from(
    new Set(rows.map((row: OpportunityRow) => row.customer_id)),
  );
  const customers = customerIds.length ? await fetchCustomersByIds(supabase, customerIds) : [];
  const customerMap = new Map(
    (customers as OpportunityCustomer[]).map((customer: OpportunityCustomer) => [customer.id, customer]),
  );
  const campaignMap = new Map(
    ((campaigns ?? []) as CampaignLite[]).map((campaign: CampaignLite) => [campaign.id, campaign.name]),
  );

  const activeRows = rows.filter((row: OpportunityRow) => row.status === "open" || row.status === "on_hold");
  const dueRows = activeRows.filter((row: OpportunityRow) => isDue(row.next_followup_at));
  const wonRows = rows.filter((row: OpportunityRow) => row.status === "won");
  const totalPipeline = activeRows.reduce((sum: number, row: OpportunityRow) => sum + numeric(row.estimated_value), 0);

  const visible = rows
    .filter((row: OpportunityRow) => {
      if (view === "active") return row.status === "open" || row.status === "on_hold";
      if (view === "due") return (row.status === "open" || row.status === "on_hold") && isDue(row.next_followup_at);
      if (view === "open") return row.status === "open";
      if (view === "hold") return row.status === "on_hold";
      return row.status === view;
    })
    .map((row: OpportunityRow) => ({ ...row, customer: customerMap.get(row.customer_id) }))
    .filter((row): row is OpportunityRow & { customer: OpportunityCustomer } => Boolean(row.customer))
    .filter((row) => {
      if (!search) return true;
      const customer = row.customer;
      return `${customer.name ?? ""} ${customer.phone ?? ""} ${row.product_interest ?? ""}`
        .toLocaleLowerCase("fa")
        .includes(search.toLocaleLowerCase("fa"));
    })
    .sort((a: OpportunityRow & { customer: OpportunityCustomer }, b: OpportunityRow & { customer: OpportunityCustomer }) => {
      const dueDifference = Number(isDue(b.next_followup_at)) - Number(isDue(a.next_followup_at));
      if (dueDifference) return dueDifference;
      return numeric(b.estimated_value) - numeric(a.estimated_value);
    })
    .slice(0, 500);

  const errorMessage =
    params.error === "invalid"
      ? "اطلاعات نتیجه پیگیری معتبر نبود."
      : params.error === "missing"
        ? "فرصت فروش پیدا نشد یا قبلاً تغییر کرده است."
        : params.error === "save"
          ? "به‌روزرسانی فرصت فروش انجام نشد."
          : params.error === "followup"
            ? "فرصت به‌روزرسانی شد اما سابقه پیگیری ثبت نشد."
            : params.error === "customer"
              ? "نتیجه ثبت شد اما زمان پیگیری پرونده مشتری به‌روزرسانی نشد."
              : null;

  return (
    <AppShell
      active="quotes"
      title="قیمت‌های بدون سفارش"
      subtitle="قیمت‌هایی که هنوز به سفارش تبدیل نشده‌اند را در روزهای ۱، ۳ و ۷ پیگیری کن."
    >
      {params.saved ? <div className={styles.success}>نتیجه پیگیری با موفقیت ثبت شد.</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {error ? (
        <div className={styles.alert}>
          ابتدا فایل SQL مرحله ۱۳ را اجرا کن. جزئیات: {error.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div>
          <span>فرصت‌های فروش باز</span>
          <h2>هیچ مشتریِ قیمت‌گرفته‌ای بدون پیگیری رها نشود</h2>
          <p>درخواست قیمت به‌صورت خودکار وارد این صف می‌شود و زمان پیگیری بعدی ثبت خواهد شد.</p>
        </div>
        <Link href="/campaigns" className={styles.backLink}>
          <Icon name="campaign" size={19} /> مرکز کمپین‌ها
        </Link>
      </section>

      <section className={styles.metrics}>
        <article><span>فرصت باز</span><strong>{number.format(activeRows.length)}</strong></article>
        <article><span>موعد پیگیری</span><strong>{number.format(dueRows.length)}</strong></article>
        <article><span>ارزش احتمالی</span><strong>{formatMoney(totalPipeline)}</strong></article>
        <article><span>تبدیل‌شده به سفارش</span><strong>{number.format(wonRows.length)}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <nav className={styles.tabs}>
          {[
            ["active", "باز و معلق"],
            ["due", "موعد پیگیری"],
            ["open", "فقط باز"],
            ["hold", "تعلیق موقت"],
            ["won", "سفارش‌شده"],
            ["lost", "از دست رفته"],
          ].map(([key, label]) => (
            <Link className={view === key ? styles.activeTab : ""} href={`/quotes?view=${key}`} key={key}>{label}</Link>
          ))}
        </nav>
        <form method="get" className={styles.searchForm}>
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={search} placeholder="نام، موبایل یا محصول..." />
          <button type="submit">جست‌وجو</button>
        </form>
      </section>

      <section className={styles.list}>
        {visible.length ? visible.map((row: OpportunityRow & { customer: OpportunityCustomer }) => {
          const customer = row.customer;
          const phone = customer.phone ?? "";
          const phoneLink = normalizePhoneForLink(phone);
          const due = isDue(row.next_followup_at) && (row.status === "open" || row.status === "on_hold");
          return (
            <article className={`${styles.card} ${due ? styles.due : ""}`} key={row.id}>
              <div className={styles.cardTop}>
                <div>
                  <Link className={styles.customerName} href={`/customers/${customer.id}`}>{customer.name || "مشتری"}</Link>
                  <span>{customer.city || "شهر ثبت نشده"} · {campaignMap.get(row.campaign_id as string) || "فرصت مستقل"}</span>
                </div>
                <div className={styles.badges}>
                  {due ? <b className={styles.dueBadge}>موعد پیگیری</b> : null}
                  <b className={`${styles.status} ${styles[row.status]}`}>{opportunityStatusLabels[row.status] ?? row.status}</b>
                </div>
              </div>

              <div className={styles.details}>
                <span>مرحله: <b>{opportunityStageLabels[row.stage] ?? row.stage}</b></span>
                <span>محصول: <b>{row.product_interest || "ثبت نشده"}</b></span>
                <span>قیمت از: <b>{formatDateTime(row.quoted_at)}</b></span>
                <span>پیگیری بعدی: <b>{formatDateTime(row.next_followup_at)}</b></span>
                <span>ارزش احتمالی: <b>{formatMoney(row.estimated_value)}</b></span>
                <span>موبایل: <b dir="ltr">{phone || "—"}</b></span>
              </div>

              {row.notes ? <p className={styles.note}>{row.notes}</p> : null}
              {row.lost_reason ? <p className={styles.lostReason}>دلیل عدم خرید: {lostReasonLabels[row.lost_reason] ?? row.lost_reason}</p> : null}

              {(row.status === "open" || row.status === "on_hold") ? (
                <form action={updateOpportunity} className={styles.actionForm}>
                  <input type="hidden" name="opportunity_id" value={row.id} />
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <input type="hidden" name="return_view" value={view} />
                  <select name="action" defaultValue="contacted">
                    <option value="contacted">پیگیری انجام شد؛ هنوز نخرید</option>
                    <option value="no_answer">پاسخ نداد</option>
                    <option value="hold">فعلاً نیاز ندارد؛ ۳۰ روز بعد</option>
                    <option value="won">سفارش داد</option>
                    <option value="lost">فروش از دست رفت</option>
                  </select>
                  <input name="value" type="number" min="0" defaultValue={numeric(row.estimated_value) || ""} placeholder="مبلغ احتمالی/نهایی" />
                  <select name="lost_reason" defaultValue="">
                    <option value="">دلیل عدم خرید...</option>
                    {Object.entries(lostReasonLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                  <input name="notes" maxLength={1500} placeholder="نتیجه صحبت یا اعتراض مشتری..." />
                  <button type="submit">ثبت نتیجه</button>
                </form>
              ) : null}

              <div className={styles.cardActions}>
                {phoneLink ? <a href={`tel:${phoneLink}`}>تماس</a> : null}
                <Link href={`/customers/${customer.id}`}>مشاهده پرونده</Link>
              </div>
            </article>
          );
        }) : (
          <div className={styles.empty}>
            <Icon name="quote" size={34} />
            <h3>فرصت فروشی در این بخش وجود ندارد</h3>
            <p>وقتی در پیگیری مشتری نتیجه «قیمت خواست» ثبت شود، به‌صورت خودکار اینجا قرار می‌گیرد.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
