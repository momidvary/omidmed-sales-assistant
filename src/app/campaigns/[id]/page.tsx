import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  addTehranDaysAtTen,
  campaignChannelLabels,
  campaignStatusLabels,
  campaignTypeLabels,
  lostReasonLabels,
  memberStatusLabels,
  normalizePhoneForLink,
} from "@/lib/campaigns/constants";
import CopyMessageButton from "./copy-message-button";
import styles from "./campaign.module.css";

const number = new Intl.NumberFormat("fa-IR");

type CampaignDetail = {
  id: string;
  name: string;
  campaign_type: string;
  channel: string;
  status: string;
  target_product: string | null;
  target_city: string | null;
  min_days_inactive: number | string;
  message_template: string | null;
  notes: string | null;
  target_count: number | string | null;
  contacted_count: number | string | null;
  requested_price_count: number | string | null;
  ordered_count: number | string | null;
  conversion_rate: number | string | null;
  order_value: number | string | null;
};

type CampaignMemberRow = {
  id: string;
  customer_id: string;
  status: string;
  contacted_at: string | null;
  responded_at: string | null;
  ordered_at: string | null;
  next_followup_at: string | null;
  order_value: number | string | null;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
};

type CampaignCustomer = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  priority: string;
  last_purchase_at: string | null;
  days_since_last_purchase: number | string | null;
  total_sales: number | string | null;
};
const allowedMemberStatuses = new Set([
  "pending",
  "contacted",
  "requested_price",
  "ordered",
  "no_answer",
  "no_need",
  "follow_up",
  "lost",
]);
const allowedActions = new Set([
  "contacted",
  "requested_price",
  "ordered",
  "no_answer",
  "no_need",
  "follow_up",
  "lost",
]);

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

