import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addTehranDaysAtTen } from "@/lib/campaigns/constants";
import {
  normalizeIranMobile,
  normalizeSender,
  sendSimpleSms,
} from "@/lib/sms/melipayamak";

const allowedSources = new Set([
  "manual",
  "customer",
  "quote",
  "campaign",
  "accounting",
]);

function clean(value: unknown, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: auth, error: authError } =
    await supabase.auth.getUser();

  if (authError || !auth.user) {
    return NextResponse.json(
      { error: "ابتدا وارد برنامه شو." },
      { status: 401 },
    );
  }

  const { error: tableError } = await supabase
    .from("sms_messages")
    .select("id")
    .limit(1);

  if (tableError) {
    return NextResponse.json(
      {
        error:
          "ابتدا فایل SQL مرحله پیامک را در Supabase اجرا کن.",
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "اطلاعات درخواست معتبر نیست." },
      { status: 400 },
    );
  }

  const customerId = clean(body.customerId, 80) || null;
  const campaignId = clean(body.campaignId, 80) || null;
  const campaignMemberId =
    clean(body.campaignMemberId, 80) || null;
  const opportunityId = clean(body.opportunityId, 80) || null;
  const text = clean(body.text, 1500);
  const sourceValue = clean(body.source, 30);
  const source = allowedSources.has(sourceValue)
    ? sourceValue
    : "manual";
  const scheduleFollowup = body.scheduleFollowup !== false;

  if (!text) {
    return NextResponse.json(
      { error: "متن پیامک خالی است." },
      { status: 400 },
    );
  }

  let customer: {
    id: string;
    name: string;
    phone: string | null;
  } | null = null;

  if (customerId) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone")
      .eq("id", customerId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "مشتری پیدا نشد." },
        { status: 404 },
      );
    }

    customer = data as {
      id: string;
      name: string;
      phone: string | null;
    };
  }

  const mobile = normalizeIranMobile(
    customer?.phone || clean(body.mobile, 30),
  );

  if (!mobile) {
    return NextResponse.json(
      { error: "شماره موبایل معتبر نیست." },
      { status: 400 },
    );
  }

  const sender = normalizeSender(
    process.env.MELIPAYAMAK_SENDER,
  );

  if (!sender) {
    return NextResponse.json(
      {
        error:
          "شماره خط فرستنده ملی پیامک تنظیم نشده است.",
      },
      { status: 503 },
    );
  }

  let providerResult: Awaited<
    ReturnType<typeof sendSimpleSms>
  >;

  try {
    providerResult = await sendSimpleSms({
      sender,
      to: mobile,
      text,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ارسال پیامک انجام نشد.";

    await supabase.from("sms_messages").insert({
      customer_id: customerId,
      campaign_id: campaignId,
      campaign_member_id: campaignMemberId,
      opportunity_id: opportunityId,
      source,
      mode: "multiple",
      sender,
      recipient: mobile,
      message_text: text,
      request_success: false,
      provider_status: message,
      delivery_status: "failed",
      error_message: message,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 502 },
    );
  }

  const rejectionMessage =
    providerResult.status ||
    "سرویس ملی پیامک، ارسال را نپذیرفت.";

  const { error: logError } = await supabase
    .from("sms_messages")
    .insert({
      customer_id: customerId,
      campaign_id: campaignId,
      campaign_member_id: campaignMemberId,
      opportunity_id: opportunityId,
      source,
      mode: "multiple",
      sender,
      recipient: mobile,
      message_text: text,
      provider_rec_id: providerResult.recId,
      request_success: providerResult.success,
      provider_status: providerResult.status || null,
      delivery_status: providerResult.success
        ? "accepted"
        : "rejected",
      error_message: providerResult.success
        ? null
        : rejectionMessage,
      sent_at: new Date().toISOString(),
    });

  if (logError) {
    return NextResponse.json(
      {
        success: providerResult.success,
        recId: providerResult.recId,
        error: providerResult.success
          ? undefined
          : rejectionMessage,
        warning:
          "پیام به سرویس ارسال شد، اما ثبت سابقه در برنامه انجام نشد.",
      },
      { status: providerResult.success ? 200 : 502 },
    );
  }

  if (providerResult.success && customerId) {
    const nextFollowupAt = scheduleFollowup
      ? addTehranDaysAtTen(3)
      : null;

    await supabase.from("followups").insert({
      customer_id: customerId,
      channel: "sms",
      outcome: "follow_up_later",
      notes: `پیامک ارسال شد: ${text.slice(0, 500)}`,
      next_followup_at: nextFollowupAt,
      campaign_id: campaignId,
      campaign_member_id: campaignMemberId,
      opportunity_id: opportunityId,
    });

    if (scheduleFollowup) {
      await supabase
        .from("customers")
        .update({ next_followup_at: nextFollowupAt })
        .eq("id", customerId);
    }

    if (campaignMemberId) {
      await supabase
        .from("campaign_members")
        .update({
          status: "contacted",
          contacted_at: new Date().toISOString(),
          next_followup_at: nextFollowupAt,
        })
        .eq("id", campaignMemberId);
    }

    if (opportunityId) {
      await supabase
        .from("sales_opportunities")
        .update({
          last_contact_at: new Date().toISOString(),
          next_followup_at: nextFollowupAt,
        })
        .eq("id", opportunityId);
    }
  }

  return NextResponse.json(
    {
      success: providerResult.success,
      recId: providerResult.recId,
      status: providerResult.status,
      error: providerResult.success
        ? undefined
        : rejectionMessage,
      mobile,
    },
    { status: providerResult.success ? 200 : 502 },
  );
}
