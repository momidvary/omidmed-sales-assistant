import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeIranMobile, sendPatternSms, SmsProviderError } from "@/lib/sms/melipayamak";
import {
  fillPatternText,
  patternArgs,
  patternBodyId,
  patternItemsSummary,
  SMS_PATTERNS,
} from "@/lib/sms/patterns";

// Sends the approved "order registered" pattern for invoices that arrived
// from Holoo since the last sync. Runs on the server with the service-role
// client after the agent's final batch.

/** Only invoices created in Holoo this recently are messaged. */
const MAX_INVOICE_AGE_MS = 2 * 86_400_000;
/** Cap per sync run; the rest go out on the next run 15 minutes later. */
const MAX_PER_RUN = 20;
/** Stop starting new sends after this long; the sync route has 60s in total. */
const TIME_BUDGET_MS = 30_000;

const orderPattern = SMS_PATTERNS.find((pattern) => pattern.key === "order")!;
const persianNumber = new Intl.NumberFormat("fa-IR");

export type AutoOrderSmsSummary = {
  enabled: boolean;
  sent: number;
  failed: number;
  skipped: number;
};

export function autoOrderSmsEnabled(env: Record<string, string | undefined> = process.env) {
  if ((env.MELIPAYAMAK_AUTO_ORDER_SMS ?? "").trim().toLowerCase() === "off") return false;
  return Boolean(env.MELIPAYAMAK_API_TOKEN?.trim()) && patternBodyId(orderPattern, env) !== null;
}

type PendingInvoice = {
  id: string;
  customer_id: string;
  invoice_number: string | null;
  total_amount: number | string | null;
};

async function markInvoice(admin: SupabaseClient, id: string, status: string) {
  await admin.from("invoices").update({ order_sms_status: status }).eq("id", id);
}

export async function sendAutoOrderSms(
  admin: SupabaseClient,
  ownerId: string,
  now = new Date(),
): Promise<AutoOrderSmsSummary> {
  const summary: AutoOrderSmsSummary = { enabled: autoOrderSmsEnabled(), sent: 0, failed: 0, skipped: 0 };
  const bodyId = patternBodyId(orderPattern);
  if (!summary.enabled || bodyId === null) return summary;

  const { data: pending, error } = await admin
    .from("invoices")
    .select("id,customer_id,invoice_number,total_amount")
    .eq("owner_id", ownerId)
    .is("order_sms_at", null)
    .gte("holo_creation_at", new Date(now.getTime() - MAX_INVOICE_AGE_MS).toISOString())
    .or("holo_is_deleted.is.null,holo_is_deleted.eq.false")
    .gt("total_amount", 0)
    .not("customer_id", "is", null)
    .order("holo_creation_at", { ascending: true })
    .limit(MAX_PER_RUN);

  // Before migration 025 the column does not exist; the sync itself must
  // never fail because of the optional SMS step.
  if (error || !pending?.length) return summary;

  const startedAt = Date.now();
  for (const invoice of pending as PendingInvoice[]) {
    // Unclaimed invoices simply wait for the next run.
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    // Claim first: only one concurrent run can flip order_sms_at from null.
    const { data: claimed } = await admin
      .from("invoices")
      .update({ order_sms_at: now.toISOString(), order_sms_status: "sending" })
      .eq("id", invoice.id)
      .is("order_sms_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const [{ data: customer }, { data: items }] = await Promise.all([
      admin.from("customers").select("name,contact_name,phone").eq("id", invoice.customer_id).maybeSingle(),
      admin
        .from("invoice_items")
        .select("product_name,quantity")
        .eq("invoice_id", invoice.id)
        .order("row_number", { ascending: true }),
    ]);

    const mobile = normalizeIranMobile((customer?.phone as string | null) ?? null);
    const invoiceNumber = String(invoice.invoice_number ?? "").trim();
    if (!customer || !mobile || !invoiceNumber) {
      summary.skipped += 1;
      await markInvoice(admin, invoice.id, !mobile ? "skipped_no_mobile" : "skipped_incomplete");
      continue;
    }

    const name = String(customer.contact_name || customer.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const parsed = patternArgs(orderPattern, {
      title: "آقا/خانم",
      lastName: name,
      invoice: invoiceNumber.slice(0, 20),
      items: patternItemsSummary((items ?? []) as Array<{ product_name: string | null; quantity: number | null }>),
      amount: persianNumber.format(Math.round(Number(invoice.total_amount ?? 0))),
    });
    if ("error" in parsed) {
      summary.skipped += 1;
      await markInvoice(admin, invoice.id, "skipped_incomplete");
      continue;
    }

    // The invoice id doubles as the request id: the unique index on
    // (owner_id, client_request_id) makes a second message impossible.
    const { data: message, error: insertError } = await admin
      .from("sms_messages")
      .insert({
        owner_id: ownerId,
        client_request_id: invoice.id,
        customer_id: invoice.customer_id,
        source: "customer",
        mode: "pattern",
        sender: "service-line",
        recipient: mobile,
        message_text: fillPatternText(orderPattern, parsed.args),
        request_success: false,
        delivery_status: "unknown",
      })
      .select("id")
      .single();
    if (insertError || !message) {
      summary.skipped += 1;
      await markInvoice(admin, invoice.id, "skipped_duplicate");
      continue;
    }

    try {
      const result = await sendPatternSms({ bodyId, to: mobile, args: parsed.args });
      await admin
        .from("sms_messages")
        .update({
          provider_rec_id: result.recId,
          request_success: result.success,
          provider_status: result.status || null,
          delivery_status: result.success ? "accepted" : "rejected",
          error_message: result.success ? null : result.status,
          sent_at: new Date().toISOString(),
        })
        .eq("id", message.id);
      await markInvoice(admin, invoice.id, result.success ? "sent" : "failed");
      if (result.success) summary.sent += 1;
      else summary.failed += 1;
    } catch (caught) {
      const ambiguous = !(caught instanceof SmsProviderError) || caught.ambiguous;
      await admin
        .from("sms_messages")
        .update({
          provider_status: ambiguous ? "provider_result_unknown" : "failed",
          delivery_status: ambiguous ? "unknown" : "failed",
          error_message: caught instanceof Error ? caught.message.slice(0, 300) : "ارسال انجام نشد.",
          provider_result_unknown_at: ambiguous ? new Date().toISOString() : null,
        })
        .eq("id", message.id);
      await markInvoice(admin, invoice.id, ambiguous ? "unknown" : "failed");
      summary.failed += 1;
    }
  }

  return summary;
}
