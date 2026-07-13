import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import styles from "./customer.module.css";
import JalaliDateTimeField from "./jalali-date-time-field";
import CustomerFilesManager, {
  type CustomerFileRecord,
} from "./customer-files-manager";
import { getCurrentJalaliDate, parseJalaliTehranDateTime } from "@/lib/jalali";

const number = new Intl.NumberFormat("fa-IR");

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

const balanceLabels: Record<string, string> = {
  debtor: "بدهکار",
  creditor: "بستانکار",
  zero: "تسویه",
  unknown: "نامشخص",
};

function formatMoney(value: number | string | null) {
  return number.format(Math.round(Number(value ?? 0)));
}

function formatQuantity(value: number | string | null) {
  const numeric = Number(value ?? 0);
  return number.format(Number.isInteger(numeric) ? numeric : Number(numeric.toFixed(3)));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
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

async function saveFollowup(formData: FormData) {
  "use server";

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "phone").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  const nextFollowupResult = parseJalaliTehranDateTime({
    year: String(formData.get("next_followup_year") ?? ""),
    month: String(formData.get("next_followup_month") ?? ""),
    day: String(formData.get("next_followup_day") ?? ""),
    time: String(formData.get("next_followup_time") ?? ""),
  });
  const nextFollowupAt = nextFollowupResult.value;

  if (!customerId || !outcome) {
    redirect(`/customers/${customerId}?error=required`);
  }

  if (nextFollowupResult.error) {
    redirect(`/customers/${customerId}?error=invaliddate`);
  }

  const supabase = await createClient();
  const { error: insertError } = await supabase.from("followups").insert({
    customer_id: customerId,
    channel,
    outcome,
    notes: notes || null,
    next_followup_at: nextFollowupAt,
  });

  if (insertError) {
    redirect(`/customers/${customerId}?error=save`);
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update({ next_followup_at: nextFollowupAt })
    .eq("id", customerId);

  if (updateError) {
    redirect(`/customers/${customerId}?error=nextdate`);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  redirect(`/customers/${customerId}?saved=1`);
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error: queryError } = await searchParams;
  const supabase = await createClient();

  const [
    { data: customer, error: customerError },
    { data: followups, error: followupsError },
    { data: customerFiles, error: customerFilesError },
    { data: sales, error: salesError },
    { data: invoices, error: invoicesError },
    { data: productSummary, error: productSummaryError },
  ] = await Promise.all([
    supabase
      .from("customer_sales_summary")
      .select(
        "id,name,contact_name,phone,province,city,address,status,priority,notes,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
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
      .limit(20),
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
  ]);

  const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
  const { data: invoiceItems, error: invoiceItemsError } = invoiceIds.length
    ? await supabase
        .from("invoice_items")
        .select(
          "id,invoice_id,row_number,product_name,quantity,unit_price,line_total,description",
        )
        .in("invoice_id", invoiceIds)
        .order("row_number", { ascending: true })
    : { data: [], error: null };

  const typedInvoiceItems = (invoiceItems ?? []) as InvoiceItemRow[];
  const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
  for (const item of typedInvoiceItems) {
    const current = itemsByInvoice.get(item.invoice_id) ?? [];
    current.push(item);
    itemsByInvoice.set(item.invoice_id, current);
  }

  if (customerError || !customer) notFound();

  const phoneLink = normalizePhoneForLink(customer.phone);
  const currentJalaliYear = getCurrentJalaliDate().year;
  const errorMessage =
    queryError === "required"
      ? "نتیجه پیگیری را انتخاب کن."
      : queryError === "save"
        ? "ثبت پیگیری انجام نشد. دوباره تلاش کن."
        : queryError === "nextdate"
          ? "پیگیری ثبت شد، اما تاریخ تماس بعدی ذخیره نشد."
          : queryError === "invaliddate"
            ? "تاریخ پیگیری بعدی کامل یا معتبر نیست. سال، ماه، روز و ساعت را بررسی کن."
            : null;

  return (
    <AppShell
      active="customers"
      title={customer.name}
      subtitle="پرونده مشتری، سابقه خرید، فایل چاپ و پیگیری فروش"
    >
      <div className={styles.backRow}>
        <Link href="/customers">← بازگشت به بانک مشتریان</Link>
      </div>

      {saved ? (
        <div className={styles.success}>پیگیری با موفقیت ثبت شد.</div>
      ) : null}
      {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}
      {followupsError ? (
        <div className={styles.error}>
          خطا در خواندن سابقه پیگیری: {followupsError.message}
        </div>
      ) : null}
      {customerFilesError ? (
        <div className={styles.error}>
          بخش فایل‌ها هنوز آماده نیست. ابتدا فایل SQL مرحله پنجم را در Supabase اجرا کن.
        </div>
      ) : null}
      {invoicesError || productSummaryError || invoiceItemsError ? (
        <div className={styles.error}>
          جزئیات کالاهای فاکتورها هنوز آماده نیست. فایل SQL مرحله هشتم را در Supabase اجرا کن و سپس فاکتورها و اقلام را وارد کن.
        </div>
      ) : null}

      <section className={styles.summaryGrid}>
        <article className={styles.customerCard}>
          <div className={styles.cardHeader}>
            <div>
              <span>اطلاعات مشتری</span>
              <h2>{customer.name}</h2>
            </div>
            <span className={`${styles.priority} ${styles[customer.priority]}`}>
              اولویت {priorityLabels[customer.priority] ?? customer.priority}
            </span>
          </div>

          <dl className={styles.details}>
            <div>
              <dt>مسئول خرید</dt>
              <dd>{customer.contact_name || "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>شماره تماس</dt>
              <dd dir="ltr">{customer.phone || "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>شهر</dt>
              <dd>
                {[customer.province, customer.city].filter(Boolean).join("، ") ||
                  "ثبت نشده"}
              </dd>
            </div>
            <div>
              <dt>پیگیری بعدی</dt>
              <dd>{formatDateTime(customer.next_followup_at)}</dd>
            </div>
          </dl>

          <div className={styles.address}>
            <span>آدرس</span>
            <p>{customer.address || "آدرسی ثبت نشده است."}</p>
          </div>

          <div className={styles.contactActions}>
            {phoneLink ? (
              <a href={`tel:${phoneLink}`}>
                <Icon name="phone" size={17} /> تماس با مشتری
              </a>
            ) : (
              <span className={styles.disabledAction}>شماره تماس ندارد</span>
            )}
          </div>
        </article>

        <article className={styles.statsCard}>
          <span className={styles.sectionLabel}>خلاصه خرید</span>
          <div className={styles.stats}>
            <div>
              <span>جمع فروش ثبت‌شده</span>
              <strong>{formatMoney(customer.total_sales)}</strong>
            </div>
            <div>
              <span>تعداد خرید</span>
              <strong>{number.format(customer.purchase_count ?? 0)}</strong>
            </div>
            <div>
              <span>آخرین خرید</span>
              <strong>{formatDate(customer.last_purchase_at)}</strong>
            </div>
            <div>
              <span>روز از آخرین خرید</span>
              <strong>
                {customer.days_since_last_purchase == null
                  ? "—"
                  : number.format(customer.days_since_last_purchase)}
              </strong>
            </div>
            <div>
              <span>میانگین فاصله خرید</span>
              <strong>
                {customer.avg_purchase_gap_days == null
                  ? "—"
                  : `${number.format(Math.round(customer.avg_purchase_gap_days))} روز`}
              </strong>
            </div>
          </div>
          {customer.notes ? (
            <div className={styles.customerNotes}>
              <span>یادداشت کلی</span>
              <p>{customer.notes}</p>
            </div>
          ) : null}
        </article>
      </section>

      <section className={styles.mainGrid}>
        <article className={styles.formCard}>
          <div className={styles.sectionHeading}>
            <div className={styles.sectionIcon}>
              <Icon name="followup" size={20} />
            </div>
            <div>
              <h3>ثبت پیگیری جدید</h3>
              <p>بعد از تماس، نتیجه و زمان تماس بعدی را ثبت کن.</p>
            </div>
          </div>

          <form action={saveFollowup} className={styles.form}>
            <input type="hidden" name="customer_id" value={customer.id} />

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
              نتیجه پیگیری
              <select name="outcome" defaultValue="" required>
                <option value="" disabled>
                  انتخاب نتیجه...
                </option>
                <option value="no_answer">پاسخ نداد</option>
                <option value="requested_price">قیمت خواست</option>
                <option value="no_need">فعلاً نیاز ندارد</option>
                <option value="order_placed">سفارش ثبت شد</option>
                <option value="follow_up_later">بعداً پیگیری شود</option>
                <option value="payment_pending">پیگیری تسویه</option>
                <option value="lost">مشتری از دست رفته</option>
                <option value="other">سایر</option>
              </select>
            </label>

            <JalaliDateTimeField currentYear={currentJalaliYear} />

            <label>
              یادداشت تماس
              <textarea
                name="notes"
                rows={5}
                maxLength={2000}
                placeholder="مثلاً قیمت پک اسپانیایی خواست و گفت سه روز دیگر تماس بگیرم..."
              />
            </label>

            <button type="submit">
              <Icon name="check" size={18} /> ثبت نتیجه پیگیری
            </button>
          </form>
        </article>

        <article className={styles.historyCard}>
          <div className={styles.sectionHeading}>
            <div className={styles.sectionIcon}>
              <Icon name="calendar" size={20} />
            </div>
            <div>
              <h3>سابقه پیگیری‌ها</h3>
              <p>۲۰ پیگیری آخر این مشتری</p>
            </div>
          </div>

          {!followupsError && (followups?.length ?? 0) === 0 ? (
            <div className={styles.emptyHistory}>
              هنوز هیچ پیگیری برای این مشتری ثبت نشده است.
            </div>
          ) : (
            <div className={styles.timeline}>
              {(followups ?? []).map((followup) => (
                <div className={styles.timelineItem} key={followup.id}>
                  <span className={styles.timelineDot} />
                  <div className={styles.timelineContent}>
                    <div className={styles.timelineTop}>
                      <strong>
                        {outcomeLabels[followup.outcome] ?? followup.outcome}
                      </strong>
                      <time>{formatDateTime(followup.followup_at)}</time>
                    </div>
                    <span className={styles.channel}>
                      {channelLabels[followup.channel] ?? followup.channel}
                    </span>
                    {followup.notes ? <p>{followup.notes}</p> : null}
                    {followup.next_followup_at ? (
                      <div className={styles.nextDate}>
                        پیگیری بعدی: {formatDateTime(followup.next_followup_at)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {!productSummaryError && (productSummary?.length ?? 0) > 0 ? (
        <section className={styles.productSection}>
          <div className={styles.sectionHeading}>
            <div className={styles.productIcon}>کالا</div>
            <div>
              <h3>محصولات خریداری‌شده</h3>
              <p>۱۲ محصول اصلی این مشتری بر اساس مبلغ خرید</p>
            </div>
          </div>
          <div className={styles.productGrid}>
            {(productSummary ?? []).map((product) => (
              <article className={styles.productCard} key={product.product_name}>
                <strong>{product.product_name}</strong>
                <div>
                  <span>تعداد کل</span>
                  <b>{formatQuantity(product.total_quantity)}</b>
                </div>
                <div>
                  <span>مبلغ کل</span>
                  <b>{formatMoney(product.total_amount)}</b>
                </div>
                <small>آخرین خرید: {formatDate(product.last_purchase_at)}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!customerFilesError ? (
        <CustomerFilesManager
          customerId={customer.id}
          initialFiles={(customerFiles ?? []) as CustomerFileRecord[]}
        />
      ) : null}

      <section className={styles.invoiceSection}>
        <div className={styles.sectionHeading}>
          <div className={styles.invoiceIcon}>فاکتور</div>
          <div>
            <h3>فاکتورها و اقلام خریداری‌شده</h3>
            <p>آخرین ۵۰ فاکتور؛ هر فاکتور را باز کن تا کالاها دیده شوند.</p>
          </div>
        </div>

        {invoicesError ? (
          <div className={styles.inlineError}>
            خواندن جزئیات فاکتورها انجام نشد: {invoicesError.message}
          </div>
        ) : (invoices?.length ?? 0) === 0 ? (
          salesError ? (
            <div className={styles.inlineError}>
              خواندن فاکتورها انجام نشد: {salesError.message}
            </div>
          ) : (sales?.length ?? 0) === 0 ? (
            <div className={styles.emptyInvoices}>
              هنوز فاکتورهای هلو وارد نشده‌اند. از بخش ورود اطلاعات، ابتدا تیتر فاکتورها و سپس اقلام را وارد کن.
            </div>
          ) : (
            <div className={styles.invoiceTableWrap}>
              <table className={styles.invoiceTable}>
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
                  {(sales ?? []).map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDate(sale.sale_date)}</td>
                      <td dir="ltr">{sale.invoice_number || "—"}</td>
                      <td dir="ltr">{sale.document_number || "—"}</td>
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
            {(invoices ?? []).map((invoice, index) => {
              const items = itemsByInvoice.get(invoice.id) ?? [];
              return (
                <details className={styles.invoiceDetails} key={invoice.id} open={index === 0}>
                  <summary>
                    <div>
                      <strong>فاکتور {invoice.invoice_number}</strong>
                      <span>سند {invoice.document_number || "—"} · {formatDate(invoice.invoice_date)}</span>
                    </div>
                    <div className={styles.invoiceSummaryNumbers}>
                      <b>{formatMoney(invoice.total_amount)}</b>
                      <span>{formatQuantity(invoice.total_quantity)} واحد</span>
                    </div>
                  </summary>

                  <div className={styles.invoiceMeta}>
                    <span>وضعیت: <b>{invoice.transaction_status || "نامشخص"}</b></span>
                    <span>تخفیف: <b>{formatMoney(invoice.discount_amount)}</b></span>
                    <span>سررسید: <b>{formatDate(invoice.due_date)}</b></span>
                    <span>مانده: <b>{formatMoney(invoice.account_balance_amount)} ({balanceLabels[invoice.account_balance_status] ?? invoice.account_balance_status})</b></span>
                  </div>

                  {items.length ? (
                    <div className={styles.invoiceTableWrap}>
                      <table className={styles.invoiceTable}>
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
                              <td><strong>{item.product_name}</strong></td>
                              <td>{formatQuantity(item.quantity)}</td>
                              <td>{formatMoney(item.unit_price)}</td>
                              <td>{formatMoney(item.line_total)}</td>
                              <td>{item.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyItems}>اقلام این فاکتور هنوز وارد نشده‌اند.</div>
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
