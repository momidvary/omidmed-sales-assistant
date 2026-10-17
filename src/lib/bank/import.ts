import type { SupabaseClient } from "@supabase/supabase-js";

import { autoCategory, type CounterpartyRule } from "./matching";
import type { ParsedStatement } from "./resalat-statement";

// Writes a parsed statement into bank_transactions. Rows already imported
// from an earlier (overlapping) statement are recognised by fingerprint and
// skipped, so importing the same day twice is harmless.

export async function loadRules(supabase: SupabaseClient) {
  const rules: CounterpartyRule[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("bank_counterparty_rules")
      .select("kind,match_type,match_value,category,customer_id")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error("قوانین حسابداری خوانده نشد. آیا migration شماره 026 اجرا شده است؟");
    rules.push(...((data ?? []) as CounterpartyRule[]));
    if ((data ?? []).length < 1000) return rules;
  }
}

export async function existingFingerprints(supabase: SupabaseClient, fingerprints: string[]) {
  const found = new Set<string>();
  for (let index = 0; index < fingerprints.length; index += 200) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .select("fingerprint")
      .in("fingerprint", fingerprints.slice(index, index + 200));
    if (error) throw new Error("تراکنش‌های قبلی خوانده نشد. آیا migration شماره 026 اجرا شده است؟");
    for (const row of data ?? []) found.add(row.fingerprint as string);
  }
  return found;
}

export async function importStatement(
  supabase: SupabaseClient,
  statement: ParsedStatement,
  fileName: string,
) {
  const accountNo = statement.accountNo!;
  const rules = await loadRules(supabase);
  const known = await existingFingerprints(
    supabase,
    statement.transactions.map((tx) => tx.fingerprint),
  );
  const fresh = statement.transactions.filter((tx) => !known.has(tx.fingerprint));

  const { data: batch, error: batchError } = await supabase
    .from("bank_statement_imports")
    .insert({
      account_no: accountNo,
      from_date: statement.fromDate,
      to_date: statement.toDate,
      file_name: fileName.slice(0, 200),
      transaction_count: statement.transactions.length,
      inserted_count: 0,
      deposit_total_rial: statement.totals.depositRial,
      withdrawal_total_rial: statement.totals.withdrawalRial,
    })
    .select("id")
    .single();
  if (batchError || !batch) throw new Error("ثبت فایل صورت‌حساب انجام نشد.");

  const rows = fresh.map((tx) => {
    const base = {
      kind: tx.kind,
      is_fee: tx.isFee,
      counterparty_card: tx.counterpartyCard,
      counterparty_name: tx.counterpartyName,
    };
    const category = autoCategory(rules, base);
    return {
      import_id: batch.id,
      account_no: accountNo,
      fingerprint: tx.fingerprint,
      jalali_date: tx.jalaliDate,
      tx_date: tx.gregorianDate,
      tx_time: tx.time || null,
      row_no: tx.rowNo,
      branch: tx.branch || null,
      document_no: tx.documentNo || null,
      reference_no: tx.referenceNo || null,
      cheque_no: tx.chequeNo || null,
      description: tx.description.slice(0, 2000),
      note: tx.note || null,
      kind: tx.kind,
      amount_rial: tx.kind === "deposit" ? tx.depositRial : tx.withdrawalRial,
      balance_rial: tx.balanceRial,
      is_fee: tx.isFee,
      counterparty_name: tx.counterpartyName?.slice(0, 120) ?? null,
      counterparty_card: tx.counterpartyCard,
      category: category?.category ?? null,
      category_source: category?.source ?? null,
      review_status: category ? "confirmed" : "pending",
      reviewed_at: category ? new Date().toISOString() : null,
    };
  });

  let inserted = 0;
  for (let index = 0; index < rows.length; index += 200) {
    // A concurrent upload of the same file can still race us; the unique
    // fingerprint index turns that into a skipped row instead of a duplicate.
    const { data, error } = await supabase
      .from("bank_transactions")
      .upsert(rows.slice(index, index + 200), {
        onConflict: "owner_id,fingerprint",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error("ذخیره تراکنش‌ها انجام نشد.");
    inserted += data?.length ?? 0;
  }

  await supabase.from("bank_statement_imports").update({ inserted_count: inserted }).eq("id", batch.id);

  return {
    inserted,
    duplicates: statement.transactions.length - inserted,
    autoCategorized: rows.filter((row) => row.category).length,
  };
}
