import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  campaignChannelLabels,
  campaignStatusLabels,
  campaignTypeLabels,
  priorityLabels,
} from "@/lib/campaigns/constants";
import styles from "./campaigns.module.css";

const number = new Intl.NumberFormat("fa-IR");

type TargetCustomer = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  priority: string;
  status: string;
  days_since_last_purchase: number | string | null;
  total_sales: number | string | null;
};

type CampaignSummary = {
  id: string;
  name: string;
  campaign_type: string;
  channel: string;
  status: string;
  target_product: string | null;
  target_city: string | null;
  min_days_inactive: number | string;
  priority_filter: string;
  created_at: string;
  target_count: number | string | null;
  contacted_count: number | string | null;
  response_count: number | string | null;
  requested_price_count: number | string | null;
  ordered_count: number | string | null;
  no_answer_count: number | string | null;
  no_need_count: number | string | null;
  order_value: number | string | null;
  conversion_rate: number | string | null;
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined) {
  return number.format(Math.round(numeric(value)));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

function cleanText(formData: FormData, key: string, maxLength: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

async function createCampaign(formData: FormData) {
  "use server";

  const name = cleanText(formData, "name", 140);
  const campaignType = cleanText(formData, "campaign_type", 30) || "reactivation";
  const channel = cleanText(formData, "channel", 20) || "phone";
  const targetProduct = cleanText(formData, "target_product", 120);
  const targetCity = cleanText(formData, "target_city", 100);
  const priorityFilter = cleanText(formData, "priority_filter", 20) || "all";
  const messageTemplate = cleanText(formData, "message_template", 3000);
  const notes = cleanText(formData, "notes", 1500);
  const minDaysInactive = Math.max(
    0,
    Math.min(3650, Number(formData.get("min_days_inactive") ?? 0) || 0),
  );

  const validTypes = new Set([
    "reactivation",
    "product",
    "price_followup",
    "seasonal",
    "custom",
  ]);
  const validChannels = new Set(["phone", "sms", "whatsapp", "mixed"]);
  const validPriorities = new Set(["all", "urgent", "vip", "high", "normal", "low"]);

  if (
    !name ||
    !validTypes.has(campaignType) ||
    !validChannels.has(channel) ||
    !validPriorities.has(priorityFilter)
  ) {
    redirect("/campaigns?error=invalid");
  }

  const supabase = await createClient();
  let eligibleIds: Set<string> | null = null;

  if (campaignType === "price_followup") {
    const { data: opportunities, error } = await supabase
      .from("sales_opportunities")
      .select("customer_id")
      .in("status", ["open", "on_hold"])
      .limit(3000);

    if (error) redirect("/campaigns?error=database");
    eligibleIds = new Set<string>((opportunities ?? []).map((row: { customer_id: string }) => row.customer_id));
  }

  if (targetProduct) {
    const safeProduct = targetProduct.replace(/[%_]/g, "");
    const { data: products, error } = await supabase
      .from("customer_product_summary")
      .select("customer_id")
      .ilike("product_name", `%${safeProduct}%`)
      .limit(10000);

    if (error) redirect("/campaigns?error=product");
    const productIds = new Set<string>((products ?? []).map((row: { customer_id: string }) => row.customer_id));
    eligibleIds = eligibleIds
      ? new Set<string>([...eligibleIds].filter((id: string) => productIds.has(id)))
      : productIds;
  }

  let customerQuery = supabase
    .from("customer_sales_summary")
    .select("id,name,phone,city,priority,status,days_since_last_purchase,total_sales")
    .neq("status", "lost")
    .limit(2500);

  if (minDaysInactive > 0) {
    customerQuery = customerQuery.gte("days_since_last_purchase", minDaysInactive);
  }
  if (targetCity) {
    customerQuery = customerQuery.ilike("city", `%${targetCity.replace(/[%_]/g, "")}%`);
  }
  if (priorityFilter === "urgent") {
    customerQuery = customerQuery.in("priority", ["vip", "high"]);
  } else if (priorityFilter !== "all") {
    customerQuery = customerQuery.eq("priority", priorityFilter);
  }
  if (eligibleIds && !eligibleIds.size) redirect("/campaigns?error=no-target");

  const { data: customers, error: customerError } = await customerQuery;
  if (customerError) redirect("/campaigns?error=database");

  const typedCustomers = (customers ?? []) as TargetCustomer[];
  const targets = typedCustomers.filter((customer: TargetCustomer) => {
    if (eligibleIds && !eligibleIds.has(customer.id as string)) return false;
    if (channel === "sms" || channel === "whatsapp") return Boolean(customer.phone);
    return true;
  });

  if (!targets.length) redirect("/campaigns?error=no-target");

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      name,
      campaign_type: campaignType,
      channel,
      status: "active",
      target_product: targetProduct || null,
      target_city: targetCity || null,
      min_days_inactive: minDaysInactive,
      priority_filter: priorityFilter,
      message_template: messageTemplate || null,
      notes: notes || null,
      filters: {
        product: targetProduct || null,
        city: targetCity || null,
        min_days_inactive: minDaysInactive,
        priority: priorityFilter,
      },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (campaignError || !campaign) redirect("/campaigns?error=save");

  const rows = targets.map((customer: TargetCustomer) => ({
    campaign_id: campaign.id,
    customer_id: customer.id,
    status: "pending",
  }));

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase
      .from("campaign_members")
      .insert(rows.slice(index, index + 200));
    if (error) {
      await supabase.from("campaigns").delete().eq("id", campaign.id);
      redirect("/campaigns?error=members");
    }
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}?created=1`);
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: campaigns, error } = await supabase
    .from("campaign_performance_summary")
    .select(
      "id,name,campaign_type,channel,status,target_product,target_city,min_days_inactive,priority_filter,created_at,target_count,contacted_count,response_count,requested_price_count,ordered_count,no_answer_count,no_need_count,order_value,conversion_rate",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const errorMessage =
    params.error === "invalid"
      ? "اطلاعات کمپین کامل یا معتبر نیست."
      : params.error === "no-target"
        ? "هیچ مشتری‌ای با این فیلترها پیدا نشد. فیلترها را کمی بازتر کن."
        : params.error === "product"
          ? "فیلتر محصول آماده نیست یا خواندن کالاها با خطا روبه‌رو شد."
          : params.error === "members"
            ? "کمپین ساخته شد اما افزودن مشتریان کامل نشد؛ عملیات برگشت داده شد."
            : params.error === "save"
              ? "ذخیره کمپین انجام نشد."
              : params.error === "database"
                ? "خواندن اطلاعات مشتریان با خطا روبه‌رو شد."
                : null;

  const typedCampaigns = (campaigns ?? []) as CampaignSummary[];
  const activeCampaigns = typedCampaigns.filter((item: CampaignSummary) => item.status === "active");
  const totalOrders = typedCampaigns.reduce(
    (sum: number, item: CampaignSummary) => sum + numeric(item.ordered_count),
    0,
  );
  const totalOrderValue = typedCampaigns.reduce(
    (sum: number, item: CampaignSummary) => sum + numeric(item.order_value),
    0,
  );

  return (
    <AppShell
      active="campaigns"
      title="مرکز کمپین فروش"
      subtitle="مشتریان هدف را انتخاب کن، نتیجه تماس‌ها را ثبت کن و فروش حاصل از هر کمپین را اندازه بگیر."
    >
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {error ? (
        <div className={styles.alert}>
          ابتدا فایل SQL مرحله ۱۳ را اجرا کن. جزئیات: {error.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div>
          <span>موتور پیگیری فروش امیدمِد</span>
          <h2>هر تماس را به یک نتیجه قابل‌اندازه‌گیری تبدیل کن</h2>
          <p>
            کمپین بساز، مشتریان مناسب را بر اساس سابقه خرید انتخاب کن و ببین کدام پیام یا تماس واقعاً سفارش ایجاد کرده است.
          </p>
        </div>
        <Link href="/quotes" className={styles.quoteLink}>
          <Icon name="quote" size={20} /> پیگیری قیمت‌های باز
        </Link>
      </section>

      <section className={styles.metrics}>
        <article><span>کمپین فعال</span><strong>{number.format(activeCampaigns.length)}</strong></article>
        <article><span>کل سفارش‌های کمپین</span><strong>{number.format(totalOrders)}</strong></article>
        <article><span>فروش ثبت‌شده کمپین‌ها</span><strong>{formatMoney(totalOrderValue)}</strong></article>
      </section>

      <section className={styles.layout}>
        <article className={styles.formCard}>
          <header>
            <div className={styles.iconBox}><Icon name="campaign" size={22} /></div>
            <div>
              <h3>ساخت کمپین جدید</h3>
              <p>فیلترها روی اطلاعات واقعی مشتریان و خریدهای هلو اعمال می‌شوند.</p>
            </div>
          </header>

          <form action={createCampaign} className={styles.form}>
            <label className={styles.full}>
              نام کمپین
              <input name="name" required maxLength={140} placeholder="مثلاً بازگشت خریداران پد فرانسوی" />
            </label>

            <label>
              نوع کمپین
              <select name="campaign_type" defaultValue="reactivation">
                {Object.entries(campaignTypeLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>

            <label>
              روش ارتباط
              <select name="channel" defaultValue="phone">
                {Object.entries(campaignChannelLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>

            <label>
              حداقل روز بدون خرید
              <input name="min_days_inactive" type="number" min="0" max="3650" defaultValue="45" />
            </label>

            <label>
              اولویت مشتری
              <select name="priority_filter" defaultValue="urgent">
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>

            <label>
              محصول هدف
              <input name="target_product" maxLength={120} placeholder="مثلاً پد فرانسوی" />
            </label>

            <label>
              شهر هدف
              <input name="target_city" maxLength={100} placeholder="مثلاً تهران" />
            </label>

            <label className={styles.full}>
              متن پیشنهادی پیام یا تماس
              <textarea
                name="message_template"
                rows={5}
                maxLength={3000}
                defaultValue="سلام و وقت بخیر. مدتی از آخرین سفارش مجموعه شما گذشته است. برای بررسی موجودی و اطلاع از شرایط جدید امیدمِد در خدمتتان هستیم."
              />
            </label>

            <label className={styles.full}>
              یادداشت داخلی
              <textarea name="notes" rows={2} maxLength={1500} placeholder="هدف یا شرایط ویژه این کمپین..." />
            </label>

            <button className={styles.submit} type="submit">
              ساخت کمپین و افزودن مشتریان هدف
            </button>
          </form>
        </article>

        <article className={styles.listCard}>
          <header className={styles.listHeader}>
            <div>
              <h3>کمپین‌های اخیر</h3>
              <p>نرخ تبدیل و فروش هر کمپین را مقایسه کن.</p>
            </div>
            <span>{number.format(typedCampaigns.length)} کمپین</span>
          </header>

          {typedCampaigns.length ? (
            <div className={styles.campaignList}>
              {typedCampaigns.map((campaign: CampaignSummary) => (
                <Link href={`/campaigns/${campaign.id}`} className={styles.campaignRow} key={campaign.id}>
                  <div className={styles.rowTop}>
                    <div>
                      <strong>{campaign.name}</strong>
                      <span>{campaignTypeLabels[campaign.campaign_type] ?? campaign.campaign_type}</span>
                    </div>
                    <b className={`${styles.status} ${styles[campaign.status]}`}>
                      {campaignStatusLabels[campaign.status] ?? campaign.status}
                    </b>
                  </div>
                  <div className={styles.rowStats}>
                    <span>هدف: <b>{number.format(numeric(campaign.target_count))}</b></span>
                    <span>تماس: <b>{number.format(numeric(campaign.contacted_count))}</b></span>
                    <span>سفارش: <b>{number.format(numeric(campaign.ordered_count))}</b></span>
                    <span>تبدیل: <b>{number.format(numeric(campaign.conversion_rate))}٪</b></span>
                  </div>
                  <div className={styles.rowFooter}>
                    <span>{campaign.target_product || campaign.target_city || "بدون فیلتر محصول و شهر"}</span>
                    <span>{formatDate(campaign.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <Icon name="campaign" size={32} />
              <h4>هنوز کمپینی نساخته‌ای</h4>
              <p>فرم روبه‌رو را پر کن تا اولین فهرست هدف فروش ایجاد شود.</p>
            </div>
          )}
        </article>
      </section>
    </AppShell>
  );
}
