import { NextResponse } from "next/server";

import {
  normalizeIranMobile,
  sendPatternSms,
  SmsProviderError,
} from "@/lib/sms/melipayamak";
import {
  fillPatternText,
  patternArgs,
  patternBodyId,
  SMS_PATTERNS,
} from "@/lib/sms/patterns";
import { createClient } from "@/lib/supabase/server";

// One provider call plus bookkeeping.
export const runtime = "nodejs";
export const maxDuration = 30;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "ابتدا وارد برنامه شو." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "اطلاعات درخواست معتبر نیست." }, { status: 400 });
  }

  const pattern = SMS_PATTERNS.find((item) => item.key === body.pattern);
  const customerId = String(body.customerId ?? "").trim();
  const clientRequestId = String(body.clientRequestId ?? "").trim();
  if (!pattern || !uuidPattern.test(customerId) || !uuidPattern.test(clientRequestId)) {
    return NextResponse.json({ error: "اطلاعات درخواست معتبر نیست." }, { status: 400 });
  }

  const bodyId = patternBodyId(pattern);
  if (!process.env.MELIPAYAMAK_API_TOKEN?.trim() || bodyId === null) {
    return NextResponse.json(
      {
        error: `این الگو هنوز فعال نیست. کد الگو را در Vercel با نام ${pattern.envVar} و توکن را با نام MELIPAYAMAK_API_TOKEN تعریف کنید.`,
        code: "SMS_PATTERN_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const values =
    body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {};
  const parsed = patternArgs(pattern, values);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id,phone")
    .eq("id", customerId)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "مشتری پیدا نشد." }, { status: 404 });
  }

  const mobile = normalizeIranMobile(customer.phone as string | null);
  if (!mobile) {
    return NextResponse.json({ error: "شماره موبایل این مشتری معتبر نیست." }, { status: 400 });
  }

  const { data: pending, error: pendingError } = await supabase
    .from("sms_messages")
    .insert({
      client_request_id: clientRequestId,
      customer_id: customerId,
      source: pattern.source,
      mode: "pattern",
      sender: "service-line",
      recipient: mobile,
      message_text: fillPatternText(pattern, parsed.args),
      request_success: false,
      delivery_status: "unknown",
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    const { data: existing } = await supabase
      .from("sms_messages")
      .select("request_success")
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        existing.request_success
          ? { success: true, duplicate: true }
          : { error: "این درخواست قبلاً ثبت شده است؛ برای جلوگیری از پیام تکراری دوباره ارسال نشد." },
        { status: existing.request_success ? 200 : 409 },
      );
    }
    return NextResponse.json({ error: "ثبت امن درخواست پیامک انجام نشد." }, { status: 503 });
  }

  try {
    const result = await sendPatternSms({ bodyId, to: mobile, args: parsed.args });
    await supabase
      .from("sms_messages")
      .update({
        provider_rec_id: result.recId,
        request_success: result.success,
        provider_status: result.status || null,
        delivery_status: result.success ? "accepted" : "rejected",
        error_message: result.success ? null : result.status,
        sent_at: new Date().toISOString(),
      })
      .eq("id", pending.id);

    return NextResponse.json(
      result.success
        ? { success: true, recId: result.recId }
        : { error: `ملی پیامک ارسال را نپذیرفت: ${result.status}` },
      { status: result.success ? 200 : 502 },
    );
  } catch (error) {
    const ambiguous = !(error instanceof SmsProviderError) || error.ambiguous;
    const reason = error instanceof SmsProviderError && !ambiguous ? error.message : "";
    await supabase
      .from("sms_messages")
      .update({
        provider_status: ambiguous ? "provider_result_unknown" : "failed",
        delivery_status: ambiguous ? "unknown" : "failed",
        error_message: ambiguous
          ? "نتیجه Provider نامشخص است؛ ارسال خودکار تکرار نشود."
          : reason || "Provider درخواست را نپذیرفت.",
        provider_result_unknown_at: ambiguous ? new Date().toISOString() : null,
      })
      .eq("id", pending.id);

    return NextResponse.json(
      {
        error: ambiguous
          ? "نتیجه ارسال مشخص نشد؛ برای جلوگیری از پیام تکراری دوباره ارسال نکنید."
          : `سرویس پیامک درخواست را نپذیرفت${reason ? `: ${reason}` : "."}`,
      },
      { status: ambiguous ? 504 : 502 },
    );
  }
}
