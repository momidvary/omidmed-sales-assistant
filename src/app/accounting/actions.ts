"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isValidCategory } from "@/lib/bank/categories";
import { findRule, ruleKeys, type CounterpartyRule } from "@/lib/bank/matching";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClient>>;

type TransactionRow = {
  id: string;
  kind: "deposit" | "withdrawal";
  review_status: "pending" | "confirmed" | "ignored";
  amount_rial: number | string;
  counterparty_card: string | null;
  counterparty_name: string | null;
};

function clean(value: FormDataEntryValue | null, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function returnPath(formData: FormData) {
  const path = clean(formData.get("return_to"), 300);
  return /^\/accounting(\/[a-z-]+)?(\?[\w=&%.-]*)?$/.test(path) ? path : "/accounting";
}

function finish(path: string, query: string): never {
  revalidatePath("/accounting", "layout");
  const [base, existing = ""] = path.split("?");
  const params = new URLSearchParams(existing);
  for (const key of ["saved", "error", "focus", "q"]) params.delete(key);
  const extra = new URLSearchParams(query);
  extra.forEach((value, key) => params.set(key, value));
  const search = params.toString();
  redirect(search ? `${base}?${search}` : base);
}

async function loadTransaction(supabase: Supabase, id: string) {
  if (!uuidPattern.test(id)) return null;
  const { data } = await supabase
    .from("bank_transactions")
    .select("id,kind,review_status,amount_rial,counterparty_card,counterparty_name")
    .eq("id", id)
    .maybeSingle();
  return (data as TransactionRow | null) ?? null;
}

/** Remembers the transaction's card (or else its name) for next time. */
async function rememberRule(
  supabase: Supabase,
  tx: TransactionRow,
  target: { category: string | null; customer_id: string | null },
) {
  const key = ruleKeys(tx)[0];
  if (!key) return null;
  const rule = { kind: tx.kind, ...key, ...target };
  const { error } = await supabase
    .from("bank_counterparty_rules")
    .upsert(rule, { onConflict: "owner_id,kind,match_type,match_value" });
  return error ? null : (rule as CounterpartyRule);
}

const rpcErrors = new Set(["invalid", "reviewed", "customer", "invoice", "amount"]);

function rpcError(error: { message?: string } | null) {
  const code = error?.message?.trim() ?? "";
  return rpcErrors.has(code) ? code : "save";
}

export async function confirmDeposit(formData: FormData) {
  const back = returnPath(formData);
  const supabase = await createClient();
  const tx = await loadTransaction(supabase, clean(formData.get("tx_id"), 40));
  const customerId = clean(formData.get("customer_id"), 40);
  if (!tx || tx.kind !== "deposit" || !uuidPattern.test(customerId)) finish(back, "error=invalid");

  // Checkbox values are "customerId:invoiceId"; only the chosen customer's count.
  const invoiceIds = formData
    .getAll("invoice_ids")
    .map((value) => String(value).split(":"))
    .filter(([owner, id]) => owner === customerId && uuidPattern.test(id ?? ""))
    .map(([, id]) => id);

  // One database call: the deposit, its part payments and the invoices'
  // settled state change together or not at all.
  const { error } = await supabase.rpc("confirm_bank_deposit", {
    p_transaction_id: tx.id,
    p_customer_id: customerId,
    p_invoice_ids: invoiceIds,
  });
  if (error) finish(back, `error=${rpcError(error)}`);

  if (formData.get("remember") === "on") {
    await rememberRule(supabase, tx, { category: "customer_payment", customer_id: customerId });
  }

  revalidatePath(`/customers/${customerId}`);
  finish(back, "saved=deposit");
}

export async function categorizeTransaction(formData: FormData) {
  const back = returnPath(formData);
  const supabase = await createClient();
  const tx = await loadTransaction(supabase, clean(formData.get("tx_id"), 40));
  const category = clean(formData.get("category"), 40);
  const note = clean(formData.get("note"), 300);
  // A customer payment goes through confirmDeposit so invoices get settled.
  if (!tx || !isValidCategory(category, tx.kind) || category === "customer_payment") {
    finish(back, "error=invalid");
  }
  if (tx.kind === "deposit" && tx.review_status !== "pending") finish(back, "error=reviewed");

  const { error } = await supabase
    .from("bank_transactions")
    .update({
      category,
      category_source: "manual",
      customer_id: null,
      review_status: "confirmed",
      user_note: note || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", tx.id);
  if (error) finish(back, "error=save");

  let applied = 0;
  if (formData.get("remember") === "on") {
    const rule = await rememberRule(supabase, tx, { category, customer_id: null });
    if (rule && tx.kind === "withdrawal") {
      // Apply the new rule to the same counterparty's other waiting rows.
      const { data: pending } = await supabase
        .from("bank_transactions")
        .select("id,kind,review_status,amount_rial,counterparty_card,counterparty_name")
        .eq("kind", "withdrawal")
        .eq("review_status", "pending")
        .limit(1000);
      const ids = ((pending ?? []) as Array<TransactionRow>)
        .filter((row) => findRule([rule], row))
        .map((row) => row.id);
      if (ids.length) {
        await supabase
          .from("bank_transactions")
          .update({
            category,
            category_source: "rule",
            review_status: "confirmed",
            reviewed_at: new Date().toISOString(),
          })
          .in("id", ids);
        applied = ids.length;
      }
    }
  }

  finish(back, applied ? `saved=category&applied=${applied}` : "saved=category");
}

export async function ignoreTransaction(formData: FormData) {
  const back = returnPath(formData);
  const supabase = await createClient();
  const tx = await loadTransaction(supabase, clean(formData.get("tx_id"), 40));
  if (!tx) finish(back, "error=invalid");
  if (tx.review_status !== "pending") finish(back, "error=reviewed");
  const { error } = await supabase
    .from("bank_transactions")
    .update({ review_status: "ignored", reviewed_at: new Date().toISOString() })
    .eq("id", tx.id);
  finish(back, error ? "error=save" : "saved=ignored");
}

/** Back to "waiting for review"; invoices this deposit paid reopen. */
export async function reopenTransaction(formData: FormData) {
  const back = returnPath(formData);
  const supabase = await createClient();
  const tx = await loadTransaction(supabase, clean(formData.get("tx_id"), 40));
  if (!tx) finish(back, "error=invalid");
  const { error } = await supabase.rpc("reopen_bank_transaction", { p_transaction_id: tx.id });
  finish(back, error ? `error=${rpcError(error)}` : "saved=reopened");
}

export async function settleInvoiceManually(formData: FormData) {
  const back = returnPath(formData);
  const invoiceId = clean(formData.get("invoice_id"), 40);
  const note = clean(formData.get("note"), 300);
  if (!uuidPattern.test(invoiceId)) finish(back, "error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({
      settled_at: new Date().toISOString(),
      settled_source: "manual",
      settled_transaction_id: null,
      settled_note: note || "تسویه دستی",
    })
    .eq("id", invoiceId)
    .is("settled_at", null)
    .select("customer_id");
  if (error || !data?.length) finish(back, "error=save");
  revalidatePath(`/customers/${data[0].customer_id}`);
  finish(back, "saved=settled");
}

export async function reopenInvoice(formData: FormData) {
  const back = returnPath(formData);
  const invoiceId = clean(formData.get("invoice_id"), 40);
  if (!uuidPattern.test(invoiceId)) finish(back, "error=invalid");
  const supabase = await createClient();
  // Bank settlements are undone from the deposit, so its link stays consistent.
  const { data, error } = await supabase
    .from("invoices")
    .update({ settled_at: null, settled_source: null, settled_note: null })
    .eq("id", invoiceId)
    .eq("settled_source", "manual")
    .select("customer_id");
  if (error || !data?.length) finish(back, "error=save");
  revalidatePath(`/customers/${data[0].customer_id}`);
  finish(back, "saved=invoice-reopened");
}

export async function deleteRule(formData: FormData) {
  const back = returnPath(formData);
  const ruleId = clean(formData.get("rule_id"), 40);
  if (!uuidPattern.test(ruleId)) finish(back, "error=invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("bank_counterparty_rules").delete().eq("id", ruleId);
  finish(back, error ? "error=save" : "saved=rule-deleted");
}
