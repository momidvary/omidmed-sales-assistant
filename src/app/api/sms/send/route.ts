import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addTehranDaysAtTen } from "@/lib/campaigns/constants";
import {
  normalizeIranMobile,
  normalizeSender,
  ensureSingleSmsOptOut,
  sendSimpleSms,
  SmsProviderError,
} from "@/lib/sms/melipayamak";

const allowedSources = new Set([
  "manual",
  "customer",
  "quote",
  "campaign",
  "accounting",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const rawText = clean(body.text, 1500);
  const sourceValue = clean(body.source, 30);
  const source = allowedSources.has(sourceValue)
    ? sourceValue
    : "manual";
  const text = source === "campaign" ? ensureSingleSmsOptOut(rawText) : rawText;
  const scheduleFollowup = body.scheduleFollowup !== false;
  const clientRequestId = clean(body.clientRequestId, 80);

  if (!rawText || !uuidPattern.test(clientRequestId)) {
    return NextResponse.json(
      { error: "متن یا شناسه امن درخواست پیامک معتبر نیست." },
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

  const { data: pending, error: pendingError } = await supabase
    .from("sms_messages")
    .insert({
      client_request_id: clientRequestId,
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
      delivery_status: "unknown",
    })
    .select("id,request_success,delivery_status,provider_rec_id")
    .single();

  if (pendingError || !pending) {
    const { data: existing } = await supabase
      .from("sms_messages")
      .select("id,request_success,delivery_status,provider_rec_id")
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          success: existing.request_success,
          duplicate: true,
          recId: existing.provider_rec_id,
          status: existing.delivery_status,
          code:
            existing.delivery_status === "unknown"
              ? "PROVIDER_RESULT_UNKNOWN"
              : "DUPLICATE_REQUEST",
        },
        { status: existing.request_success ? 200 : 409 },
      );
    }
    return NextResponse.json(
      { success: false, code: "SMS_REQUEST_SAVE_FAILED", error: "ثبت امن درخواست پیامک انجام نشد." },
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
    const ambiguous = !(error instanceof SmsProviderError) || error.ambiguous;
    await supabase
      .from("sms_messages")
      .update({
        request_success: false,
        provider_status: ambiguous ? "provider_result_unknown" : "failed",
        delivery_status: ambiguous ? "unknown" : "failed",
        error_message: ambiguous
          ? "نتیجه Provider نامشخص است؛ ارسال خودکار تکرار نشود."
          : "Provider درخواست را نپذیرفت.",
        provider_result_unknown_at: ambiguous ? new Date().toISOString() : null,
      })
      .eq("id", pending.id);

    return NextResponse.json(
      {
        success: false,
        code: ambiguous ? "PROVIDER_RESULT_UNKNOWN" : "PROVIDER_REJECTED",
        error: ambiguous
          ? "نتیجه ارسال مشخص نشد؛ برای جلوگیری از پیام تکراری دوباره ارسال نکنید."
          : "سرویس پیامک درخواست را نپذیرفت.",
      },
      { status: ambiguous ? 504 : 502 },
    );
  }

  const rejectionMessage =
    providerResult.status ||
    "سرویس ملی پیامک، ارسال را نپذیرفت.";

  const { error: logError } = await supabase
    .from("sms_messages")
    .update({
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
    })
    .eq("id", pending.id);

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

  if (providerResult.success) {
    const nextFollowupAt = scheduleFollowup
      ? addTehranDaysAtTen(3)
      : null;
    await supabase.rpc("record_sms_crm_outcome", {
      p_sms_message_id: pending.id,
      p_next_followup_at: nextFollowupAt,
    });
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
