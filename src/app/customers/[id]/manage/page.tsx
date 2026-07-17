import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  archiveCustomer,
  deleteCustomer,
  restoreCustomer,
  updateCustomer,
} from "../../actions";
import styles from "../../customer-form.module.css";

const statusLabels: Record<string, string> = {
  active: "مشتری فعال",
  inactive: "مشتری غیرفعال",
  prospect: "مشتری بالقوه",
  lost: "از دست رفته",
};

const errorMessages: Record<string, string> = {
  required: "نام مشتری و اطلاعات ضروری را بررسی کن.",
  duplicate:
    "این شماره موبایل برای مشتری دیگری ثبت شده است.",
  save: "ذخیره تغییرات انجام نشد.",
  archive: "بایگانی مشتری انجام نشد.",
  restore: "بازیابی مشتری انجام نشد.",
  confirmation:
    "نام واردشده با نام مشتری یکسان نیست؛ حذف لغو شد.",
  related:
    "این مشتری سابقه مرتبط دارد و حذف دائمی او مجاز نیست. از بایگانی استفاده کن.",
  check:
    "بررسی سوابق مشتری کامل نشد؛ برای جلوگیری از حذف اشتباه، عملیات متوقف شد.",
  delete: "حذف دائمی مشتری انجام نشد.",
};

function formatDateTimeLocal(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const map = new Map(
    parts.map((part) => [part.type, part.value]),
  );

  return `${map.get("year")}-${map.get("month")}-${map.get(
    "day",
  )}T${map.get("hour")}:${map.get("minute")}`;
}

