import Link from "next/link";

import AppShell from "@/components/app-shell";
import { bankCategory, categoriesFor, CATEGORY_GROUP_LABELS, type CategoryGroup } from "@/lib/bank/categories";
import { createClient } from "@/lib/supabase/server";

import { categorizeTransaction, ignoreTransaction, reopenTransaction } from "../actions";
import styles from "../accounting.module.css";
import {
  AccountingTabs,
  maskCard,
  MissingMigration,
  Notice,
  pendingCounts,
  rialAsToman,
  TRANSACTION_COLUMNS,
  type TransactionRow,
} from "../shared";

const views = new Set(["pending", "confirmed", "ignored"]);
const sourceLabels: Record<string, string> = { fee: "کارمزد (خودکار)", rule: "با قانون", manual: "دستی" };

const groups = categoriesFor("withdrawal").reduce((map, category) => {
  map.set(category.group, [...(map.get(category.group) ?? []), category]);
  return map;
}, new Map<CategoryGroup, ReturnType<typeof categoriesFor>>());

function CategorySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <select name="category" required defaultValue={defaultValue ?? ""}>
      <option value="" disabled>
        دسته‌بندی…
      </option>
      {[...groups.entries()].map(([group, categories]) => (
        <optgroup key={group} label={CATEGORY_GROUP_LABELS[group]}>
          {categories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; saved?: string; error?: string; applied?: string }>;
}) {
  const params = await searchParams;
  const view = views.has(params.view ?? "") ? params.view! : "pending";
  const returnTo = view === "pending" ? "/accounting/withdrawals" : `/accounting/withdrawals?view=${view}`;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bank_transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("kind", "withdrawal")
    .eq("review_status", view)
    .order("tx_date", { ascending: view === "pending" })
    .order("tx_time", { ascending: view === "pending" })
    .limit(view === "pending" ? 50 : 100);

  if (error) {
    return (
      <AppShell active="accounting" title="برداشت‌ها" subtitle="حسابداری بانکی">
        <MissingMigration />
      </AppShell>
    );
  }
  const withdrawals = (data ?? []) as TransactionRow[];
  const counts = await pendingCounts(supabase);

  return (
    <AppShell active="accounting" title="برداشت‌ها" subtitle="دسته‌بندی هزینه‌ها و برداشت شرکا">
      <AccountingTabs active="withdrawals" counts={{ deposits: counts.deposits, withdrawals: counts.withdrawals }} />
      <Notice saved={params.saved} error={params.error} applied={params.applied} />

      <nav className={styles.subTabs}>
        <Link href="/accounting/withdrawals" className={view === "pending" ? styles.activeTab : undefined}>
          بدون دسته‌بندی
        </Link>
        <Link href="/accounting/withdrawals?view=confirmed" className={view === "confirmed" ? styles.activeTab : undefined}>
          دسته‌بندی‌شده
        </Link>
        <Link href="/accounting/withdrawals?view=ignored" className={view === "ignored" ? styles.activeTab : undefined}>
          کنار گذاشته
        </Link>
      </nav>

      {view === "pending" ? (
        <p className={styles.hint}>
          کارمزدها خودکار دسته‌بندی می‌شوند. با تیک «به خاطر بسپار» برنامه این کارت یا نام را یاد می‌گیرد و برداشت‌های
          بعدی همین شخص را خودش دسته‌بندی می‌کند.
        </p>
      ) : null}

      {!withdrawals.length ? (
        <div className={styles.empty}>
          <h3>{view === "pending" ? "همه برداشت‌ها دسته‌بندی شده‌اند" : "موردی نیست"}</h3>
        </div>
      ) : null}

      <div className={styles.list}>
        {withdrawals.map((tx) => (
          <article key={tx.id} className={styles.card}>
            <div className={styles.txHead}>
              <div>
                <strong className={styles.out}>{rialAsToman(tx.amount_rial)} تومان</strong>
                <span>
                  {tx.jalali_date} · {tx.tx_time}
                </span>
              </div>
              <div>
                <b>{tx.counterparty_name ?? (tx.is_fee ? "کارمزد بانک" : "گیرنده نامشخص")}</b>
                {tx.counterparty_card ? <span dir="ltr">{maskCard(tx.counterparty_card)}</span> : null}
              </div>
            </div>
            <p className={styles.description}>{tx.description}</p>
            {tx.category ? (
              <p className={styles.badgeLine}>
                <b>{bankCategory(tx.category)?.label ?? tx.category}</b>
                {tx.category_source ? <small>{sourceLabels[tx.category_source]}</small> : null}
                {tx.user_note ? <small>{tx.user_note}</small> : null}
              </p>
            ) : null}

            {view !== "ignored" ? (
              <form action={categorizeTransaction} className={styles.inlineForm}>
                <input type="hidden" name="tx_id" value={tx.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <CategorySelect defaultValue={tx.category} />
                <input name="note" placeholder="توضیح (اختیاری)" maxLength={300} defaultValue={tx.user_note ?? ""} />
                {tx.counterparty_card || tx.counterparty_name ? (
                  <label className={styles.remember}>
                    <input type="checkbox" name="remember" defaultChecked={view === "pending"} />
                    به خاطر بسپار
                  </label>
                ) : null}
                <button className={styles.primary}>{tx.category ? "تغییر" : "ثبت"}</button>
              </form>
            ) : null}

            <div className={styles.cardFooter}>
              {view === "pending" ? (
                <form action={ignoreTransaction} className={styles.inlineForm}>
                  <input type="hidden" name="tx_id" value={tx.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className={styles.ghost}>کنار بگذار</button>
                </form>
              ) : (
                <form action={reopenTransaction} className={styles.inlineForm}>
                  <input type="hidden" name="tx_id" value={tx.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className={styles.ghost}>برگرداندن به صف بررسی</button>
                </form>
              )}
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
