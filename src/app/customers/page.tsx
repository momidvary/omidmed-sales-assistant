import Link from "next/link";

import AppShell, { Icon } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { escapeLike, normalizeSearchText } from "@/lib/search/normalize";
import {
  classifyFollowupNeed,
  latestContactByCustomer,
  type FollowupNeed,
} from "@/lib/sales/followup-need";
import styles from "./customers.module.css";

const number = new Intl.NumberFormat("fa-IR");
const PAGE_SIZE = 100;

function formatMoney(value: number | string | null | undefined) {
  return number.format(Math.round(Number(value ?? 0)));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR").format(
    new Date(`${value}T12:00:00`),
  );
}

function parsePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function paginationPages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages]);

  for (let offset = -2; offset <= 2; offset += 1) {
    const page = currentPage + offset;
    if (page >= 1 && page <= totalPages) pages.add(page);
  }

  return Array.from(pages).sort((left, right) => left - right);
}

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

const allowedTabs = new Set(["all", "needs", "ok", "archived"]);

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  status: string;
  lead_stage: string | null;
  lead_source: string | null;
  potential_value: number | string | null;
  archived_at: string | null;
  next_followup_at: string | null;
  last_purchase_at: string | null;
  purchase_count: number | null;
  total_sales: number | string | null;
  avg_purchase_gap_days: number | string | null;
  days_since_last_purchase: number | null;
};

function customersHref({
  page = 1,
  search = "",
  tab = "all",
}: {
  page?: number;
  search?: string;
  tab?: string;
}) {
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (tab !== "all") query.set("tab", tab);
  if (page > 1) query.set("page", String(page));
  const value = query.toString();
  return value ? `/customers?${value}` : "/customers";
}

