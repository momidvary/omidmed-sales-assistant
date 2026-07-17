import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addTehranDaysAtTen } from "@/lib/campaigns/constants";
import {
  normalizeIranMobile,
  normalizeSender,
  personalizeSmsTemplate,
  sendMultipleSms,
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
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as CustomerRow[]));
  }
  return rows;
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
  const template = clean(body.template, 1500);
  const includeRetries = body.includeRetries === true;

  if (!campaignId || !template) {
    return NextResponse.json({ error: "کمپین یا متن پیامک کامل نیست." }, { status: 400 });
  }

  const [{ data: campaign, error: campaignError }, { data: members, error: memberError }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("id,name,target_product,status")
        .eq("id", campaignId)
        .single(),
      supabase
        .from("campaign_members")
        .select("id,customer_id,status")
        .eq("campaign_id", campaignId)
        .in("status", includeRetries ? ["pending", "no_answer", "follow_up"] : ["pending"])
        .limit(2500),
    ]);

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "کمپین پیدا نشد." }, { status: 404 });
  }
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const typedMembers = (members ?? []) as MemberRow[];
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خواندن مشتریان انجام نشد." },
      { status: 500 },
    );
  }

  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const targets: Target[] = [];
  const skipped: Array<{ customerId: string; reason: string }> = [];

  for (const member of typedMembers) {
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
      campaign_id: campaignId,
      mode: "multiple",
      sender,
      total_count: targets.length,
      success_count: 0,
      failed_count: 0,
      status: "processing",
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ error: "ثبت سابقه ارسال گروهی انجام نشد." }, { status: 500 });
  }

  const results: Array<Target & { success: boolean; recId: string | null; status: string }> = [];

  try {
    for (let index = 0; index < targets.length; index += 100) {
      const chunk = targets.slice(index, index + 100);
      const providerResults = await sendMultipleSms({
        sender,
        to: chunk.map((target) => target.mobile),
        text: chunk.map((target) => target.text),
      });

      providerResults.forEach((providerResult, resultIndex) => {
        results.push({
          ...chunk[resultIndex],
          success: providerResult.success,
          recId: providerResult.recId,
          status: providerResult.status,
        });
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "ارسال گروهی انجام نشد.";
    await supabase
      .from("sms_send_batches")
      .update({ status: "failed", failed_count: targets.length, provider_status: message, completed_at: new Date().toISOString() })
      .eq("id", batch.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const now = new Date().toISOString();
  const nextFollowupAt = addTehranDaysAtTen(3);
  const messageRows = results.map((result) => ({
    batch_id: batch.id,
    customer_id: result.customerId,
    campaign_id: campaignId,
    campaign_member_id: result.memberId,
    source: "campaign",
    mode: "multiple",
    sender,
    recipient: result.mobile,
    message_text: result.text,
    provider_rec_id: result.recId,
    request_success: result.success,
    provider_status: result.status || null,
    delivery_status: result.success ? "accepted" : "rejected",
    error_message: result.success ? null : result.status || "ارسال رد شد.",
    sent_at: now,
  }));

  for (let index = 0; index < messageRows.length; index += 200) {
    await supabase.from("sms_messages").insert(messageRows.slice(index, index + 200));
  }

  const successful = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);

  if (successful.length) {
    const memberIds = successful.map((result) => result.memberId);
    const customerIds = successful.map((result) => result.customerId);

    for (let index = 0; index < memberIds.length; index += 400) {
      await supabase
        .from("campaign_members")
        .update({ status: "contacted", contacted_at: now, next_followup_at: nextFollowupAt })
        .in("id", memberIds.slice(index, index + 400));
    }

    const followups = successful.map((result) => ({
      customer_id: result.customerId,
      channel: "sms",
      outcome: "follow_up_later",
      notes: `پیامک کمپین «${campaign.name}» ارسال شد: ${result.text.slice(0, 500)}`,
      next_followup_at: nextFollowupAt,
      campaign_id: campaignId,
      campaign_member_id: result.memberId,
    }));
    for (let index = 0; index < followups.length; index += 200) {
      await supabase.from("followups").insert(followups.slice(index, index + 200));
    }

    for (let index = 0; index < customerIds.length; index += 400) {
      await supabase
        .from("customers")
        .update({ next_followup_at: nextFollowupAt })
        .in("id", customerIds.slice(index, index + 400));
    }
  }

  await supabase
    .from("sms_send_batches")
    .update({
      status: failed.length ? (successful.length ? "partial" : "failed") : "completed",
      success_count: successful.length,
      failed_count: failed.length,
      provider_status: failed[0]?.status || null,
      completed_at: now,
    })
    .eq("id", batch.id);

  return NextResponse.json({
    success: true,
    total: targets.length,
    successCount: successful.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    batchId: batch.id,
  });
}
