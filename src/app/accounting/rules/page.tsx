import AppShell from "@/components/app-shell";
import { bankCategory } from "@/lib/bank/categories";
import { createClient } from "@/lib/supabase/server";

import { deleteRule } from "../actions";
import styles from "../accounting.module.css";
import { AccountingTabs, maskCard, MissingMigration, Notice, pendingCounts, readAll } from "../shared";

type RuleRow = {
  id: string;
  kind: "deposit" | "withdrawal";
  match_type: "card" | "name";
  match_value: string;
  category: string | null;
  customer_id: string | null;
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const rules = await readAll<RuleRow>((from, to) =>
    supabase
      .from("bank_counterparty_rules")
      .select("id,kind,match_type,match_value,category,customer_id")
      .order("kind")
      .order("match_value")
      .range(from, to),
  );

  if (rules.error) {
    return (
      <AppShell active="accounting" title="قوانین" subtitle="حسابداری بانکی">
        <MissingMigration />
      </AppShell>
    );
  }

  const customerIds = [...new Set(rules.rows.map((rule) => rule.customer_id).filter(Boolean))] as string[];
  const customerNames = new Map<string, string>();
  for (let index = 0; index < customerIds.length; index += 300) {
    const { data } = await supabase.from("customers").select("id,name").in("id", customerIds.slice(index, index + 300));
    for (const row of data ?? []) customerNames.set(row.id, row.name);
  }
  const counts = await pendingCounts(supabase);

  return (
    <AppShell active="accounting" title="قوانین" subtitle="کارت‌ها و نام‌هایی که برنامه یاد گرفته">
      <AccountingTabs active="rules" counts={{ deposits: counts.deposits, withdrawals: counts.withdrawals }} />
      <Notice saved={params.saved} error={params.error} />

      <p className={styles.hint}>
        هر بار که هنگام دسته‌بندی «به خاطر بسپار» را بزنید یک قانون اینجا ساخته می‌شود. قانون برداشت‌ها هنگام بارگذاری
        خودکار اعمال می‌شود؛ قانون واریزها فقط مشتری را پیشنهاد می‌دهد و تأیید با شماست.
      </p>

      {!rules.rows.length ? (
        <div className={styles.empty}>
          <h3>هنوز قانونی ساخته نشده است</h3>
        </div>
      ) : (
        <section className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>نوع</th>
                <th>شناسایی با</th>
                <th>نتیجه</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.rows.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.kind === "deposit" ? "واریز" : "برداشت"}</td>
                  <td>
                    {rule.match_type === "card" ? (
                      <span dir="ltr">کارت {maskCard(rule.match_value)}</span>
                    ) : (
                      `نام «${rule.match_value}»`
                    )}
                  </td>
                  <td>
                    {rule.customer_id
                      ? `مشتری: ${customerNames.get(rule.customer_id) ?? "—"}`
                      : bankCategory(rule.category)?.label ?? rule.category}
                  </td>
                  <td>
                    <form action={deleteRule}>
                      <input type="hidden" name="rule_id" value={rule.id} />
                      <input type="hidden" name="return_to" value="/accounting/rules" />
                      <button className={styles.ghost}>حذف</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </AppShell>
  );
}