async function saveCampaignResult(formData: FormData) {
  "use server";

  const campaignId = clean(formData.get("campaign_id"), 80);
  const memberId = clean(formData.get("member_id"), 80);
  const customerId = clean(formData.get("customer_id"), 80);
  const outcome = clean(formData.get("outcome"), 40);
  const returnStatus = clean(formData.get("return_status"), 40);
  const notes = clean(formData.get("notes"), 1500);
  const lostReason = clean(formData.get("lost_reason"), 40);
  const orderValue = Math.max(0, Number(formData.get("order_value") ?? 0) || 0);

  if (!campaignId || !memberId || !customerId || !allowedActions.has(outcome)) {
    redirect(`/campaigns/${campaignId}?error=invalid`);
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const nextFollowupAt =
    outcome === "no_answer" || outcome === "requested_price"
      ? addTehranDaysAtTen(1)
      : outcome === "contacted" || outcome === "follow_up"
        ? addTehranDaysAtTen(3)
        : outcome === "no_need"
          ? addTehranDaysAtTen(30)
          : null;

  const [{ data: campaign }, { data: currentOpportunity }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id,target_product")
      .eq("id", campaignId)
      .single(),
    supabase
      .from("sales_opportunities")
      .select("id,estimated_value,status")
      .eq("customer_id", customerId)
      .in("status", ["open", "on_hold"])
      .maybeSingle(),
  ]);

  let opportunityId = currentOpportunity?.id as string | undefined;

  if (outcome === "requested_price") {
    const opportunityPayload = {
      customer_id: customerId,
      campaign_id: campaignId,
      campaign_member_id: memberId,
      status: "open",
      stage: "quote_sent",
      source: "campaign",
      product_interest: campaign?.target_product || null,
      quoted_at: now,
      last_contact_at: now,
      next_followup_at: nextFollowupAt,
      estimated_value: orderValue || currentOpportunity?.estimated_value || null,
      lost_reason: null,
      notes: notes || null,
    };

    if (opportunityId) {
      const { error } = await supabase
        .from("sales_opportunities")
        .update(opportunityPayload)
        .eq("id", opportunityId);
      if (error) redirect(`/campaigns/${campaignId}?error=opportunity`);
    } else {
      const { data, error } = await supabase
        .from("sales_opportunities")
        .insert(opportunityPayload)
        .select("id")
        .single();
      if (error || !data) redirect(`/campaigns/${campaignId}?error=opportunity`);
      opportunityId = data.id;
    }
  } else if (outcome === "ordered" && opportunityId) {
    await supabase
      .from("sales_opportunities")
      .update({
        status: "won",
        last_contact_at: now,
        next_followup_at: null,
        final_value: orderValue || null,
        lost_reason: null,
      })
      .eq("id", opportunityId);
  } else if (outcome === "lost" && opportunityId) {
    await supabase
      .from("sales_opportunities")
      .update({
        status: "lost",
        last_contact_at: now,
        next_followup_at: null,
        lost_reason: lostReason || "other",
      })
      .eq("id", opportunityId);
  } else if (outcome === "no_need" && opportunityId) {
    await supabase
      .from("sales_opportunities")
      .update({
        status: "on_hold",
        last_contact_at: now,
        next_followup_at: nextFollowupAt,
      })
      .eq("id", opportunityId);
  }

  const followupOutcome: Record<string, string> = {
    contacted: "follow_up_later",
    requested_price: "requested_price",
    ordered: "order_placed",
    no_answer: "no_answer",
    no_need: "no_need",
    follow_up: "follow_up_later",
    lost: "lost",
  };

  const { error: followupError } = await supabase.from("followups").insert({
    customer_id: customerId,
    channel: "phone",
    outcome: followupOutcome[outcome],
    notes: notes || `ثبت نتیجه از کمپین: ${memberStatusLabels[outcome] ?? outcome}`,
    next_followup_at: nextFollowupAt,
    potential_value: orderValue || null,
    campaign_id: campaignId,
    campaign_member_id: memberId,
    opportunity_id: opportunityId || null,
  });

  if (followupError) redirect(`/campaigns/${campaignId}?error=followup`);

  const memberUpdate = {
    status: outcome,
    contacted_at: now,
    responded_at:
      outcome === "requested_price" ||
      outcome === "ordered" ||
      outcome === "no_need" ||
      outcome === "follow_up" ||
      outcome === "lost"
        ? now
        : null,
    ordered_at: outcome === "ordered" ? now : null,
    next_followup_at: nextFollowupAt,
    order_value: outcome === "ordered" && orderValue ? orderValue : null,
    lost_reason: outcome === "lost" ? lostReason || "other" : null,
    notes: notes || null,
  };

  const { error: memberError } = await supabase
    .from("campaign_members")
    .update(memberUpdate)
    .eq("id", memberId)
    .eq("campaign_id", campaignId);

  if (memberError) redirect(`/campaigns/${campaignId}?error=member`);

  const { error: customerError } = await supabase
    .from("customers")
    .update({ next_followup_at: nextFollowupAt })
    .eq("id", customerId);

  if (customerError) redirect(`/campaigns/${campaignId}?error=customer`);

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/quotes");
  revalidatePath("/");
  revalidatePath(`/customers/${customerId}`);
  redirect(
    `/campaigns/${campaignId}?saved=${outcome}${returnStatus ? `&status=${returnStatus}` : ""}`,
  );
}

