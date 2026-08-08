import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  lostReasonLabels,
  normalizePhoneForLink,
  opportunityStageLabels,
  opportunityStatusLabels,
} from "@/lib/campaigns/constants";
import styles from "./quotes.module.css";
import SingleSmsComposer from "@/components/sms/single-sms-composer";

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
  const requestId = clean(formData.get("request_id"), 80);

  if (!opportunityId || !customerId || !allowedActions.has(action) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    redirect(`/quotes?view=${returnView}&error=invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_sales_opportunity", {
    p_request_id: requestId,
    p_opportunity_id: opportunityId,
    p_action: action,
    p_value: value || null,
    p_lost_reason: lostReason || null,
    p_notes:
      notes ||
      (action === "won"
        ? "توافق/سفارش در CRM ثبت شد؛ فاکتور حسابداری ایجاد نشده است."
        : `ثبت از پیگیری قیمت: ${action}`),
  });
  if (error) redirect(`/quotes?view=${returnView}&error=save`);

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
  let failed = false;
  for (let index = 0; index < ids.length; index += 400) {
    const { data, error } = await supabase
      .from("customer_sales_summary")
      .select("id,name,phone,city,priority,last_purchase_at,days_since_last_purchase,total_sales")
      .in("id", ids.slice(index, index + 400));
    if (error) {
      failed = true;
      break;
    }
    rows.push(...(data ?? []));
  }
  return { rows, failed };
}

async function fetchAllOpportunities(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const rows: OpportunityRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(
        "id,customer_id,campaign_id,campaign_member_id,status,stage,source,product_interest,quoted_at,last_contact_at,next_followup_at,estimated_value,final_value,lost_reason,notes,created_at",
      )
      .order("next_followup_at", { ascending: true, nullsFirst: false })
      .range(offset, offset + 999);
    if (error) return { rows, error: true };
    const page = (data ?? []) as OpportunityRow[];
    rows.push(...page);
    if (page.length < 1000) return { rows, error: false };
  }
}

async function fetchAllCampaigns(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const rows: CampaignLite[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id,name")
      .range(offset, offset + 999);
    if (error) return rows;
    const page = (data ?? []) as CampaignLite[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const view = allowedViews.has(params.view ?? "") ? params.view ?? "active" : "active";
  const search = (params.q ?? "").trim().slice(0, 80);
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();

  const [opportunityResult, campaigns] = await Promise.all([
    fetchAllOpportunities(supabase),
    fetchAllCampaigns(supabase),
  ]);

  const rows = opportunityResult.rows;
  const customerIds: string[] = Array.from(
    new Set(rows.map((row: OpportunityRow) => row.customer_id)),
  );
  const customerResult = customerIds.length
    ? await fetchCustomersByIds(supabase, customerIds)
    : { rows: [], failed: false };
  const customerMap = new Map(
    (customerResult.rows as OpportunityCustomer[]).map((customer: OpportunityCustomer) => [customer.id, customer]),
  );
  const campaignMap = new Map(
    campaigns.map((campaign: CampaignLite) => [campaign.id, campaign.name]),
  );

  const activeRows = rows.filter((row: OpportunityRow) => row.status === "open" || row.status === "on_hold");
  const dueRows = activeRows.filter((row: OpportunityRow) => isDue(row.next_followup_at));
  const wonRows = rows.filter((row: OpportunityRow) => row.status === "won");
  const totalPipeline = activeRows.reduce((sum: number, row: OpportunityRow) => sum + numeric(row.estimated_value), 0);

  const matchingRows = rows
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
    });
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const visible = matchingRows.slice((page - 1) * pageSize, page * pageSize);

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
      title="پیگیری قیمت‌ها و توافق‌های CRM"
      subtitle="قیمت‌های باز را پیگیری کن؛ توافق CRM با فاکتور حسابداری هلو یکسان نیست."
    >
      {params.saved ? <div className={styles.success}>نتیجه پیگیری با موفقیت ثبت شد.</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {opportunityResult.error || customerResult.failed ? (
        <div className={styles.alert}>
          اطلاعات فرصت‌های فروش کامل دریافت نشد. دوباره تلاش کنید. شناسه خطا: CRM-QUOTE-READ
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
        <article><span>توافق ثبت‌شده در CRM (غیرفاکتوری)</span><strong>{number.format(wonRows.length)}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <nav className={styles.tabs}>
          {[
            ["active", "باز و معلق"],
            ["due", "موعد پیگیری"],
            ["open", "فقط باز"],
            ["hold", "تعلیق موقت"],
            ["won", "توافق CRM (غیرفاکتوری)"],
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
                  <input type="hidden" name="request_id" value={crypto.randomUUID()} />
                  <input type="hidden" name="opportunity_id" value={row.id} />
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <input type="hidden" name="return_view" value={view} />
                  <select name="action" defaultValue="contacted">
                    <option value="contacted">پیگیری انجام شد؛ هنوز نخرید</option>
                    <option value="no_answer">پاسخ نداد</option>
                    <option value="hold">فعلاً نیاز ندارد؛ ۳۰ روز بعد</option>
                    <option value="won">توافق/سفارش CRM؛ فاکتور نیست</option>
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
              <SingleSmsComposer
                compact
                customerId={customer.id}
                customerName={customer.name}
                phone={customer.phone}
                source="quote"
                campaignId={row.campaign_id}
                campaignMemberId={row.campaign_member_id}
                opportunityId={row.id}
                defaultText={`${customer.name} گرامی، وقت بخیر. برای پیگیری قیمت ${row.product_interest || "محصولات امیدمِد"} که خدمتتان اعلام شد، در خدمت شما هستیم. امیدمِد`}
              />
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
      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="صفحه‌بندی فرصت‌های فروش">
          <Link
            aria-disabled={page <= 1}
            href={{ pathname: "/quotes", query: { view, q: search || undefined, page: Math.max(1, page - 1) } }}
          >
            صفحه قبل
          </Link>
          <span>صفحه {number.format(page)} از {number.format(pageCount)} · {number.format(matchingRows.length)} نتیجه</span>
          <Link
            aria-disabled={page >= pageCount}
            href={{ pathname: "/quotes", query: { view, q: search || undefined, page: Math.min(pageCount, page + 1) } }}
          >
            صفحه بعد
          </Link>
        </nav>
      ) : null}
    </AppShell>
  );
}
