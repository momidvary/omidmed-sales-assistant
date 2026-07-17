import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import AppShell, { Icon } from "@/components/app-shell";
import SingleSmsComposer from "@/components/sms/single-sms-composer";
import {
  addTehranDaysAtTen,
  nextOpportunityStep,
  normalizePhoneForLink,
} from "@/lib/campaigns/constants";
import { createClient } from "@/lib/supabase/server";
import styles from "./sales.module.css";

const number = new Intl.NumberFormat("fa-IR");

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  status: string;
  priority: string;
  lead_stage: string | null;
  potential_value: number | string | null;
  total_sales: number | string | null;
  next_followup_at: string | null;
  created_at: string;
};

type OpportunityRow = {
  id: string;
  customer_id: string;
  status: string;
  stage: string;
  product_interest: string | null;
  quoted_at: string;
  last_contact_at: string | null;
  next_followup_at: string | null;
  estimated_value: number | string | null;
  final_value: number | string | null;
  notes: string | null;
  created_at: string;
};

type PipelineKey =
  | "new"
  | "contacted"
  | "interested"
  | "quoted"
  | "decision"
  | "won"
  | "lost";

type PipelineItem = {
  key: string;
  kind: "customer" | "opportunity";
  customer: CustomerRow;
  opportunity: OpportunityRow | null;
  column: PipelineKey;
  value: number;
  date: string;
};

const columns: Array<{
  key: PipelineKey;
  title: string;
  subtitle: string;
}> = [
  {
    key: "new",
    title: "سرنخ جدید",
    subtitle: "هنوز تماس مؤثر انجام نشده",
  },
  {
    key: "contacted",
    title: "تماس اولیه",
    subtitle: "معرفی انجام شده و نیاز به ادامه دارد",
  },
  {
    key: "interested",
    title: "علاقه‌مند",
    subtitle: "نیاز و محصول هدف مشخص شده",
  },
  {
    key: "quoted",
    title: "قیمت ارسال شد",
    subtitle: "قیمت دریافت کرده و منتظر پیگیری است",
  },
  {
    key: "decision",
    title: "در حال تصمیم",
    subtitle: "مذاکره و پیگیری نهایی",
  },
  {
    key: "won",
    title: "سفارش شد",
    subtitle: "فرصت‌های تبدیل‌شده به خرید",
  },
  {
    key: "lost",
    title: "از دست رفته",
    subtitle: "فعلاً تبدیل نشده یا بسته شده",
  },
];

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

