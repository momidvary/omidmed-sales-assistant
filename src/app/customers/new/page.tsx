import Link from "next/link";
import AppShell from "@/components/app-shell";
import { createCustomer } from "../actions";
import styles from "../customer-form.module.css";

const errorMessages: Record<string, string> = {
  name: "نام مشتری یا کلینیک را وارد کن.",
  duplicate:
    "این شماره موبایل از قبل در بانک مشتریان وجود دارد. پرونده موجود را ویرایش کن.",
  save: "ثبت مشتری انجام نشد. اطلاعات را بررسی و دوباره تلاش کن.",
};

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    error?: string;
    duplicate_id?: string;
    message?: string;
  }>;
}) {
  const params = await searchParams;
  const isProspect = params.type === "prospect";
  const errorMessage = params.error
    ? errorMessages[params.error] ?? "ثبت اطلاعات انجام نشد."
    : null;

  return (
    <AppShell
      active="customers"
      title={isProspect ? "افزودن مشتری بالقوه" : "افزودن مشتری"}
      subtitle={
        isProspect
          ? "کلینیکی را ثبت کن که هنوز خرید نکرده و باید وارد قیف فروش شود."
          : "مشتری جدید را بدون نیاز به فایل هلو به بانک اضافه کن."
      }
    >
      <div className={styles.topActions}>
        <Link href="/customers">← بازگشت به بانک مشتریان</Link>
      </div>

      {errorMessage ? (
        <div className={styles.error}>
          {errorMessage}
          {params.duplicate_id ? (
            <>
              {" "}
              <Link href={`/customers/${params.duplicate_id}`}>
                بازکردن پرونده موجود
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <form action={createCustomer} className={styles.formCard}>
        <div className={styles.formHeader}>
          <div>
            <span>ثبت دستی</span>
            <h2>
              {isProspect
                ? "مشخصات سرنخ فروش"
                : "مشخصات مشتری"}
            </h2>
          </div>

          <span
            className={
              isProspect
                ? styles.prospectBadge
                : styles.customerBadge
            }
          >
            {isProspect ? "مشتری بالقوه" : "مشتری فعلی"}
          </span>
        </div>

        <input
          type="hidden"
          name="status"
          value={isProspect ? "prospect" : "active"}
        />

        <input
          type="hidden"
          name="lead_stage"
          value={isProspect ? "new" : "converted"}
        />

        <div className={styles.grid}>
          <label className={styles.wide}>
            نام کلینیک یا مشتری *
            <input
              name="name"
              required
              maxLength={180}
              placeholder="مثلاً کلینیک فیزیوتراپی بهبود"
            />
          </label>

          <label>
            نام مسئول خرید
            <input
              name="contact_name"
              maxLength={180}
              placeholder="نام شخص پاسخ‌گو"
            />
          </label>

          <label>
            شماره موبایل
            <input
              name="phone"
              inputMode="tel"
              dir="ltr"
              maxLength={40}
              placeholder="09xxxxxxxxx"
            />
          </label>

          <label>
            استان
            <input name="province" maxLength={100} />
          </label>

          <label>
            شهر
            <input name="city" maxLength={100} />
          </label>

          <label>
            اولویت
            <select name="priority" defaultValue="normal">
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
              maxLength={180}
              placeholder="اینستاگرام، معرفی، نمایشگاه، تماس سرد..."
            />
          </label>

          <label>
            ارزش احتمالی خرید، تومان
            <input
              name="potential_value"
              inputMode="numeric"
              dir="ltr"
              placeholder="مثلاً 10000000"
            />
          </label>

          <label>
            زمان پیگیری بعدی
            <input
              type="datetime-local"
              name="next_followup_at"
            />
          </label>

          <label className={styles.wide}>
            محصولات موردعلاقه
            <input
              name="preferred_products"
              placeholder="پد فرانسوی، ملحفه ۴۰ گرم، کیف"
            />
            <small>محصولات را با ویرگول جدا کن.</small>
          </label>

          <label className={styles.wide}>
            آدرس
            <textarea
              name="address"
              rows={3}
              maxLength={1000}
            />
          </label>

          <label className={styles.wide}>
            یادداشت فروش
            <textarea
              name="notes"
              rows={5}
              maxLength={3000}
              placeholder="نیاز مشتری، حساسیت قیمتی، زمان مناسب تماس و سایر نکات..."
            />
          </label>
        </div>

        <div className={styles.formActions}>
          <Link href="/customers">انصراف</Link>
          <button type="submit">
            {isProspect
              ? "ثبت مشتری بالقوه"
              : "ثبت مشتری"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
