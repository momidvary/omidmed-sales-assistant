import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addTehranDaysAtTen } from "@/lib/campaigns/constants";

// Sends in chunks of 100 across up to 2,500 campaign members, so this is the
// longest-running SMS path. Without an explicit ceiling the platform default
// can kill it mid-campaign, leaving the batch row stuck at 'processing' with
// some recipients messaged and some not.
export const runtime = "nodejs";
export const maxDuration = 60;
import {
  normalizeIranMobile,
  normalizeSender,
  ensureSingleSmsOptOut,
  personalizeSmsTemplate,
  sendMultipleSms,
  SmsProviderError,
} from "@/lib/sms/melipayamak";

type MemberRow = { id: string; customer_id: string; status: string };
type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  days_since_last_purchase: number | string | null;
};

type Target = {
  memberId: string;
  customerId: string;
  mobile: string;
  text: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown, maxLength = 1500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function fetchCustomers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
) {
  const rows: CustomerRow[] = [];
  for (let index = 0; index < ids.length; index += 400) {
    const { data, error } = await supabase
      .from("customer_sales_summary")
      .select("id,name,phone,city,days_since_last_purchase")
      .in("id", ids.slice(index, index + 400));
    if (error) throw new Error("CUSTOMERS_READ_FAILED");
    rows.push(...((data ?? []) as CustomerRow[]));
  }
  return rows;
}

