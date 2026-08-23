import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { WHATSAPP_CONTENT_TYPES } from "@/lib/content-studio/generation";
import {
  removeUnsupportedMedicalClaims,
  type ProductGrounding,
} from "@/lib/content-studio/quality";
import { isStoredWhatsAppPayload } from "@/lib/content-studio/whatsapp-legacy";
import { createClient } from "@/lib/supabase/server";
import {
  buildImagePayload,
  buildTemplatePayload,
  buildTextPayload,
  isAmbiguousWhatsAppProviderError,
  loadWhatsAppCloudConfig,
  sendWhatsAppMessage,
  WhatsAppCloudError,
  type WhatsAppMessageType,
} from "@/lib/whatsapp/cloud-api";
import { validateSendPolicy } from "@/lib/whatsapp/send-policy";

export const runtime = "nodejs";
export const maxDuration = 30;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SendBody = {
  contentItemId?: unknown;
  customerId?: unknown;
  clientRequestId?: unknown;
  confirmed?: unknown;
  messageType?: unknown;
  messageText?: unknown;
  imageUrl?: unknown;
  templateName?: unknown;
  templateVariables?: unknown;
  templateLanguage?: unknown;
  templateApprovedConfirmed?: unknown;
  conversationWindowConfirmed?: unknown;
};

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

