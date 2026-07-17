import Link from "next/link";

import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import styles from "./customers.module.css";

const number = new Intl.NumberFormat("fa-IR");

function formatMoney(value: number | string | null) {
  return number.format(Math.round(Number(value ?? 0)));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR").format(
    new Date(`${value}T12:00:00`),
  );
}

const priorityLabel: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

const statusLabel: Record<string, string> = {
  active: "فعال",
  inactive: "غیرفعال",
  prospect: "بالقوه",
  lost: "از دست رفته",
  archived: "بایگانی",
};

const leadStageLabel: Record<string, string> = {
  new: "جدید",
  contacted: "تماس گرفته شد",
  interested: "علاقه‌مند",
  quoted: "قیمت ارسال شد",
  decision: "در حال تصمیم‌گیری",
  converted: "تبدیل‌شده",
  lost: "از دست رفته",
};

const filterLabel: Record<string, string> = {
  urgent: "پیگیری فوری؛ ویژه و زیاد",
  vip: "فقط مشتریان ویژه",
  high: "فقط اولویت زیاد",
  normal: "فقط اولویت متوسط",
  low: "فقط اولویت کم",
};

const allowedPriorityFilters = new Set([
  "urgent",
  "vip",
  "high",
  "normal",
  "low",
]);

const allowedStatusFilters = new Set([
  "all",
  "active",
  "prospect",
  "inactive",
  "lost",
  "archived",
]);