async function fetchAll<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await load(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { rows, error: null };
  }
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tab?: string;
    page?: string;
    created?: string;
    archived?: string;
    deleted?: string;
  }>;
}) {
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 80);
  const tab = allowedTabs.has(params.tab ?? "") ? (params.tab as string) : "all";
  const currentPage = parsePage(params.page);
  const supabase = await createClient();

  const [customerResult, followupResult] = await Promise.all([
    fetchAll<CustomerRow>((from, to) => {
      let query = supabase
        .from("customer_crm_summary")
        .select(
          "id,name,phone,address,city,status,lead_stage,lead_source,potential_value,archived_at,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
        )
        .order("id")
        .range(from, to);
      query = tab === "archived"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
      if (search) {
        query = query.ilike(
          "search_document",
          `%${escapeLike(normalizeSearchText(search))}%`,
        );
      }
      return query as unknown as PromiseLike<{ data: CustomerRow[] | null; error: unknown }>;
    }),
    fetchAll<{ customer_id: string; followup_at: string }>((from, to) =>
      supabase
        .from("followups")
        .select("customer_id,followup_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{
          data: Array<{ customer_id: string; followup_at: string }> | null;
          error: unknown;
        }>,
    ),
  ]);

  const error = customerResult.error || followupResult.error;
  const lastContact = latestContactByCustomer(followupResult.rows);
  const classified = customerResult.rows
    .map((customer) => ({
      customer,
      need: classifyFollowupNeed(customer, lastContact.get(customer.id) ?? null) as FollowupNeed,
    }))
    .sort(
      (a, b) =>
        Number(b.customer.total_sales ?? 0) - Number(a.customer.total_sales ?? 0),
    );
  const needsCount = classified.filter((item) => item.need.needsFollowup).length;
  const filtered = classified.filter((item) =>
    tab === "needs"
      ? item.need.needsFollowup
      : tab === "ok"
        ? !item.need.needsFollowup
        : true,
  );

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const from = (currentPage - 1) * PAGE_SIZE;
  const customers = filtered.slice(from, from + PAGE_SIZE);
  const shownFrom = customers.length > 0 ? from + 1 : 0;
  const shownTo = customers.length > 0 ? from + customers.length : 0;
  const pages = paginationPages(currentPage, totalPages);
  const hasActiveFilter = Boolean(search || tab !== "all");

  const pageHref = (page: number) => customersHref({ page, search, tab });

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

          <input type="hidden" name="tab" value={tab} />

          <button type="submit">جست‌وجو</button>

          {hasActiveFilter ? <Link href="/customers">پاک‌کردن</Link> : null}
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
        </div>
      </section>

      <nav className={styles.statusTabs} aria-label="گروه مشتری">
        {[
          ["all", "همه"],
          ["needs", `نیاز به پیگیری${tab === "archived" ? "" : ` (${number.format(needsCount)})`}`],
          ["ok", "نیاز به پیگیری ندارد"],
          ["archived", "بایگانی"],
        ].map(([value, label]) => (
          <Link
            key={value}
            className={`${styles.statusTab} ${tab === value ? styles.activeTab : ""}`}
            href={customersHref({ search, tab: value })}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className={styles.summary}>
        <div>
          <span>تعداد کل نتیجه</span>
          <strong>{number.format(totalCount)}</strong>
        </div>

        <div className={styles.summaryDetails}>
          <p>
            نمایش {number.format(shownFrom)} تا {number.format(shownTo)} از {" "}
            {number.format(totalCount)} مشتری؛ صفحه {number.format(currentPage)} از {" "}
            {number.format(totalPages)}
          </p>
        </div>
      </section>

      <section className={styles.tableCard}>
        {error ? (
          <div className={styles.error}>
            خواندن فهرست مشتریان انجام نشد. شناسه خطا: CUSTOMERS_READ_FAILED
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
                : currentPage > totalPages
                  ? "این صفحه وجود ندارد"
                  : "بانک مشتریان خالی است"}
            </h4>

            <p>
              {currentPage > totalPages
                ? "به صفحه اول بانک مشتریان برگرد."
                : hasActiveFilter
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
                  <th>پیگیری</th>
                  <th>عملیات</th>
                </tr>
              </thead>

              <tbody>
                {customers.map(({ customer, need }) => (
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
                          : statusLabel[customer.status] ?? customer.status}
                      </span>

                      {customer.status === "prospect" && customer.lead_stage ? (
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

                    <td>{number.format(customer.purchase_count ?? 0)}</td>

                    <td>
                      {customer.status === "prospect" &&
                      Number(customer.total_sales ?? 0) === 0
                        ? formatMoney(customer.potential_value)
                        : formatMoney(customer.total_sales)}
                    </td>

                    <td>
                      <span
                        className={`${styles.statusBadge} ${
                          need.needsFollowup ? styles.lost : styles.active
                        }`}
                      >
                        {need.needsFollowup ? "نیاز به پیگیری" : "نیاز ندارد"}
                      </span>
                      <small>{need.reason}</small>
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

      {totalPages > 1 ? (
        <nav
          className={styles.statusTabs}
          aria-label="صفحه‌بندی مشتریان"
          style={{
            marginTop: 14,
            marginBottom: 0,
            justifyContent: "center",
          }}
        >
          {currentPage > 1 ? (
            <Link className={styles.statusTab} href={pageHref(currentPage - 1)}>
              صفحه قبل
            </Link>
          ) : (
            <span className={styles.statusTab} style={{ opacity: 0.45 }}>
              صفحه قبل
            </span>
          )}

          {pages.map((page, index) => {
            const previous = pages[index - 1];
            return (
              <span key={page} style={{ display: "contents" }}>
                {previous && page - previous > 1 ? (
                  <span className={styles.statusTab} style={{ opacity: 0.6 }}>
                    …
                  </span>
                ) : null}
                <Link
                  className={`${styles.statusTab} ${
                    page === currentPage ? styles.activeTab : ""
                  }`}
                  href={pageHref(page)}
                  aria-current={page === currentPage ? "page" : undefined}
                >
                  {number.format(page)}
                </Link>
              </span>
            );
          })}

          {currentPage < totalPages ? (
            <Link className={styles.statusTab} href={pageHref(currentPage + 1)}>
              صفحه بعد
            </Link>
          ) : (
            <span className={styles.statusTab} style={{ opacity: 0.45 }}>
              صفحه بعد
            </span>
          )}
        </nav>
      ) : null}
    </AppShell>
  );
}