function formatMoney(
  value: number | string | null | undefined,
) {
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

function isDue(value: string | null | undefined) {
  return Boolean(
    value && new Date(value).getTime() <= Date.now(),
  );
}

function nextProspectStage(stage: string | null) {
  if (!stage || stage === "new") {
    return {
      stage: "contacted",
      label: "ثبت تماس اولیه",
      outcome: "follow_up_later",
      nextFollowupAt: addTehranDaysAtTen(3),
    };
  }

  if (stage === "contacted") {
    return {
      stage: "interested",
      label: "ثبت علاقه‌مندی",
      outcome: "follow_up_later",
      nextFollowupAt: addTehranDaysAtTen(3),
    };
  }

  if (stage === "interested") {
    return {
      stage: "quoted",
      label: "ثبت ارسال قیمت",
      outcome: "requested_price",
      nextFollowupAt: addTehranDaysAtTen(1),
    };
  }

  if (stage === "quoted") {
    return {
      stage: "decision",
      label: "ورود به تصمیم‌گیری",
      outcome: "follow_up_later",
      nextFollowupAt: addTehranDaysAtTen(3),
    };
  }

  return {
    stage: "converted",
    label: "ثبت سفارش",
    outcome: "order_placed",
    nextFollowupAt: null,
  };
}

async function advanceProspect(formData: FormData) {
  "use server";

  const customerId = String(
    formData.get("customer_id") ?? "",
  ).trim();
  const action = String(formData.get("action") ?? "").trim();

  if (!customerId || !["next", "lost"].includes(action)) {
    redirect("/sales?error=invalid");
  }

  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers")
    .select("status,lead_stage,potential_value")
    .eq("id", customerId)
    .single();

  if (error || !customer) {
    redirect("/sales?error=missing");
  }

  const transition =
    action === "lost"
      ? {
          stage: "lost",
          outcome: "lost",
          nextFollowupAt: null,
          label: "از دست رفته",
        }
      : nextProspectStage(customer.lead_stage);

  const { error: followupError } = await supabase
    .from("followups")
    .insert({
      customer_id: customerId,
      channel: "phone",
      outcome: transition.outcome,
      notes: `تغییر مرحله از قیف فروش: ${transition.label}`,
      next_followup_at: transition.nextFollowupAt,
      potential_value: customer.potential_value,
    });

  if (followupError) {
    redirect("/sales?error=followup");
  }

  const update: Record<string, unknown> = {
    lead_stage: transition.stage,
    next_followup_at: transition.nextFollowupAt,
  };

  if (transition.stage === "converted") {
    update.status = "active";
  } else if (transition.stage === "lost") {
    update.status = "lost";
  } else {
    update.status = "prospect";
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update(update)
    .eq("id", customerId);

  if (updateError) {
    redirect("/sales?error=save");
  }

  revalidatePath("/");
  revalidatePath("/sales");
  revalidatePath("/quotes");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  redirect(`/sales?saved=${transition.stage}`);
}

async function advanceOpportunity(formData: FormData) {
  "use server";

  const opportunityId = String(
    formData.get("opportunity_id") ?? "",
  ).trim();
  const customerId = String(
    formData.get("customer_id") ?? "",
  ).trim();
  const action = String(formData.get("action") ?? "").trim();

  if (
    !opportunityId ||
    !customerId ||
    !["next", "won", "lost", "hold"].includes(action)
  ) {
    redirect("/sales?error=invalid");
  }

  const supabase = await createClient();
  const { data: opportunity, error } = await supabase
    .from("sales_opportunities")
    .select("status,stage,estimated_value")
    .eq("id", opportunityId)
    .single();

  if (error || !opportunity) {
    redirect("/sales?error=missing");
  }

  const now = new Date().toISOString();
  let status = opportunity.status;
  let stage = opportunity.stage;
  let nextFollowupAt: string | null = null;
  let outcome = "follow_up_later";
  let notes = "پیگیری مرحله بعد از قیف فروش.";

  if (action === "next") {
    const next = nextOpportunityStep(opportunity.stage);
    status = "open";
    stage = next.stage;
    nextFollowupAt = next.nextFollowupAt;
  } else if (action === "won") {
    status = "won";
    outcome = "order_placed";
    notes = "فرصت فروش از قیف به سفارش تبدیل شد.";
  } else if (action === "lost") {
    status = "lost";
    outcome = "lost";
    notes = "فرصت فروش از قیف خارج و از دست رفته ثبت شد.";
  } else {
    status = "on_hold";
    outcome = "no_need";
    nextFollowupAt = addTehranDaysAtTen(30);
    notes = "فرصت فروش برای ۳۰ روز در حالت تعلیق قرار گرفت.";
  }

  const { error: updateError } = await supabase
    .from("sales_opportunities")
    .update({
      status,
      stage,
      last_contact_at: now,
      next_followup_at: nextFollowupAt,
      final_value:
        action === "won"
          ? opportunity.estimated_value
          : null,
      lost_reason: action === "lost" ? "other" : null,
      notes,
    })
    .eq("id", opportunityId);

  if (updateError) {
    redirect("/sales?error=save");
  }

  const { error: followupError } = await supabase
    .from("followups")
    .insert({
      customer_id: customerId,
      channel: "phone",
      outcome,
      notes,
      next_followup_at: nextFollowupAt,
      potential_value: opportunity.estimated_value,
      opportunity_id: opportunityId,
    });

  if (followupError) {
    redirect("/sales?error=followup");
  }

  const customerUpdate: Record<string, unknown> = {
    next_followup_at: nextFollowupAt,
  };

  if (action === "won") {
    customerUpdate.status = "active";
    customerUpdate.lead_stage = "converted";
  } else if (action === "lost") {
    customerUpdate.status = "lost";
    customerUpdate.lead_stage = "lost";
  } else if (action === "next") {
    customerUpdate.lead_stage = "decision";
  }

  await supabase
    .from("customers")
    .update(customerUpdate)
    .eq("id", customerId);

  revalidatePath("/");
  revalidatePath("/sales");
  revalidatePath("/quotes");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  redirect(`/sales?saved=${action}`);
}

export default async function SalesPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const search = (params.q ?? "")
    .trim()
    .toLocaleLowerCase("fa");
  const supabase = await createClient();

  const [customersResult, opportunitiesResult] =
    await Promise.all([
      supabase
        .from("customer_crm_summary")
        .select(
          "id,name,phone,city,status,priority,lead_stage,potential_value,total_sales,next_followup_at,created_at",
        )
        .is("archived_at", null)
        .limit(2500),
      supabase
        .from("sales_opportunities")
        .select(
          "id,customer_id,status,stage,product_interest,quoted_at,last_contact_at,next_followup_at,estimated_value,final_value,notes,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(2500),
    ]);

  const customers = (customersResult.data ?? []) as CustomerRow[];
  const opportunities = (opportunitiesResult.data ??
    []) as OpportunityRow[];

  const customerMap = new Map(
    customers.map((customer) => [customer.id, customer]),
  );

  const activeOpportunityCustomerIds = new Set(
    opportunities
      .filter(
        (item) =>
          item.status === "open" ||
          item.status === "on_hold",
      )
      .map((item) => item.customer_id),
  );

  const items: PipelineItem[] = [];

  for (const customer of customers) {
    if (
      customer.status !== "prospect" &&
      customer.status !== "lost"
    ) {
      continue;
    }

    if (
      customer.status === "prospect" &&
      activeOpportunityCustomerIds.has(customer.id)
    ) {
      continue;
    }

    const stage = customer.lead_stage || "new";
    const column: PipelineKey =
      customer.status === "lost" || stage === "lost"
        ? "lost"
        : stage === "contacted"
          ? "contacted"
          : stage === "interested"
            ? "interested"
            : stage === "quoted"
              ? "quoted"
              : stage === "decision"
                ? "decision"
                : "new";

    items.push({
      key: `customer-${customer.id}`,
      kind: "customer",
      customer,
      opportunity: null,
      column,
      value: numeric(customer.potential_value),
      date: customer.created_at,
    });
  }

  for (const opportunity of opportunities) {
    const customer = customerMap.get(opportunity.customer_id);
    if (!customer) continue;

    const column: PipelineKey =
      opportunity.status === "won"
        ? "won"
        : opportunity.status === "lost"
          ? "lost"
          : opportunity.stage === "quote_sent"
            ? "quoted"
            : "decision";

    items.push({
      key: `opportunity-${opportunity.id}`,
      kind: "opportunity",
      customer,
      opportunity,
      column,
      value:
        opportunity.status === "won"
          ? numeric(
              opportunity.final_value ||
                opportunity.estimated_value,
            )
          : numeric(opportunity.estimated_value),
      date:
        opportunity.last_contact_at ||
        opportunity.quoted_at ||
        opportunity.created_at,
    });
  }

  const filteredItems = items.filter((item) => {
    if (!search) return true;

    return `${item.customer.name} ${
      item.customer.phone ?? ""
    } ${item.customer.city ?? ""} ${
      item.opportunity?.product_interest ?? ""
    }`
      .toLocaleLowerCase("fa")
      .includes(search);
  });

  const itemsByColumn = new Map<
    PipelineKey,
    PipelineItem[]
  >();

  for (const column of columns) {
    itemsByColumn.set(column.key, []);
  }

  for (const item of filteredItems) {
    itemsByColumn.get(item.column)?.push(item);
  }

  for (const rows of itemsByColumn.values()) {
    rows.sort((a, b) => {
      const dueDifference =
        Number(isDue(b.opportunity?.next_followup_at)) -
        Number(isDue(a.opportunity?.next_followup_at));

      if (dueDifference) return dueDifference;
      if (b.value !== a.value) return b.value - a.value;

      return (
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
      );
    });
  }

  const activeOpportunities = opportunities.filter(
    (item) =>
      item.status === "open" ||
      item.status === "on_hold",
  );
  const dueOpportunities = activeOpportunities.filter((item) =>
    isDue(item.next_followup_at),
  );
  const pipelineValue = activeOpportunities.reduce(
    (sum, item) => sum + numeric(item.estimated_value),
    0,
  );
  const wonOpportunities = opportunities.filter(
    (item) => item.status === "won",
  );
  const wonValue = wonOpportunities.reduce(
    (sum, item) =>
      sum +
      numeric(item.final_value || item.estimated_value),
    0,
  );
  const prospectCount = customers.filter(
    (item) => item.status === "prospect",
  ).length;

  const errorMessage =
    params.error === "invalid"
      ? "اطلاعات تغییر مرحله معتبر نبود."
      : params.error === "missing"
        ? "مشتری یا فرصت فروش پیدا نشد."
        : params.error === "save"
          ? "ذخیره مرحله جدید انجام نشد."
          : params.error === "followup"
            ? "مرحله تغییر کرد اما سابقه پیگیری ثبت نشد."
            : null;

  return (
    <AppShell
      active="sales"
      title="قیف کامل فروش"
      subtitle="مشتری بالقوه را از تماس اولیه تا قیمت، تصمیم و سفارش در یک جریان مشخص مدیریت کن."
    >
      {params.saved ? (
        <div className={styles.success}>
          مرحله قیف فروش با موفقیت به‌روزرسانی شد.
        </div>
      ) : null}

      {errorMessage ? (
        <div className={styles.error}>{errorMessage}</div>
      ) : null}

      {customersResult.error || opportunitiesResult.error ? (
        <div className={styles.error}>
          خواندن قیف فروش انجام نشد:{" "}
          {customersResult.error?.message ||
            opportunitiesResult.error?.message}
        </div>
      ) : null}

      <section className={styles.hero}>
        <div>
          <span>مدیریت جریان فروش</span>
          <h2>
            هر مشتری باید یک مرحله و یک اقدام بعدی داشته باشد
          </h2>
          <p>
            سرنخ‌ها و قیمت‌های باز را مرحله‌به‌مرحله جلو ببر؛
            نتیجه تماس در پرونده مشتری و میز کار امروز نیز
            ثبت می‌شود.
          </p>
        </div>

        <div className={styles.heroActions}>
          <Link href="/customers/new?type=prospect">
            + افزودن مشتری بالقوه
          </Link>
          <Link href="/">مرکز فروش امروز</Link>
        </div>
      </section>

      <section className={styles.metrics}>
        <article>
          <span>مشتریان بالقوه</span>
          <strong>{number.format(prospectCount)}</strong>
          <small>سرنخ فعال در بانک مشتریان</small>
        </article>

        <article>
          <span>فرصت باز</span>
          <strong>
            {number.format(activeOpportunities.length)}
          </strong>
          <small>
            {number.format(dueOpportunities.length)} مورد موعددار
          </small>
        </article>

        <article>
          <span>ارزش قیف فعال</span>
          <strong>{formatMoney(pipelineValue)}</strong>
          <small>تومان</small>
        </article>

        <article>
          <span>سفارش‌های تبدیل‌شده</span>
          <strong>
            {number.format(wonOpportunities.length)}
          </strong>
          <small>{formatMoney(wonValue)} تومان</small>
        </article>
      </section>

      <form className={styles.searchBar} method="get">
        <Icon name="search" size={19} />
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="جست‌وجوی نام، شماره، شهر یا محصول..."
        />
        <button type="submit">جست‌وجو</button>
        {search ? <Link href="/sales">پاک‌کردن</Link> : null}
      </form>

      <section className={styles.board}>
        {columns.map((column) => {
          const columnItems =
            itemsByColumn.get(column.key) ?? [];
          const columnValue = columnItems.reduce(
            (sum, item) => sum + item.value,
            0,
          );

          return (
            <article
              className={styles.column}
              key={column.key}
            >
              <header>
                <div>
                  <h3>{column.title}</h3>
                  <p>{column.subtitle}</p>
                </div>

                <span>
                  {number.format(columnItems.length)}
                </span>
              </header>

              <div className={styles.columnValue}>
                ارزش این مرحله:{" "}
                <b>{formatMoney(columnValue)} تومان</b>
              </div>

              <div className={styles.cards}>
                {columnItems.slice(0, 40).map((item) => {
                  const phoneLink = normalizePhoneForLink(
                    item.customer.phone,
                  );
                  const nextProspect = nextProspectStage(
                    item.customer.lead_stage,
                  );
                  const due = isDue(
                    item.opportunity?.next_followup_at ||
                      item.customer.next_followup_at,
                  );

                  return (
                    <div
                      className={`${styles.card} ${
                        due ? styles.dueCard : ""
                      }`}
                      key={item.key}
                    >
                      <div className={styles.cardTop}>
                        <div>
                          <Link
                            href={`/customers/${item.customer.id}`}
                          >
                            {item.customer.name}
                          </Link>
                          <small>
                            {item.customer.city ||
                              "شهر ثبت نشده"}
                          </small>
                        </div>

                        <span
                          className={`${styles.priority} ${
                            styles[item.customer.priority]
                          }`}
                        >
                          {priorityLabels[
                            item.customer.priority
                          ] ?? item.customer.priority}
                        </span>
                      </div>

                      <dl>
                        <div>
                          <dt>ارزش</dt>
                          <dd>
                            {formatMoney(item.value)} تومان
                          </dd>
                        </div>

                        <div>
                          <dt>محصول هدف</dt>
                          <dd>
                            {item.opportunity
                              ?.product_interest ||
                              "ثبت نشده"}
                          </dd>
                        </div>

                        <div>
                          <dt>پیگیری بعدی</dt>
                          <dd
                            className={
                              due ? styles.dueText : ""
                            }
                          >
                            {formatDateTime(
                              item.opportunity
                                ?.next_followup_at ||
                                item.customer
                                  .next_followup_at,
                            )}
                          </dd>
                        </div>
                      </dl>

                      {item.opportunity?.notes ? (
                        <p>{item.opportunity.notes}</p>
                      ) : null}

                      <div className={styles.cardActions}>
                        {phoneLink ? (
                          <a href={`tel:${phoneLink}`}>
                            تماس
                          </a>
                        ) : null}

                        <SingleSmsComposer
                          customerId={item.customer.id}
                          customerName={item.customer.name}
                          phone={item.customer.phone}
                          source={
                            item.opportunity
                              ? "quote"
                              : "customer"
                          }
                          opportunityId={
                            item.opportunity?.id
                          }
                          compact
                        />

                        <Link
                          href={`/customers/${item.customer.id}`}
                        >
                          پرونده
                        </Link>
                      </div>

                      <div className={styles.stageActions}>
                        {item.kind === "customer" ? (
                          <>
                            {item.column !== "lost" ? (
                              <form action={advanceProspect}>
                                <input
                                  type="hidden"
                                  name="customer_id"
                                  value={item.customer.id}
                                />
                                <input
                                  type="hidden"
                                  name="action"
                                  value="next"
                                />
                                <button type="submit">
                                  {nextProspect.label}
                                </button>
                              </form>
                            ) : null}

                            {item.column !== "lost" ? (
                              <form action={advanceProspect}>
                                <input
                                  type="hidden"
                                  name="customer_id"
                                  value={item.customer.id}
                                />
                                <input
                                  type="hidden"
                                  name="action"
                                  value="lost"
                                />
                                <button
                                  className={styles.dangerAction}
                                  type="submit"
                                >
                                  از دست رفت
                                </button>
                              </form>
                            ) : null}
                          </>
                        ) : item.column !== "won" &&
                          item.column !== "lost" ? (
                          <>
                            <form action={advanceOpportunity}>
                              <input
                                type="hidden"
                                name="opportunity_id"
                                value={item.opportunity?.id}
                              />
                              <input
                                type="hidden"
                                name="customer_id"
                                value={item.customer.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="next"
                              />
                              <button type="submit">
                                ثبت پیگیری بعد
                              </button>
                            </form>

                            <form action={advanceOpportunity}>
                              <input
                                type="hidden"
                                name="opportunity_id"
                                value={item.opportunity?.id}
                              />
                              <input
                                type="hidden"
                                name="customer_id"
                                value={item.customer.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="won"
                              />
                              <button
                                className={styles.wonAction}
                                type="submit"
                              >
                                سفارش شد
                              </button>
                            </form>

                            <form action={advanceOpportunity}>
                              <input
                                type="hidden"
                                name="opportunity_id"
                                value={item.opportunity?.id}
                              />
                              <input
                                type="hidden"
                                name="customer_id"
                                value={item.customer.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="hold"
                              />
                              <button type="submit">
                                ۳۰ روز بعد
                              </button>
                            </form>

                            <form action={advanceOpportunity}>
                              <input
                                type="hidden"
                                name="opportunity_id"
                                value={item.opportunity?.id}
                              />
                              <input
                                type="hidden"
                                name="customer_id"
                                value={item.customer.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="lost"
                              />
                              <button
                                className={styles.dangerAction}
                                type="submit"
                              >
                                از دست رفت
                              </button>
                            </form>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {columnItems.length === 0 ? (
                  <div className={styles.emptyColumn}>
                    موردی در این مرحله نیست.
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </AppShell>
  );
}