function statusHref(status: string) {
  return status === "all" ? "/customers" : `/customers?status=${status}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    priority?: string;
    product?: string;
    status?: string;
    created?: string;
    archived?: string;
    deleted?: string;
  }>;
}) {
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 80);
  const requestedPriority = (params.priority ?? "").trim();
  const requestedStatus = (params.status ?? "all").trim();
  const productSearch = (params.product ?? "").trim().slice(0, 100);

  const priorityFilter = allowedPriorityFilters.has(requestedPriority)
    ? requestedPriority
    : "";

  const statusFilter = allowedStatusFilters.has(requestedStatus)
    ? requestedStatus
    : "all";

  const supabase = await createClient();

  let matchingCustomerIds: string[] | null = null;
  let productFilterError: string | null = null;

  if (productSearch) {
    const { data: productMatches, error: productError } = await supabase
      .from("customer_product_summary")
      .select("customer_id")
      .ilike(
        "product_name",
        `%${productSearch.replace(/[%_]/g, "")}%`,
      )
      .limit(5000);

    if (productError) {
      productFilterError = productError.message;
    } else {
      matchingCustomerIds = Array.from(
        new Set(
          (productMatches ?? []).map(
            (item) => item.customer_id as string,
          ),
        ),
      );
    }
  }

  let query = supabase
    .from("customer_crm_summary")
    .select(
      "id,name,phone,address,city,status,priority,lead_stage,lead_source,potential_value,archived_at,last_purchase_at,purchase_count,total_sales,days_since_last_purchase",
      { count: "exact" },
    )
    .order("total_sales", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter === "archived") {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
  }

  if (search) {
    const digits = search.replace(/\D/g, "");
    query =
      digits.length >= 4
        ? query.ilike("normalized_phone", `%${digits}%`)
        : query.ilike(
            "name",
            `%${search.replace(/[%_]/g, "")}%`,
          );
  }

  if (priorityFilter === "urgent") {
    query = query.in("priority", ["vip", "high"]);
  } else if (priorityFilter) {
    query = query.eq("priority", priorityFilter);
  }

  if (matchingCustomerIds?.length) {
    query = query.in("id", matchingCustomerIds);
  }

  const shouldSkipCustomerQuery =
    Boolean(productSearch) &&
    matchingCustomerIds?.length === 0 &&
    !productFilterError;

  const result = shouldSkipCustomerQuery
    ? { data: [], count: 0, error: null }
    : await query;

  const { data, count, error } = result;
  const customers = data ?? [];

  const hasActiveFilter = Boolean(
    search ||
      priorityFilter ||
      productSearch ||
      statusFilter !== "all",
  );

  return (
    <AppShell
      active="customers"
      title="بانک مشتریان"
      subtitle="مشتریان فعلی و بالقوه را ثبت، جست‌وجو و پیگیری کن."
    >
      {params.deleted ? (
        <div className={styles.success}>
          مشتری اشتباهی با موفقیت حذف شد.
        </div>
      ) : null}

      {params.archived ? (
        <div className={styles.success}>
          مشتری بایگانی شد و سوابق او باقی ماند.
        </div>
      ) : null}

      <section className={styles.toolbar}>
        <form className={styles.search} method="get">
          <Icon name="search" size={19} />

          <input
            name="q"
            defaultValue={search}
            placeholder="نام مشتری یا شماره موبایل..."
          />

          <input
            name="product"
            defaultValue={productSearch}
            placeholder="نام کالا؛ مثلاً پد اسپانیایی..."
          />

          <input
            type="hidden"
            name="status"
            value={statusFilter}
          />

          <select
            name="priority"
            defaultValue={priorityFilter}
            aria-label="فیلتر اولویت مشتری"
          >
            <option value="">همه اولویت‌ها</option>
            <option value="urgent">
              پیگیری فوری؛ ویژه و زیاد
            </option>
            <option value="vip">فقط ویژه</option>
            <option value="high">فقط اولویت زیاد</option>
            <option value="normal">فقط اولویت متوسط</option>
            <option value="low">فقط اولویت کم</option>
          </select>

          <button type="submit">اعمال فیلتر</button>

          {hasActiveFilter ? (
            <Link href="/customers">پاک‌کردن</Link>
          ) : null}
        </form>

        <div className={styles.toolbarActions}>
          <Link
            className={styles.addCustomer}
            href="/customers/new?type=customer"
          >
            + افزودن مشتری
          </Link>

          <Link
            className={styles.addProspect}
            href="/customers/new?type=prospect"
          >
            + مشتری بالقوه
          </Link>

          <Link className={styles.importButton} href="/import">
            <Icon name="upload" size={18} /> ورود اطلاعات
          </Link>
        </div>
      </section>

      <nav
        className={styles.statusTabs}
        aria-label="فیلتر وضعیت مشتری"
      >
        {[
          ["all", "همه"],
          ["active", "فعال"],
          ["prospect", "بالقوه"],
          ["inactive", "غیرفعال"],
          ["lost", "از دست رفته"],
          ["archived", "بایگانی"],
        ].map(([value, label]) => (
          <Link
            key={value}
            className={`${styles.statusTab} ${
              statusFilter === value ? styles.activeTab : ""
            }`}
            href={statusHref(value)}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className={styles.summary}>
        <div>
          <span>تعداد نتیجه</span>
          <strong>{number.format(count ?? customers.length)}</strong>
        </div>

        <div className={styles.summaryDetails}>
          {statusFilter !== "all" ? (
            <span className={styles.activeFilter}>
              وضعیت: {statusLabel[statusFilter]}
            </span>
          ) : null}

          {priorityFilter ? (
            <span className={styles.activeFilter}>
              {filterLabel[priorityFilter]}
            </span>
          ) : null}

          {productSearch ? (
            <span className={styles.activeFilter}>
              کالا: {productSearch}
            </span>
          ) : null}

          <p>
            برای حفظ سرعت، در هر بار حداکثر ۲۰۰ مشتری نمایش
            داده می‌شود.
          </p>
        </div>
      </section>

      <section className={styles.tableCard}>
        {productFilterError ? (
          <div className={styles.error}>
            فیلتر کالا هنوز آماده نیست: {productFilterError}.
            فایل SQL مرحله هشتم را اجرا کن.
          </div>
        ) : null}

        {error ? (
          <div className={styles.error}>
            خطا در خواندن مشتریان: {error.message}
            <br />
            فایل SQL مرحله ۲۲B را در Supabase اجرا کن.
          </div>
        ) : null}

        {!error && customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="users" size={30} />
            </div>

            <h4>
              {hasActiveFilter
                ? "مشتری پیدا نشد"
                : "بانک مشتریان خالی است"}
            </h4>

            <p>
              {hasActiveFilter
                ? "عبارت یا فیلتر دیگری را امتحان کن."
                : "یک مشتری فعلی یا مشتری بالقوه ثبت کن."}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>موبایل</th>
                  <th>وضعیت</th>
                  <th>آخرین خرید</th>
                  <th>تعداد خرید</th>
                  <th>جمع فروش / ارزش بالقوه</th>
                  <th>اولویت</th>
                  <th>عملیات</th>
                </tr>
              </thead>

              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link
                        className={styles.customerName}
                        href={`/customers/${customer.id}`}
                      >
                        {customer.name}
                      </Link>

                      <small>
                        {customer.address ||
                          customer.city ||
                          customer.lead_source ||
                          "اطلاعات تکمیلی ثبت نشده"}
                      </small>
                    </td>

                    <td dir="ltr">{customer.phone || "—"}</td>

                    <td>
                      <span
                        className={`${styles.statusBadge} ${
                          customer.archived_at
                            ? styles.archived
                            : styles[customer.status]
                        }`}
                      >
                        {customer.archived_at
                          ? "بایگانی"
                          : statusLabel[customer.status] ??
                            customer.status}
                      </span>

                      {customer.status === "prospect" &&
                      customer.lead_stage ? (
                        <small className={styles.stage}>
                          {leadStageLabel[customer.lead_stage] ??
                            customer.lead_stage}
                        </small>
                      ) : null}
                    </td>

                    <td>
                      <span>{formatDate(customer.last_purchase_at)}</span>
                      <small>
                        {customer.days_since_last_purchase == null
                          ? ""
                          : `${number.format(
                              customer.days_since_last_purchase,
                            )} روز قبل`}
                      </small>
                    </td>

                    <td>
                      {number.format(customer.purchase_count ?? 0)}
                    </td>

                    <td>
                      {customer.status === "prospect" &&
                      Number(customer.total_sales ?? 0) === 0
                        ? formatMoney(customer.potential_value)
                        : formatMoney(customer.total_sales)}
                    </td>

                    <td>
                      <span
                        className={`${styles.priority} ${
                          styles[customer.priority]
                        }`}
                      >
                        {priorityLabel[customer.priority] ??
                          customer.priority}
                      </span>
                    </td>

                    <td>
                      <div className={styles.rowActions}>
                        <Link
                          className={styles.openButton}
                          href={`/customers/${customer.id}`}
                        >
                          پرونده
                        </Link>

                        <Link
                          className={styles.manageButton}
                          href={`/customers/${customer.id}/manage`}
                        >
                          ویرایش
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