async function loadProductGrounding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  productId: string | null,
): Promise<ProductGrounding | null> {
  if (!productId) return null;
  const { data, error } = await supabase
    .from("costing_products")
    .select(
      "name,category,brand,model,technical_specifications,applications,target_specialties,advantages,differentiators,current_cash_price,inventory_status,warranty,after_sales_service,training,approved_marketing_claims,primary_image_path",
    )
    .eq("id", productId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    name: data.name,
    category: data.category,
    brand: data.brand,
    model: data.model,
    technicalSpecifications: data.technical_specifications,
    applications: data.applications,
    targetSpecialties: data.target_specialties,
    advantages: data.advantages,
    differentiators: data.differentiators,
    price: data.current_cash_price,
    inventoryStatus: data.inventory_status,
    warranty: data.warranty,
    afterSalesService: data.after_sales_service,
    training: data.training,
    approvedMarketingClaims: data.approved_marketing_claims,
    hasRealImage: Boolean(data.primary_image_path),
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 32_000) {
    return errorResponse("PAYLOAD_TOO_LARGE", "درخواست بیش از حد بزرگ است.", 413);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("UNAUTHORIZED", "ورود به حساب لازم است.", 401);

  let body: SendBody;
  try {
    body = JSON.parse(rawBody) as SendBody;
  } catch {
    return errorResponse("INVALID_JSON", "ساختار درخواست معتبر نیست.", 400);
  }

  const contentItemId = typeof body.contentItemId === "string" ? body.contentItemId : "";
  const customerId = typeof body.customerId === "string" ? body.customerId : "";
  const clientRequestId =
    typeof body.clientRequestId === "string" ? body.clientRequestId : "";
  const messageType = body.messageType as WhatsAppMessageType;
  if (
    !uuidPattern.test(contentItemId) ||
    !uuidPattern.test(customerId) ||
    !uuidPattern.test(clientRequestId) ||
    !["text", "image", "template"].includes(messageType)
  ) {
    return errorResponse("INVALID_INPUT", "اطلاعات ارسال کامل یا معتبر نیست.", 400);
  }

  const [contentResult, customerResult] = await Promise.all([
    supabase
      .from("content_items")
      .select("id,created_by,channel,channel_payload,image_path,image_url,product_id")
      .eq("id", contentItemId)
      .eq("created_by", user.id)
      .maybeSingle(),
    supabase
      .from("customers")
      .select("id,owner_id,phone,normalized_phone,whatsapp_consent_status")
      .eq("id", customerId)
      .eq("owner_id", user.id)
      .maybeSingle(),
  ]);

  if (contentResult.error || customerResult.error) {
    return errorResponse(
      "WHATSAPP_SCHEMA_UNAVAILABLE",
      "ساختار واتساپ هنوز روی پایگاه داده آماده نشده است.",
      503,
    );
  }
  const content = contentResult.data;
  const customer = customerResult.data;
  if (!content || content.channel !== "whatsapp") {
    return errorResponse("CONTENT_NOT_FOUND", "محتوای واتساپ در دسترس نیست.", 404);
  }
  if (!isStoredWhatsAppPayload(content.channel_payload)) {
    return errorResponse("INVALID_CONTENT", "ساختار ذخیره‌شده محتوای واتساپ معتبر نیست.", 400);
  }
  const channelPayload = content.channel_payload;
  if (!WHATSAPP_CONTENT_TYPES.includes(channelPayload.content_type as never)) {
    return errorResponse("INVALID_CONTENT", "ساختار محتوای واتساپ معتبر نیست.", 400);
  }
  if (channelPayload.content_type === "status") {
    return errorResponse(
      "STATUS_MANUAL_ONLY",
      "استاتوس فقط برای کپی و دانلود آماده می‌شود و ارسال API ندارد.",
      400,
    );
  }
  if (!customer) {
    return errorResponse("CUSTOMER_NOT_FOUND", "مشتری در دسترس نیست.", 404);
  }

  const messageText = typeof body.messageText === "string" ? body.messageText.trim() : "";
  if (messageType !== "template") {
    const savedTexts = [
      channelPayload.whatsapp_short_text,
      channelPayload.whatsapp_long_text,
      channelPayload.whatsapp_status_text,
    ].map((value) => value.trim());
    if (!messageText || !savedTexts.includes(messageText)) {
      return errorResponse(
        "CONTENT_NOT_SAVED",
        "متن تغییر کرده یا ذخیره نشده است؛ ابتدا نسخه محتوا را ذخیره و سپس دوباره ارسال را تأیید کنید.",
        409,
      );
    }

    const product = await loadProductGrounding(supabase, user.id, content.product_id);
    const guarded = removeUnsupportedMedicalClaims(messageText, product);
    if (guarded.removed.length || guarded.text !== messageText) {
      return errorResponse(
        "UNSUPPORTED_CONTENT_CLAIM",
        "متن ذخیره‌شده شامل قیمت، موجودی یا ادعایی است که با اطلاعات تأییدشده محصول تطابق ندارد؛ ابتدا محتوا را اصلاح و ذخیره کنید.",
        400,
      );
    }
  }

  const config = loadWhatsAppCloudConfig();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !supabaseUrl || !serviceKey) {
    return errorResponse("SERVER_CONFIG_MISSING", "تنظیمات امن سرور و Meta کامل نیست.", 503);
  }
  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const templateName = typeof body.templateName === "string" ? body.templateName.trim() : "";
  const templateLanguage =
    typeof body.templateLanguage === "string" ? body.templateLanguage.trim() : "fa";
  const templateVariables = Array.isArray(body.templateVariables)
    ? body.templateVariables
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  if (
    templateVariables.length > 20 ||
    templateVariables.some((item) => item.length > 1000)
  ) {
    return errorResponse("INVALID_TEMPLATE_VARIABLES", "متغیرهای Template معتبر نیستند.", 400);
  }

  let approvedTemplate = false;
  if (messageType === "template") {
    const { data: template, error: templateError } = await admin
      .from("whatsapp_templates")
      .select("id,variable_count")
      .eq("owner_id", user.id)
      .eq("business_account_id", config.businessAccountId)
      .eq("name", templateName)
      .eq("language", templateLanguage)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (templateError) {
      return errorResponse("TEMPLATE_SCHEMA_UNAVAILABLE", "فهرست Templateهای Meta آماده نیست.", 503);
    }
    if (!template || Number(template.variable_count) !== templateVariables.length) {
      return errorResponse(
        "TEMPLATE_NOT_APPROVED",
        "Template تأییدشده یا تعداد متغیرهای آن با فهرست همگام‌شده Meta تطابق ندارد.",
        400,
      );
    }
    approvedTemplate = true;
  }
  const policy = validateSendPolicy({
    confirmed: body.confirmed === true,
    consentStatus: customer.whatsapp_consent_status,
    mobile: customer.normalized_phone || customer.phone || "",
    messageType,
    conversationWindowConfirmed: body.conversationWindowConfirmed === true,
    templateName,
    templateVariables,
    templateApprovedConfirmed: approvedTemplate,
  });
  if (!policy.ok) return errorResponse(policy.code, policy.message, 400);

  let imageUrl = "";
  if (messageType === "image") {
    if (content.image_path) {
      const { data, error } = await admin.storage
        .from("content-studio")
        .createSignedUrl(content.image_path, 600);
      if (error || !data?.signedUrl) {
        return errorResponse("INVALID_IMAGE", "دسترسی امن به تصویر محتوا ممکن نشد.", 400);
      }
      imageUrl = data.signedUrl;
    } else {
      const requestedImageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      if (!content.image_url || requestedImageUrl !== content.image_url) {
        return errorResponse("INVALID_IMAGE", "تصویر باید متعلق به همین محتوای واتساپ باشد.", 400);
      }
      imageUrl = content.image_url;
    }
  }
  let providerPayload: Record<string, unknown>;
  try {
    if (messageType === "text") {
      providerPayload = buildTextPayload(policy.normalizedMobile, messageText);
    } else if (messageType === "image") {
      providerPayload = buildImagePayload(policy.normalizedMobile, imageUrl, messageText);
    } else {
      providerPayload = buildTemplatePayload(
        policy.normalizedMobile,
        templateName,
        templateVariables,
        templateLanguage,
      );
    }
  } catch (error) {
    const message = error instanceof WhatsAppCloudError ? error.message : "پیام معتبر نیست.";
    return errorResponse("INVALID_MESSAGE", message, 400);
  }

  const { data: pending, error: insertError } = await admin
    .from("whatsapp_messages")
    .insert({
      owner_id: user.id,
      customer_id: customerId,
      content_item_id: contentItemId,
      client_request_id: clientRequestId,
      recipient: policy.normalizedMobile,
      message_type: messageType,
      template_name: messageType === "template" ? templateName : null,
      template_language: messageType === "template" ? templateLanguage : null,
      template_variables: messageType === "template" ? templateVariables : [],
      message_text: messageType === "template" ? null : messageText,
      image_url: messageType === "image" ? imageUrl : null,
      conversation_window_confirmed: body.conversationWindowConfirmed === true,
      status: "pending_confirmation",
    })
    .select("id,status,provider_message_id")
    .single();

  if (insertError) {
    const { data: existing } = await admin
      .from("whatsapp_messages")
      .select("id,status,provider_message_id")
      .eq("owner_id", user.id)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) {
      if (existing.status === "failed") {
        return errorResponse(
          "DUPLICATE_FAILED_REQUEST",
          "این درخواست قبلاً ناموفق ثبت شده و برای جلوگیری از ارسال تکراری دوباره اجرا نشد.",
          409,
        );
      }
      if (existing.status === "provider_result_unknown") {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          messageId: existing.id,
          status: existing.status,
          providerMessageId: existing.provider_message_id,
          notice:
            "نتیجه درخواست قبلی از Meta نامشخص است؛ برای جلوگیری از پیام تکراری ارسال دوباره انجام نشد.",
        });
      }
      return NextResponse.json({
        ok: true,
        duplicate: true,
        messageId: existing.id,
        status: existing.status,
        providerMessageId: existing.provider_message_id,
        notice:
          existing.status === "accepted"
            ? "این درخواست قبلاً توسط Meta پذیرفته شده است؛ ارسال تکرار نشد."
            : "این درخواست قبلاً ثبت شده و در حال پردازش است؛ ارسال تکرار نشد.",
      });
    }
    return errorResponse("DATABASE_ERROR", "ثبت امن درخواست ارسال ممکن نشد.", 503);
  }

  try {
    const provider = await sendWhatsAppMessage({ config, payload: providerPayload });
    const now = new Date().toISOString();
    const acceptedUpdate = {
      status: "accepted",
      provider_status: "accepted",
      provider_message_id: provider.messageId,
      accepted_at: now,
      provider_error_code: null,
      provider_error_message: null,
    };
    let persistenceError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await admin
        .from("whatsapp_messages")
        .update(acceptedUpdate)
        .eq("id", pending.id)
        .eq("owner_id", user.id);
      persistenceError = result.error;
      if (!persistenceError) break;
    }
    if (persistenceError) {
      return NextResponse.json(
        {
          ok: true,
          messageId: pending.id,
          providerMessageId: provider.messageId,
          status: "accepted",
          trackingWarning: true,
          notice:
            "Meta پیام را پذیرفت، اما ثبت وضعیت کامل نشد؛ برای جلوگیری از ارسال تکراری دوباره ارسال نکنید.",
        },
        { status: 202 },
      );
    }
    return NextResponse.json({
      ok: true,
      messageId: pending.id,
      providerMessageId: provider.messageId,
      status: "accepted",
      notice: "پیام توسط Meta پذیرفته شد؛ تحویل هنوز تأیید نشده است.",
    });
  } catch (error) {
    const providerError = error instanceof WhatsAppCloudError ? error : null;
    const ambiguous = isAmbiguousWhatsAppProviderError(error);
    const now = new Date().toISOString();
    await admin
      .from("whatsapp_messages")
      .update({
        status: ambiguous ? "provider_result_unknown" : "failed",
        provider_status: ambiguous ? "provider_result_unknown" : "failed",
        provider_error_code:
          providerError?.providerCode ??
          (ambiguous ? "PROVIDER_RESULT_UNKNOWN" : "PROVIDER_ERROR"),
        provider_error_message: ambiguous
          ? "نتیجه درخواست به سرویس مشخص نشد."
          : providerError?.message ?? "ارسال ناموفق بود.",
        failed_at: ambiguous ? null : now,
        provider_result_unknown_at: ambiguous ? now : null,
      })
      .eq("id", pending.id)
      .eq("owner_id", user.id);
    return ambiguous
      ? errorResponse(
          "PROVIDER_RESULT_UNKNOWN",
          "نتیجه ارتباط با Meta مشخص نیست؛ برای جلوگیری از پیام تکراری درخواست خودکار تکرار نشد.",
          504,
        )
      : errorResponse("PROVIDER_REJECTED", "سرویس واتساپ پیام را نپذیرفت.", 502);
  }
}