async function finishCampaign(formData: FormData) {
  "use server";
  const campaignId = clean(formData.get("campaign_id"), 80);
  if (!campaignId) redirect("/campaigns?error=invalid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) redirect(`/campaigns/${campaignId}?error=finish`);
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}?finished=1`);
}

async function fetchCustomersByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
) {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index += 400) {
    const { data, error } = await supabase
      .from("customer_sales_summary")
      .select(
        "id,name,phone,city,address,priority,last_purchase_at,days_since_last_purchase,total_sales",
      )
      .in("id", ids.slice(index, index + 400));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    saved?: string;
    error?: string;
    created?: string;
    finished?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const statusFilter = allowedMemberStatuses.has(query.status ?? "")
    ? query.status ?? ""
    : "";
  const search = (query.q ?? "").trim().slice(0, 80);
  const supabase = await createClient();

  const [{ data: campaign, error: campaignError }, { data: memberRows, error: memberError }] =
    await Promise.all([
      supabase
        .from("campaign_performance_summary")
        .select("*")
        .eq("id", id)
        .single(),
      supabase
        .from("campaign_members")
        .select(
          "id,customer_id,status,contacted_at,responded_at,ordered_at,next_followup_at,order_value,lost_reason,notes,created_at",
        )
        .eq("campaign_id", id)
        .order("created_at", { ascending: true })
        .limit(2500),
    ]);

  if (campaignError || !campaign) notFound();
  if (memberError) throw new Error(memberError.message);

  const typedMembers = (memberRows ?? []) as CampaignMemberRow[];
  const typedCampaign = campaign as CampaignDetail;
  const customerIds = typedMembers.map((row: CampaignMemberRow) => row.customer_id);
  const customers = await fetchCustomersByIds(supabase, customerIds);
  const customerMap = new Map(
    (customers as CampaignCustomer[]).map((customer: CampaignCustomer) => [customer.id, customer]),
  );

  const members = typedMembers
    .map((member: CampaignMemberRow) => ({ ...member, customer: customerMap.get(member.customer_id) }))
    .filter((member): member is CampaignMemberRow & { customer: CampaignCustomer } => Boolean(member.customer))
    .filter((member) => !statusFilter || member.status === statusFilter)
    .filter((member) => {
      if (!search) return true;
      const customer = member.customer;
      return `${customer.name ?? ""} ${customer.phone ?? ""} ${customer.city ?? ""}`
        .toLocaleLowerCase("fa")
        .includes(search.toLocaleLowerCase("fa"));
    })
    .slice(0, 500);

  const errorMessage =
    query.error === "invalid"
      ? "اطلاعات نتیجه معتبر نبود."
      : query.error === "opportunity"
        ? "ساخت فرصت فروش پس از درخواست قیمت انجام نشد."
        : query.error === "followup"
          ? "ثبت سابقه پیگیری انجام نشد."
          : query.error === "member"
            ? "وضعیت مشتری در کمپین به‌روزرسانی نشد."
            : query.error === "customer"
              ? "نتیجه ثبت شد، اما زمان پیگیری پرونده مشتری به‌روزرسانی نشد."
              : query.error === "finish"
                ? "بستن کمپین انجام نشد."
                : null;

  return (
    <AppShell
      active="campaigns"
      title={typedCampaign.name}
      subtitle={`${campaignTypeLabels[typedCampaign.campaign_type] ?? typedCampaign.campaign_type} · ${campaignChannelLabels[typedCampaign.channel] ?? typedCampaign.channel}`}
    >
      <div className={styles.backRow}>
        <Link href="/campaigns">← بازگشت به مرکز کمپین‌ها</Link>
      </div>

      {query.created ? <div className={styles.success}>کمپین ساخته شد و مشتریان هدف اضافه شدند.</div> : null}
      {query.finished ? <div className={styles.success}>کمپین با موفقیت تکمیل شد.</div> : null}
      {query.saved ? <div className={styles.success}>نتیجه مشتری با موفقیت ثبت شد.</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}

      <section className={styles.summary}>
        <div className={styles.summaryMain}>
          <div className={styles.titleRow}>
            <div>
              <span>کمپین فروش</span>
              <h2>{typedCampaign.name}</h2>
            </div>
            <b className={`${styles.campaignStatus} ${styles[typedCampaign.status]}`}>
              {campaignStatusLabels[typedCampaign.status] ?? typedCampaign.status}
            </b>
          </div>
          <p>{typedCampaign.notes || "یادداشت داخلی برای این کمپین ثبت نشده است."}</p>
          <div className={styles.filters}>
            {typedCampaign.target_product ? <span>محصول: {typedCampaign.target_product}</span> : null}
            {typedCampaign.target_city ? <span>شهر: {typedCampaign.target_city}</span> : null}
            <span>حداقل عدم خرید: {number.format(numeric(typedCampaign.min_days_inactive))} روز</span>
          </div>
          {typedCampaign.message_template ? (
            <div className={styles.messageBox}>
              <div>
                <strong>متن پیشنهادی</strong>
                <CopyMessageButton template={typedCampaign.message_template} className={styles.copyButton} />
              </div>
              <p>{typedCampaign.message_template}</p>
            </div>
          ) : null}
        </div>

        <div className={styles.performance}>
          <article><span>مشتری هدف</span><strong>{number.format(numeric(typedCampaign.target_count))}</strong></article>
          <article><span>اقدام‌شده</span><strong>{number.format(numeric(typedCampaign.contacted_count))}</strong></article>
          <article><span>قیمت خواست</span><strong>{number.format(numeric(typedCampaign.requested_price_count))}</strong></article>
          <article><span>سفارش</span><strong>{number.format(numeric(typedCampaign.ordered_count))}</strong></article>
          <article><span>نرخ تبدیل</span><strong>{number.format(numeric(typedCampaign.conversion_rate))}٪</strong></article>
          <article><span>فروش کمپین</span><strong>{formatMoney(typedCampaign.order_value)}</strong></article>
        </div>
      </section>

      <section className={styles.toolbar}>
        <form method="get" className={styles.filterForm}>
          <input name="q" defaultValue={search} placeholder="نام، موبایل یا شهر..." />
          <select name="status" defaultValue={statusFilter}>
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(memberStatusLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
          <button type="submit">اعمال فیلتر</button>
          {search || statusFilter ? <Link href={`/campaigns/${id}`}>پاک‌کردن</Link> : null}
        </form>
        {typedCampaign.status === "active" ? (
          <form action={finishCampaign}>
            <input type="hidden" name="campaign_id" value={id} />
            <button className={styles.finishButton} type="submit">پایان کمپین</button>
          </form>
        ) : null}
      </section>

      <section className={styles.memberList}>
        {members.length ? members.map((member: CampaignMemberRow & { customer: CampaignCustomer }) => {
          const customer = member.customer;
          const phone = customer.phone ?? "";
          const phoneLink = normalizePhoneForLink(phone);
          return (
            <article className={styles.memberCard} key={member.id}>
              <div className={styles.memberTop}>
                <div>
                  <Link href={`/customers/${customer.id}`} className={styles.customerName}>
                    {customer.name || "مشتری"}
                  </Link>
                  <span>{customer.city || "شهر ثبت نشده"} · آخرین خرید {number.format(numeric(customer.days_since_last_purchase))} روز قبل</span>
                </div>
                <b className={`${styles.memberStatus} ${styles[member.status]}`}>
                  {memberStatusLabels[member.status] ?? member.status}
                </b>
              </div>

              <div className={styles.memberMeta}>
                <span>موبایل: <b dir="ltr">{phone || "—"}</b></span>
                <span>جمع خرید: <b>{formatMoney(customer.total_sales)}</b></span>
                <span>پیگیری بعدی: <b>{formatDateTime(member.next_followup_at)}</b></span>
                {member.order_value ? <span>سفارش کمپین: <b>{formatMoney(member.order_value)}</b></span> : null}
              </div>

              {member.notes ? <p className={styles.memberNote}>{member.notes}</p> : null}

              <div className={styles.memberActions}>
                {phoneLink ? <a href={`tel:${phoneLink}`} className={styles.callButton}>تماس</a> : null}
                {typedCampaign.message_template ? (
                  <CopyMessageButton
                    template={typedCampaign.message_template}
                    customerName={String(customer.name ?? "")}
                    className={styles.copySmall}
                  />
                ) : null}
                <Link href={`/customers/${customer.id}`} className={styles.profileButton}>پرونده</Link>
              </div>

              <form action={saveCampaignResult} className={styles.resultForm}>
                <input type="hidden" name="campaign_id" value={id} />
                <input type="hidden" name="member_id" value={member.id} />
                <input type="hidden" name="customer_id" value={customer.id} />
                <input type="hidden" name="return_status" value={statusFilter} />
                <select name="outcome" defaultValue="contacted" aria-label="نتیجه تماس">
                  <option value="contacted">پیام/تماس انجام شد</option>
                  <option value="no_answer">پاسخ نداد</option>
                  <option value="requested_price">قیمت خواست</option>
                  <option value="follow_up">بعداً پیگیری شود</option>
                  <option value="no_need">فعلاً نیاز ندارد</option>
                  <option value="ordered">سفارش داد</option>
                  <option value="lost">فروش از دست رفت</option>
                </select>
                <input name="order_value" type="number" min="0" placeholder="مبلغ احتمالی/سفارش" />
                <select name="lost_reason" defaultValue="" aria-label="دلیل عدم خرید">
                  <option value="">دلیل عدم خرید...</option>
                  {Object.entries(lostReasonLabels).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
                <input name="notes" maxLength={1500} placeholder="یادداشت کوتاه تماس..." />
                <button type="submit">ثبت نتیجه</button>
              </form>
            </article>
          );
        }) : (
          <div className={styles.empty}>
            <Icon name="users" size={32} />
            <h3>مشتری‌ای با این فیلتر پیدا نشد</h3>
            <p>فیلتر وضعیت یا جست‌وجو را تغییر بده.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