async function fetchCampaignMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  statuses: string[],
) {
  const rows: MemberRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("campaign_members")
      .select("id,customer_id,status")
      .eq("campaign_id", campaignId)
      .in("status", statuses)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("CAMPAIGN_MEMBERS_READ_FAILED");
    const page = (data ?? []) as MemberRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchAmbiguousMemberIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
) {
  const ids = new Set<string>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("sms_messages")
      .select("campaign_member_id")
      .eq("campaign_id", campaignId)
      .not("campaign_member_id", "is", null)
      .not("provider_result_unknown_at", "is", null)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("AMBIGUOUS_SMS_READ_FAILED");
    const page = (data ?? []) as Array<{ campaign_member_id: string | null }>;
    page.forEach((row) => {
      if (row.campaign_member_id) ids.add(row.campaign_member_id);
    });
    if (page.length < pageSize) break;
  }
  return ids;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "ابتدا وارد برنامه شو." }, { status: 401 });
  }

  const { error: tableError } = await supabase.from("sms_send_batches").select("id").limit(1);
  if (tableError) {
    return NextResponse.json(
      { error: "ابتدا فایل SQL مرحله پیامک را در Supabase اجرا کن." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "اطلاعات درخواست معتبر نیست." }, { status: 400 });
  }

  const campaignId = clean(body.campaignId, 80);
  const rawTemplate = clean(body.template, 1500);
  const template = ensureSingleSmsOptOut(rawTemplate);
  const includeRetries = body.includeRetries === true;
  const clientRequestId = clean(body.clientRequestId, 80);

  if (!campaignId || !rawTemplate || !uuidPattern.test(clientRequestId)) {
    return NextResponse.json({ error: "کمپین یا متن پیامک کامل نیست." }, { status: 400 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,target_product,status")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "کمپین پیدا نشد." }, { status: 404 });
  }
  let typedMembers: MemberRow[];
  let ambiguousMemberIds: Set<string>;
  try {
    [typedMembers, ambiguousMemberIds] = await Promise.all([
      fetchCampaignMembers(
        supabase,
        campaignId,
        includeRetries ? ["pending", "no_answer", "follow_up"] : ["pending"],
      ),
      fetchAmbiguousMemberIds(supabase, campaignId),
    ]);
  } catch {
    return NextResponse.json(
      { error: "خواندن امن مخاطبان کمپین انجام نشد." },
      { status: 500 },
    );
  }
  if (!typedMembers.length) {
    return NextResponse.json(
      { error: "مشتری ارسال‌نشده‌ای در این کمپین باقی نمانده است." },
      { status: 400 },
    );
  }

  let customers: CustomerRow[];
  try {
    customers = await fetchCustomers(
      supabase,
      typedMembers.map((member) => member.customer_id),
    );
  } catch {
    return NextResponse.json(
      { error: "خواندن امن مشتریان انجام نشد. شناسه خطا: SMS-CAMPAIGN-CUSTOMERS" },
      { status: 500 },
    );
  }

  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const targets: Target[] = [];
  const skipped: Array<{ customerId: string; reason: string }> = [];

  for (const member of typedMembers) {
    if (ambiguousMemberIds.has(member.id)) {
      skipped.push({
        customerId: member.customer_id,
        reason: "نتیجه ارسال قبلی نامشخص است",
      });
      continue;
    }
    const customer = customerMap.get(member.customer_id);
    const mobile = normalizeIranMobile(customer?.phone);
    if (!customer || !mobile) {
      skipped.push({ customerId: member.customer_id, reason: "شماره موبایل نامعتبر" });
      continue;
    }

    targets.push({
      memberId: member.id,
      customerId: customer.id,
      mobile,
      text: personalizeSmsTemplate(template, {
        name: customer.name,
        city: customer.city,
        product: campaign.target_product,
        days: customer.days_since_last_purchase,
      }),
    });
  }

  if (!targets.length) {
    return NextResponse.json({ error: "هیچ شماره موبایل معتبری پیدا نشد." }, { status: 400 });
  }

  const sender = normalizeSender(process.env.MELIPAYAMAK_SENDER);
  if (!sender) {
    return NextResponse.json(
      { error: "شماره خط فرستنده ملی پیامک تنظیم نشده است." },
      { status: 503 },
    );
  }

  const { data: batch, error: batchError } = await supabase
    .from("sms_send_batches")
    .insert({
      client_request_id: clientRequestId,
      campaign_id: campaignId,
      mode: "multiple",
      sender,
      total_count: targets.length,
      success_count: 0,
      failed_count: 0,
      unknown_count: 0,
      unattempted_count: targets.length,
      status: "processing",
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    const { data: existing } = await supabase
      .from("sms_send_batches")
      .select("id,status,total_count,success_count,failed_count,unknown_count,unattempted_count")
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          success: existing.status === "completed",
          duplicate: true,
          code:
            existing.status === "unknown"
              ? "PROVIDER_RESULT_UNKNOWN"
              : "DUPLICATE_REQUEST",
          batchId: existing.id,
          total: existing.total_count,
          successCount: existing.success_count,
          failedCount: existing.failed_count,
          unknownCount: existing.unknown_count,
          unattemptedCount: existing.unattempted_count,
          error:
            existing.status === "unknown"
              ? "نتیجه بخشی از ارسال قبلی نامشخص است؛ ارسال خودکار تکرار نشد."
              : undefined,
        },
        { status: existing.status === "completed" ? 200 : 409 },
      );
    }
    return NextResponse.json({ error: "ثبت امن سابقه ارسال گروهی انجام نشد." }, { status: 503 });
  }

  type StoredMessage = { id: string; campaign_member_id: string | null };
  const storedMessages: StoredMessage[] = [];
  const pendingRows = targets.map((target) => ({
    batch_id: batch.id,
    customer_id: target.customerId,
    campaign_id: campaignId,
    campaign_member_id: target.memberId,
    source: "campaign",
    mode: "multiple",
    sender,
    recipient: target.mobile,
    message_text: target.text,
    request_success: false,
    delivery_status: "unknown",
  }));

  for (let index = 0; index < pendingRows.length; index += 200) {
    const { data, error } = await supabase
      .from("sms_messages")
      .insert(pendingRows.slice(index, index + 200))
      .select("id,campaign_member_id");
    if (error) {
      await supabase
        .from("sms_send_batches")
        .update({
          status: "failed",
          unattempted_count: targets.length,
          provider_status: "message_persistence_failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", batch.id);
      return NextResponse.json(
        { error: "ذخیره امن پیام‌های کمپین انجام نشد؛ هیچ پیامی ارسال نشد." },
        { status: 503 },
      );
    }
    storedMessages.push(...((data ?? []) as StoredMessage[]));
  }

  const messageIdByMember = new Map(
    storedMessages.map((message) => [message.campaign_member_id, message.id]),
  );
  const results: Array<
    Target & { messageId: string; success: boolean; recId: string | null; status: string }
  > = [];
  let providerFailure: { ambiguous: boolean; attempted: number } | null = null;
  let persistenceFailure = false;
  let persistenceUnknownCount = 0;

  for (let index = 0; index < targets.length; index += 100) {
    const chunk = targets.slice(index, index + 100);
    try {
      const providerResults = await sendMultipleSms({
        sender,
        to: chunk.map((target) => target.mobile),
        text: chunk.map((target) => target.text),
      });
      const recordedAt = new Date().toISOString();
      const updates = await Promise.all(
        providerResults.map(async (providerResult, resultIndex) => {
          const target = chunk[resultIndex];
          const messageId = messageIdByMember.get(target.memberId);
          if (!messageId) return false;
          const { error } = await supabase
            .from("sms_messages")
            .update({
              provider_rec_id: providerResult.recId,
              request_success: providerResult.success,
              provider_status: providerResult.status || null,
              delivery_status: providerResult.success ? "accepted" : "rejected",
              error_message: providerResult.success ? null : "سرویس پیامک این گیرنده را نپذیرفت.",
              sent_at: recordedAt,
            })
            .eq("id", messageId);
          if (!error) {
            results.push({
              ...target,
              messageId,
              success: providerResult.success,
              recId: providerResult.recId,
              status: providerResult.status,
            });
          }
          return !error;
        }),
      );
      if (updates.some((updated) => !updated)) {
        persistenceFailure = true;
        persistenceUnknownCount = updates.filter((updated) => !updated).length;
        break;
      }
    } catch (error) {
      const ambiguous = !(error instanceof SmsProviderError) || error.ambiguous;
      const attemptedAt = new Date().toISOString();
      const ids = chunk
        .map((target) => messageIdByMember.get(target.memberId))
        .filter((id): id is string => Boolean(id));
      if (ids.length) {
        await supabase
          .from("sms_messages")
          .update({
            provider_status: ambiguous ? "provider_result_unknown" : "provider_rejected",
            delivery_status: ambiguous ? "unknown" : "failed",
            error_message: ambiguous
              ? "نتیجه Provider نامشخص است؛ ارسال خودکار تکرار نشود."
              : "Provider درخواست گروهی را نپذیرفت.",
            provider_result_unknown_at: ambiguous ? attemptedAt : null,
          })
          .in("id", ids);
      }
      providerFailure = { ambiguous, attempted: chunk.length };
      break;
    }
  }

  const successful = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);
  const nextFollowupAt = addTehranDaysAtTen(3);
  let crmFailure = false;
  for (const result of successful) {
    const { error } = await supabase.rpc("record_sms_crm_outcome", {
      p_sms_message_id: result.messageId,
      p_next_followup_at: nextFollowupAt,
    });
    if (error) crmFailure = true;
  }

  const completedAt = new Date().toISOString();
  const attemptedCount =
    results.length + (providerFailure?.attempted ?? 0) + persistenceUnknownCount;
  const unknownCount =
    (providerFailure?.ambiguous ? providerFailure.attempted : 0) +
    persistenceUnknownCount;
  const definiteProviderFailureCount = providerFailure && !providerFailure.ambiguous
    ? providerFailure.attempted
    : 0;
  const unattemptedCount = Math.max(0, targets.length - attemptedCount);
  const failedCount = failed.length + definiteProviderFailureCount;
  const batchStatus = providerFailure?.ambiguous || persistenceFailure
    ? "unknown"
    : providerFailure
      ? successful.length
        ? "partial"
        : "failed"
      : failed.length
        ? successful.length
          ? "partial"
          : "failed"
        : "completed";

  await supabase
    .from("sms_send_batches")
    .update({
      status: batchStatus,
      success_count: successful.length,
      failed_count: failedCount,
      unknown_count: unknownCount,
      unattempted_count: unattemptedCount,
      provider_status: providerFailure
        ? providerFailure.ambiguous
          ? "provider_result_unknown"
          : "provider_rejected"
        : persistenceFailure
          ? "result_persistence_unknown"
          : failed[0]?.status || null,
      provider_result_unknown_at:
        providerFailure?.ambiguous || persistenceFailure ? completedAt : null,
      completed_at: completedAt,
    })
    .eq("id", batch.id);

  if (providerFailure || persistenceFailure) {
    const ambiguous = providerFailure?.ambiguous || persistenceFailure;
    return NextResponse.json(
      {
        success: false,
        code: ambiguous ? "PROVIDER_RESULT_UNKNOWN" : "PROVIDER_REJECTED",
        error: ambiguous
          ? "نتیجه بخشی از ارسال نامشخص است؛ برای جلوگیری از پیام تکراری دوباره ارسال نکنید."
          : "سرویس پیامک ادامه ارسال کمپین را نپذیرفت.",
        total: targets.length,
        successCount: successful.length,
        failedCount,
        unknownCount,
        unattemptedCount,
        skippedCount: skipped.length,
        batchId: batch.id,
      },
      { status: ambiguous ? 504 : 502 },
    );
  }

  return NextResponse.json({
    success: true,
    total: targets.length,
    successCount: successful.length,
    failedCount,
    unknownCount: 0,
    unattemptedCount: 0,
    skippedCount: skipped.length,
    batchId: batch.id,
    warning: crmFailure
      ? "ارسال ثبت شد، اما ثبت پیگیری CRM برای بخشی از پیام‌ها نیازمند بررسی است."
      : undefined,
  });
}