export default async function ManageCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    restored?: string;
    error?: string;
    duplicate_id?: string;
    relation?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select(
      "id,name,contact_name,phone,province,city,address,preferred_products,status,priority,notes,next_followup_at,lead_stage,lead_source,potential_value,archived_at,imported_purchase_count,imported_total_sales",
    )
    .eq("id", id)
    .single();

  if (error || !customer) {
    notFound();
  }

  const errorMessage = query.error
    ? errorMessages[query.error] ??
      "عملیات انجام نشد."
    : null;

  return (
    <AppShell
      active="customers"
      title="ویرایش و مدیریت مشتری"
      subtitle={`مدیریت وضعیت، اطلاعات فروش و بایگانی ${customer.name}`}
    >
      <div className={styles.topActions}>
        <Link href={`/customers/${customer.id}`}>
          ← بازگشت به پرونده
        </Link>
        <Link href="/customers">بانک مشتریان</Link>
      </div>

      {query.saved ? (
        <div className={styles.success}>
          اطلاعات مشتری با موفقیت ذخیره شد.
        </div>
      ) : null}

      {query.restored ? (
        <div className={styles.success}>
          مشتری از بایگانی خارج شد.
        </div>
      ) : null}

      {errorMessage ? (
        <div className={styles.error}>
          {errorMessage}
          {query.relation ? ` سابقه: ${query.relation}` : ""}
          {query.duplicate_id ? (
            <>
              {" "}
              <Link href={`/customers/${query.duplicate_id}`}>
                مشاهده پرونده تکراری
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <form action={updateCustomer} className={styles.formCard}>
        <input
          type="hidden"
          name="customer_id"
          value={customer.id}
        />

        <div className={styles.formHeader}>
          <div>
            <span>پرونده مشتری</span>
            <h2>{customer.name}</h2>
          </div>

          <span
            className={
              customer.archived_at
                ? styles.archivedBadge
                : customer.status === "prospect"
                  ? styles.prospectBadge
                  : styles.customerBadge
            }
          >
            {customer.archived_at
              ? "بایگانی‌شده"
              : statusLabels[customer.status] ??
                customer.status}
          </span>
        </div>

        <div className={styles.grid}>
          <label className={styles.wide}>
            نام کلینیک یا مشتری *
            <input
              name="name"
              defaultValue={customer.name}
              required
              maxLength={180}
            />
          </label>

          <label>
            نام مسئول خرید
            <input
              name="contact_name"
              defaultValue={customer.contact_name ?? ""}
              maxLength={180}
            />
          </label>

          <label>
            شماره موبایل
            <input
              name="phone"
              defaultValue={customer.phone ?? ""}
              inputMode="tel"
              dir="ltr"
              maxLength={40}
            />
          </label>

          <label>
            وضعیت مشتری
            <select name="status" defaultValue={customer.status}>
              <option value="active">فعال</option>
              <option value="prospect">بالقوه</option>
              <option value="inactive">غیرفعال</option>
              <option value="lost">از دست رفته</option>
            </select>
          </label>

          <label>
            مرحله قیف فروش
            <select
              name="lead_stage"
              defaultValue={customer.lead_stage ?? ""}
            >
              <option value="">بدون مرحله</option>
              <option value="new">جدید</option>
              <option value="contacted">
                تماس گرفته شد
              </option>
              <option value="interested">علاقه‌مند</option>
              <option value="quoted">قیمت ارسال شد</option>
              <option value="decision">
                در حال تصمیم‌گیری
              </option>
              <option value="converted">
                تبدیل به مشتری
              </option>
              <option value="lost">از دست رفته</option>
            </select>
          </label>

          <label>
            اولویت
            <select
              name="priority"
              defaultValue={customer.priority}
            >
              <option value="low">کم</option>
              <option value="normal">متوسط</option>
              <option value="high">زیاد</option>
              <option value="vip">ویژه</option>
            </select>
          </label>

          <label>
            منبع آشنایی
            <input
              name="lead_source"
              defaultValue={customer.lead_source ?? ""}
              maxLength={180}
            />
          </label>

          <label>
            ارزش احتمالی خرید، تومان
            <input
              name="potential_value"
              defaultValue={
                customer.potential_value == null
                  ? ""
                  : String(customer.potential_value)
              }
              inputMode="numeric"
              dir="ltr"
            />
          </label>

          <label>
            زمان پیگیری بعدی
            <input
              type="datetime-local"
              name="next_followup_at"
              defaultValue={formatDateTimeLocal(
                customer.next_followup_at,
              )}
            />
          </label>

          <label>
            استان
            <input
              name="province"
              defaultValue={customer.province ?? ""}
              maxLength={100}
            />
          </label>

          <label>
            شهر
            <input
              name="city"
              defaultValue={customer.city ?? ""}
              maxLength={100}
            />
          </label>

          <label className={styles.wide}>
            محصولات موردعلاقه
            <input
              name="preferred_products"
              defaultValue={(
                customer.preferred_products ?? []
              ).join("، ")}
            />
          </label>

          <label className={styles.wide}>
            آدرس
            <textarea
              name="address"
              rows={3}
              maxLength={1000}
              defaultValue={customer.address ?? ""}
            />
          </label>

          <label className={styles.wide}>
            یادداشت فروش
            <textarea
              name="notes"
              rows={5}
              maxLength={3000}
              defaultValue={customer.notes ?? ""}
            />
          </label>
        </div>

        <div className={styles.formActions}>
          <Link href={`/customers/${customer.id}`}>
            انصراف
          </Link>
          <button type="submit">ذخیره تغییرات</button>
        </div>
      </form>

      <section className={styles.managementCard}>
        <div>
          <span>مدیریت نمایش مشتری</span>
          <h3>
            {customer.archived_at
              ? "بازیابی از بایگانی"
              : "بایگانی مشتری"}
          </h3>
          <p>
            بایگانی، پرونده و تمام سوابق فروش، پیامک و
            پیگیری را نگه می‌دارد.
          </p>
        </div>

        <form
          action={
            customer.archived_at
              ? restoreCustomer
              : archiveCustomer
          }
        >
          <input
            type="hidden"
            name="customer_id"
            value={customer.id}
          />
          <button className={styles.archiveButton} type="submit">
            {customer.archived_at
              ? "بازیابی مشتری"
              : "بایگانی مشتری"}
          </button>
        </form>
      </section>

      <section className={styles.dangerZone}>
        <div>
          <span>منطقه حساس</span>
          <h3>حذف دائمی مشتری اشتباهی</h3>
          <p>
            حذف فقط زمانی انجام می‌شود که مشتری هیچ فاکتور،
            فروش، پیامک، پیگیری، فایل یا سابقه مرتبطی نداشته
            باشد.
          </p>
        </div>

        <form action={deleteCustomer}>
          <input
            type="hidden"
            name="customer_id"
            value={customer.id}
          />

          <label>
            برای تأیید، دقیقاً بنویس:
            <strong>{customer.name}</strong>
            <input
              name="confirm_name"
              autoComplete="off"
              required
            />
          </label>

          <button type="submit">
            حذف دائمی مشتری اشتباهی
          </button>
        </form>
      </section>
    </AppShell>
  );
}
