import Link from "next/link";

import AppShell from "@/components/app-shell";
import { bankCategory, categoriesFor } from "@/lib/bank/categories";
import {
  invoiceDue,
  suggestDepositMatches,
  type CounterpartyRule,
  type MatchCustomer,
} from "@/lib/bank/matching";
import { escapeLike, normalizeSearchText } from "@/lib/search/normalize";
import { createClient } from "@/lib/supabase/server";

import { categorizeTransaction, confirmDeposit, ignoreTransaction, reopenTransaction } from "../actions";
import styles from "../accounting.module.css";
import { loadMatchableInvoices } from "../invoice-data";
import {
  AccountingTabs,
  formatNumber,
  maskCard,
  MissingMigration,
  Notice,
  pendingCounts,
  readAll,
  rialAsToman,
  TRANSACTION_COLUMNS,
  type TransactionRow,
} from "../shared";

const views = new Set(["pending", "confirmed", "ignored"]);
const otherDepositCategories = categoriesFor("deposit").filter((category) => category.key !== "customer_payment");

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; focus?: string; q?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const view = views.has(params.view ?? "") ? params.view! : "pending";
  const returnTo = view === "pending" ? "/accounting/deposits" : `/accounting/deposits?view=${view}`;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bank_transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("kind", "deposit")
    .eq("review_status", view)
    .order("tx_date", { ascending: view === "pending" })
    .order("tx_time", { ascending: view === "pending" })
    .limit(view === "pending" ? 30 : 60);

  if (error) {
    return (
      <AppShell active="accounting" title="واریزها" subtitle="حسابداری بانکی">
        <MissingMigration />
      </AppShell>
    );
  }
  const deposits = (data ?? []) as TransactionRow[];
  // Pending deposits are oldest first; look back 120 days from the oldest.
  const matchSince = deposits[0]
    ? new Date(Date.parse(deposits[0].tx_date) - 120 * 86_400_000).toISOString().slice(0, 10)
    : null;

  const [counts, customersResult, rulesResult, openInvoices] = await Promise.all([
    pendingCounts(supabase),
    view === "pending"
      ? readAll<MatchCustomer>((from, to) =>
          supabase.from("customers").select("id,name,contact_name").order("id").range(from, to),
        )
      : Promise.resolve({ rows: [] as MatchCustomer[], error: false as const }),
    view === "pending"
      ? readAll<CounterpartyRule>((from, to) =>
          supabase
            .from("bank_counterparty_rules")
            .select("kind,match_type,match_value,category,customer_id")
            .eq("kind", "deposit")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve({ rows: [] as CounterpartyRule[], error: false as const }),
    view === "pending" && matchSince ? loadMatchableInvoices(supabase, matchSince) : Promise.resolve([]),
  ]);

  const customers = new Map(customersResult.rows.map((customer) => [customer.id, customer]));
  const invoicesByCustomer = new Map<string, typeof openInvoices>();
  for (const invoice of openInvoices) {
    invoicesByCustomer.set(invoice.customer_id, [...(invoicesByCustomer.get(invoice.customer_id) ?? []), invoice]);
  }

  // Customer search for one card ("not in the suggestions").
  const focus = params.focus ?? "";
  const search = (params.q ?? "").trim().slice(0, 60);
  let searchResults: MatchCustomer[] = [];
  if (view === "pending" && focus && search.length >= 2) {
    // Same normalised search as the customers page: Holoo names often use
    // Arabic ي/ك, which a plain match on «ی/ک» would miss.
    const { data: found } = await supabase
      .from("customer_crm_summary")
      .select("id,name")
      .ilike("search_document", `%${escapeLike(normalizeSearchText(search))}%`)
      .order("name")
      .limit(8);
    searchResults = (found ?? []) as MatchCustomer[];
  }

  // Names and paid invoices for the reviewed lists.
  const reviewedCustomerNames = new Map<string, string>();
  const paidByTransaction = new Map<string, string[]>();
  if (view !== "pending" && deposits.length) {
    const customerIds = [...new Set(deposits.map((tx) => tx.customer_id).filter(Boolean))] as string[];
    const [{ data: names }, { data: allocations }] = await Promise.all([
      customerIds.length
        ? supabase.from("customers").select("id,name").in("id", customerIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      supabase
        .from("bank_payment_allocations")
        .select("transaction_id,invoice_id,amount_toman")
        .in("transaction_id", deposits.map((tx) => tx.id)),
    ]);
    for (const row of names ?? []) reviewedCustomerNames.set(row.id, row.name);
    const invoiceIds = [...new Set((allocations ?? []).map((row) => row.invoice_id as string))];
    const { data: invoiceRows } = invoiceIds.length
      ? await supabase.from("invoices").select("id,invoice_number,total_amount,settled_at").in("id", invoiceIds)
      : { data: [] };
    const invoices = new Map((invoiceRows ?? []).map((row) => [row.id as string, row]));
    for (const row of allocations ?? []) {
      const invoice = invoices.get(row.invoice_id as string);
      if (!invoice) continue;
      const amount = Number(row.amount_toman);
      const label =
        amount >= Number(invoice.total_amount)
          ? `فاکتور ${invoice.invoice_number}`
          : `${formatNumber(amount)} از فاکتور ${invoice.invoice_number}${invoice.settled_at ? "" : " (هنوز مانده دارد)"}`;
      const key = row.transaction_id as string;
      paidByTransaction.set(key, [...(paidByTransaction.get(key) ?? []), label]);
    }
  }

  return (
    <AppShell active="accounting" title="واریزها" subtitle="وصل کردن واریزهای بانک به مشتری و فاکتور">
      <AccountingTabs active="deposits" counts={{ deposits: counts.deposits, withdrawals: counts.withdrawals }} />
      <Notice saved={params.saved} error={params.error} />

      <nav className={styles.subTabs}>
        <Link href="/accounting/deposits" className={view === "pending" ? styles.activeTab : undefined}>
          منتظر بررسی
        </Link>
        <Link href="/accounting/deposits?view=confirmed" className={view === "confirmed" ? styles.activeTab : undefined}>
          تأییدشده
        </Link>
        <Link href="/accounting/deposits?view=ignored" className={view === "ignored" ? styles.activeTab : undefined}>
          کنار گذاشته
        </Link>
      </nav>

      {view === "pending" ? (
        <p className={styles.hint}>
          برنامه از روی کارت، نام واریزکننده و مبلغ فاکتورها پیشنهاد می‌دهد، ولی تا شما تأیید نکنید هیچ فاکتوری
          تسویه‌شده حساب نمی‌شود. اگر واریز کمتر از فاکتور باشد (پرداخت قسطی) همان فاکتور را تیک بزنید؛ مبلغ از
          مانده فاکتور کم می‌شود و فاکتور وقتی تسویه می‌شود که کل مبلغش واریز شده باشد.
        </p>
      ) : null}

      {!deposits.length ? (
        <div className={styles.empty}>
          <h3>{view === "pending" ? "واریزی منتظر بررسی نیست" : "موردی نیست"}</h3>
        </div>
      ) : null}

      <div className={styles.list}>
        {deposits.map((tx) => {
          const head = (
            <div className={styles.txHead}>
              <div>
                <strong className={styles.in}>{rialAsToman(tx.amount_rial)} تومان</strong>
                <span>
                  {tx.jalali_date} · {tx.tx_time}
                </span>
              </div>
              <div>
                <b>{tx.counterparty_name ?? "واریزکننده نامشخص"}</b>
                {tx.counterparty_card ? <span dir="ltr">{maskCard(tx.counterparty_card)}</span> : null}
              </div>
            </div>
          );

          if (view !== "pending") {
            const invoices = paidByTransaction.get(tx.id) ?? [];
            return (
              <article key={tx.id} className={styles.card}>
                {head}
                <p className={styles.description}>
                  {tx.customer_id
                    ? `مشتری: ${reviewedCustomerNames.get(tx.customer_id) ?? "—"}`
                    : bankCategory(tx.category)?.label ?? (view === "ignored" ? "کنار گذاشته شده" : "—")}
                  {invoices.length ? ` · پرداخت: ${invoices.join("، ")}` : ""}
                  {tx.user_note ? ` · ${tx.user_note}` : ""}
                </p>
                <form action={reopenTransaction} className={styles.inlineForm}>
                  <input type="hidden" name="tx_id" value={tx.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className={styles.secondary}>
                    برگرداندن به صف بررسی{invoices.length ? " (فاکتورها دوباره باز می‌شوند)" : ""}
                  </button>
                </form>
              </article>
            );
          }

          const suggestions = suggestDepositMatches({
            deposit: {
              amount_rial: Number(tx.amount_rial),
              tx_date: tx.tx_date,
              counterparty_card: tx.counterparty_card,
              counterparty_name: tx.counterparty_name,
            },
            customers: customersResult.rows,
            rules: rulesResult.rows,
            openInvoices,
          });
          const options = [
            ...suggestions.map((suggestion) => ({
              customer: customers.get(suggestion.customerId),
              invoiceIds: suggestion.invoiceIds,
              reasons: suggestion.reasons,
            })),
            ...(focus === tx.id
              ? searchResults
                  .filter((customer) => !suggestions.some((s) => s.customerId === customer.id))
                  .map((customer) => ({ customer, invoiceIds: [] as string[], reasons: ["نتیجه جستجو"] }))
              : []),
          ].filter((option) => option.customer);

          return (
            <article key={tx.id} id={`tx-${tx.id}`} className={styles.card}>
              {head}
              <p className={styles.description}>{tx.description}</p>

              <form action={confirmDeposit} className={styles.matchForm}>
                <input type="hidden" name="tx_id" value={tx.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                {options.length ? (
                  <fieldset>
                    <legend>این واریز مال کدام مشتری است؟</legend>
                    {options.map(({ customer, invoiceIds, reasons }) => {
                      const customerInvoices = (invoicesByCustomer.get(customer!.id) ?? []).slice(0, 8);
                      return (
                        <div key={customer!.id} className={styles.option}>
                          <label className={styles.optionHead}>
                            <input type="radio" name="customer_id" value={customer!.id} required />
                            <b>{customer!.name}</b>
                            <small>{reasons.join(" · ")}</small>
                          </label>
                          {customerInvoices.length ? (
                            <div className={styles.invoiceChecks}>
                              {customerInvoices.map((invoice) => (
                                <label key={invoice.id}>
                                  <input
                                    type="checkbox"
                                    name="invoice_ids"
                                    value={`${customer!.id}:${invoice.id}`}
                                    defaultChecked={invoiceIds.includes(invoice.id)}
                                  />
                                  فاکتور {invoice.invoice_number} · {formatNumber(invoice.total_amount)} تومان
                                  {invoice.paid_amount ? ` (مانده ${formatNumber(invoiceDue(invoice))})` : ""}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <small className={styles.hint}>فاکتور تسویه‌نشده‌ای در ۴ ماه قبل از این واریز ندارد.</small>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                ) : (
                  <p className={styles.hint}>پیشنهادی پیدا نشد؛ مشتری را جستجو کنید.</p>
                )}
                {options.length ? (
                  <div className={styles.formActions}>
                    <label className={styles.remember}>
                      <input type="checkbox" name="remember" defaultChecked={Boolean(tx.counterparty_card || tx.counterparty_name)} />
                      این {tx.counterparty_card ? "کارت" : "نام"} را برای این مشتری به خاطر بسپار
                    </label>
                    <button className={styles.primary}>تأیید واریز مشتری</button>
                  </div>
                ) : null}
              </form>

              <div className={styles.cardFooter}>
                <form action={`#tx-${tx.id}`} className={styles.inlineForm}>
                  <input type="hidden" name="focus" value={tx.id} />
                  <input
                    name="q"
                    placeholder="جستجوی نام مشتری"
                    defaultValue={focus === tx.id ? search : ""}
                    minLength={2}
                    maxLength={60}
                  />
                  <button className={styles.secondary}>جستجو</button>
                </form>

                <form action={categorizeTransaction} className={styles.inlineForm}>
                  <input type="hidden" name="tx_id" value={tx.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <select name="category" required defaultValue="">
                    <option value="" disabled>
                      واریز مشتری نیست…
                    </option>
                    {otherDepositCategories.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                  <button className={styles.secondary}>ثبت</button>
                </form>

                <form action={ignoreTransaction} className={styles.inlineForm}>
                  <input type="hidden" name="tx_id" value={tx.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className={styles.ghost}>کنار بگذار</button>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
