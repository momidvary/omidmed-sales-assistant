import { Buffer } from "node:buffer";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell";
import {
  buildInstagramPrompt,
  buildWhatsAppPrompt,
  instagramOutputSchema,
  parseInstagramContent,
  parseWhatsAppContent,
  WHATSAPP_CONTENT_TYPES,
  whatsappOutputSchema,
  type WhatsAppGeneratedContent,
} from "@/lib/content-studio/generation";
import {
  buildGroundedBrief,
  buildProfessionalImagePrompt,
  CONTENT_AUDIENCES,
  CONTENT_GOALS,
  CONTENT_TYPES,
  IMAGE_PRESETS,
  removeUnsupportedMedicalClaims,
  type BrandGrounding,
  type CustomerGrounding,
  type ProductGrounding,
} from "@/lib/content-studio/quality";
import { generateStructuredContent } from "@/lib/content-studio/openai";
import {
  decodeLegacyWhatsAppPayload,
  encodeLegacyWhatsAppPayload,
  isStoredWhatsAppPayload,
  type StoredWhatsAppPayload,
} from "@/lib/content-studio/whatsapp-legacy";
import { createClient } from "@/lib/supabase/server";
import {
  safeOriginalFilename,
  validateMedicalDocument,
} from "@/lib/uploads/medical-document";
import { buildWhatsAppReadiness, probeWhatsAppSchema } from "@/lib/whatsapp/readiness";

import CopyButton from "./copy-button";
import styles from "./content-studio.module.css";
import WhatsAppContentCard from "./whatsapp-content-card";
import ContentRevisionEditor from "./content-revision-editor";

export const runtime = "nodejs";
export const maxDuration = 60;

type ContentStatus = "draft" | "pending_review" | "approved" | "published" | "rejected";
type ContentChannel = "instagram" | "whatsapp";

type ContentItem = {
  id: string;
  created_by: string;
  title: string;
  topic: string;
  product_name: string | null;
  objective: string;
  channel: string;
  format: string;
  caption: string;
  on_image_text: string | null;
  call_to_action: string | null;
  hashtags: string[];
  image_prompt: string | null;
  image_url: string | null;
  image_path: string | null;
  scheduled_for: string | null;
  status: ContentStatus;
  channel_payload?: Record<string, unknown> | null;
  customer_id?: string | null;
  product_id?: string | null;
  content_type?: string | null;
  goal?: string | null;
  tone?: string | null;
  final_text?: string | null;
  image_metadata?: Record<string, unknown> | null;
  whatsapp_status?: string | null;
  created_at: string;
};

type ProductOption = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  technical_specifications: Record<string, unknown>;
  applications: string[];
  target_specialties: string[];
  advantages: string[];
  differentiators: string[];
  current_cash_price: number | string | null;
  inventory_status: string;
  warranty: string | null;
  after_sales_service: string | null;
  training: string | null;
  approved_marketing_claims: string[];
  brochure_url: string | null;
  primary_image_path: string | null;
};

type BrandProfileRow = {
  company_name: string;
  tone: string;
  colors: string[];
  persian_style: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  cta_style: string | null;
  forbidden_phrases: string[];
  disclaimers: string[];
};

type TemplateOption = {
  id: string;
  name: string;
  status: string;
  language: string;
  category: string;
  variable_count: number;
  last_synced_at: string;
};

type CustomerOption = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  whatsapp_consent_status: string;
  whatsapp_consent_at: string | null;
};

type MessageHistory = {
  id: string;
  content_item_id: string | null;
  status: string;
  message_type: string;
  created_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  provider_result_unknown_at: string | null;
};

const statusLabels: Record<ContentStatus, string> = {
  draft: "پیش‌نویس",
  pending_review: "منتظر تأیید",
  approved: "تأییدشده",
  published: "منتشرشده",
  rejected: "نیازمند اصلاح",
};

const formatLabels: Record<string, string> = {
  post: "پست",
  carousel: "پست اسلایدی",
  story: "استوری / استاتوس",
  reel: "سناریوی ریلز",
  article: "مقاله",
};

const whatsappTypeLabels: Record<string, string> = {
  whatsapp_sales: "واتساپ فروش",
  whatsapp_follow_up: "واتساپ پیگیری",
  whatsapp_quote_follow_up: "واتساپ پیگیری قیمت",
  product_intro: "معرفی محصول",
  price_follow_up: "پیگیری قیمت",
  repurchase: "یادآوری خرید مجدد",
  special_offer: "پیشنهاد ویژه",
  short_educational: "نکته آموزشی کوتاه",
  status: "استاتوس واتساپ",
  image_product_text: "متن روی تصویر محصول",
  personalized_customer: "پیام شخصی‌سازی‌شده مشتری",
  template_draft: "پیش‌نویس Template واتساپ",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const goalLabels: Record<string, string> = {
  product_introduction: "معرفی محصول",
  lead_generation: "جذب سرنخ",
  call_request: "درخواست تماس",
  order: "ثبت سفارش CRM",
  quote_follow_up: "پیگیری پیش‌فاکتور",
  customer_reactivation: "فعال‌سازی مجدد مشتری",
  educational: "آموزشی",
  trust_building: "اعتمادسازی",
  cross_sell: "فروش مکمل",
  upsell: "فروش ارتقایی",
  campaign: "کمپین",
};

const audienceLabels: Record<string, string> = {
  physiotherapist: "فیزیوتراپیست",
  doctor: "پزشک",
  clinic_manager: "مدیر کلینیک",
  purchasing_manager: "مدیر خرید",
  hospital: "بیمارستان",
  rehabilitation_center: "مرکز توان‌بخشی",
  reseller: "نماینده فروش",
  existing_customer: "مشتری فعلی",
  prospect: "مشتری بالقوه",
};

const contentTypeLabels: Record<string, string> = {
  whatsapp_sales: "واتساپ فروش",
  whatsapp_follow_up: "واتساپ پیگیری",
  whatsapp_quote_follow_up: "واتساپ پیگیری قیمت",
  instagram_post: "پست اینستاگرام",
  instagram_caption: "کپشن اینستاگرام",
  instagram_story: "استوری اینستاگرام",
  instagram_carousel: "کاروسل اینستاگرام",
  product_introduction: "معرفی محصول",
  educational: "محتوای آموزشی",
  comparison: "مقایسه",
  faq: "پرسش‌های متداول",
  reactivation: "فعال‌سازی مجدد",
  campaign: "کمپین",
  after_sales: "خدمات پس از فروش",
  sms: "پیامک",
  website_copy: "متن وب‌سایت",
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function formText(formData: FormData, name: string, maxLength = 1000) {
  return String(formData.get(name) ?? "").trim().slice(0, maxLength);
}

function formList(formData: FormData, name: string, maxItems = 30) {
  return Array.from(
    new Set(
      formText(formData, name, 5000)
        .split(/[\n,،]+/)
        .map((value) => value.trim().slice(0, 300))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function formSpecifications(formData: FormData) {
  const result: Record<string, string> = {};
  for (const line of formText(formData, "technical_specifications", 8000).split("\n")) {
    const separator = line.search(/[:：]/);
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().slice(0, 120);
    const value = line.slice(separator + 1).trim().slice(0, 500);
    if (key && value) result[key] = value;
    if (Object.keys(result).length >= 50) break;
  }
  return result;
}

function optionalHttpUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function saveBrandProfile(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const colors = formList(formData, "colors", 6).filter((value) => /^#[0-9a-f]{6}$/i.test(value));
  const websiteRaw = formText(formData, "website", 300);
  const website = optionalHttpUrl(websiteRaw);
  if (websiteRaw && !website) redirect("/content-studio?error=brand");

  const { error } = await supabase.from("brand_profiles").upsert({
    owner_id: user.id,
    company_name: formText(formData, "company_name", 180) || "امیدمِد",
    tone: formText(formData, "brand_tone", 80) || "professional",
    colors: colors.length ? colors : ["#172554", "#0f766e"],
    persian_style: formText(formData, "persian_style", 500) || null,
    phone: formText(formData, "phone", 40) || null,
    website,
    instagram: formText(formData, "instagram", 120) || null,
    cta_style: formText(formData, "cta_style", 500) || null,
    forbidden_phrases: formList(formData, "forbidden_phrases"),
    disclaimers: formList(formData, "disclaimers"),
    updated_at: new Date().toISOString(),
  });
  if (error) redirect("/content-studio?error=brand");
  revalidatePath("/content-studio");
  redirect("/content-studio?saved=brand");
}

async function saveProductGrounding(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const productId = formText(formData, "product_id", 80);
  const inventoryStatus = formText(formData, "inventory_status", 40);
  const brochureRaw = formText(formData, "brochure_url", 500);
  const brochureUrl = optionalHttpUrl(brochureRaw);
  if (
    !uuidPattern.test(productId) ||
    !["unknown", "in_stock", "low_stock", "out_of_stock", "made_to_order"].includes(inventoryStatus) ||
    (brochureRaw && !brochureUrl)
  ) {
    redirect("/content-studio?error=catalog");
  }

  const { data, error } = await supabase
    .from("costing_products")
    .update({
      brand: formText(formData, "brand", 180) || null,
      model: formText(formData, "model", 180) || null,
      technical_specifications: formSpecifications(formData),
      applications: formList(formData, "applications"),
      target_specialties: formList(formData, "target_specialties"),
      advantages: formList(formData, "advantages"),
      differentiators: formList(formData, "differentiators"),
      inventory_status: inventoryStatus,
      warranty: formText(formData, "warranty", 500) || null,
      after_sales_service: formText(formData, "after_sales_service", 500) || null,
      training: formText(formData, "training", 500) || null,
      approved_marketing_claims: formList(formData, "approved_marketing_claims"),
      brochure_url: brochureUrl,
    })
    .eq("id", productId)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) redirect("/content-studio?error=catalog");
  revalidatePath("/content-studio");
  redirect(`/content-studio?saved=catalog&catalog_product=${encodeURIComponent(productId)}`);
}

async function uploadProductImage(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const productId = formText(formData, "product_id", 80);
  const file = formData.get("product_image");
  if (!uuidPattern.test(productId) || !(file instanceof File)) {
    redirect("/content-studio?error=product-image");
  }

  let validated: Awaited<ReturnType<typeof validateMedicalDocument>>;
  try {
    validated = await validateMedicalDocument(file, 15 * 1024 * 1024);
  } catch {
    redirect(`/content-studio?error=product-image&catalog_product=${encodeURIComponent(productId)}`);
  }
  if (validated.mimeType === "application/pdf") {
    redirect(`/content-studio?error=product-image&catalog_product=${encodeURIComponent(productId)}`);
  }

  const path = `${user.id}/products/${productId}/${crypto.randomUUID()}.${validated.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("content-studio")
    .upload(path, file, { contentType: validated.mimeType, upsert: false });
  if (uploadError) {
    redirect(`/content-studio?error=product-image&catalog_product=${encodeURIComponent(productId)}`);
  }

  const { error: assetError } = await supabase.rpc("set_product_primary_asset", {
    p_product_id: productId,
    p_storage_path: path,
    p_original_name: safeOriginalFilename(file.name),
    p_mime_type: validated.mimeType,
    p_size_bytes: file.size,
  });
  if (assetError) {
    await supabase.storage.from("content-studio").remove([path]);
    redirect(`/content-studio?error=product-image&catalog_product=${encodeURIComponent(productId)}`);
  }
  revalidatePath("/content-studio");
  redirect(`/content-studio?saved=product-image&catalog_product=${encodeURIComponent(productId)}`);
}

async function generateContent(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const channel = String(formData.get("channel") ?? "instagram") as ContentChannel;
  const topic = String(formData.get("topic") ?? "").trim();
  const productName = String(formData.get("product_name") ?? "").trim();
  const objective = String(formData.get("goal") ?? formData.get("objective") ?? "product_introduction").trim();
  const requestedFormat = String(formData.get("format") ?? "post").trim();
  const scheduledFor = String(formData.get("scheduled_for") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const contentType = String(formData.get("content_type") ?? "product_intro");
  const goal = String(formData.get("goal") ?? "product_introduction");
  const audience = String(formData.get("audience") ?? "physiotherapist");
  const tone = String(formData.get("tone") ?? "professional");
  const imagePreset = String(formData.get("image_preset") ?? "instagram_square") as keyof typeof IMAGE_PRESETS;

  if (!topic || topic.length > 500 || !["instagram", "whatsapp"].includes(channel)) {
    redirect(`/content-studio?channel=${channel}&error=topic`);
  }
  if (channel === "whatsapp" && !WHATSAPP_CONTENT_TYPES.includes(contentType as never)) {
    redirect("/content-studio?channel=whatsapp&error=type");
  }
  if (
    !CONTENT_GOALS.includes(goal as never) ||
    !CONTENT_AUDIENCES.includes(audience as never) ||
    !IMAGE_PRESETS[imagePreset]
  ) {
    redirect(`/content-studio?channel=${channel}&error=brief`);
  }

  let customer: {
    name: string;
    contact_name: string | null;
    city: string | null;
    status: string;
    priority: string;
    lead_stage: string | null;
    preferred_products: string[];
    last_purchase_at: string | null;
    total_sales: number | string | null;
    holo_balance_amount: number | string | null;
    holo_balance_status: string | null;
  } | null = null;
  if (customerId) {
    const result = await supabase
      .from("customer_crm_summary")
      .select("name,contact_name,city,status,priority,lead_stage,preferred_products,last_purchase_at,total_sales,holo_balance_amount,holo_balance_status")
      .eq("id", customerId)
      .eq("owner_id", user.id)
      .maybeSingle();
    customer = result.data;
  }

  let product: ProductOption | null = null;
  if (productId) {
    const result = await supabase
      .from("costing_products")
      .select("id,name,category,brand,model,technical_specifications,applications,target_specialties,advantages,differentiators,current_cash_price,inventory_status,warranty,after_sales_service,training,approved_marketing_claims,brochure_url,primary_image_path")
      .eq("id", productId)
      .eq("owner_id", user.id)
      .maybeSingle();
    product = result.data as ProductOption | null;
    if (!product) redirect(`/content-studio?channel=${channel}&error=product`);
  }

  const { data: brandRow } = await supabase
    .from("brand_profiles")
    .select("company_name,tone,colors,persian_style,cta_style,forbidden_phrases,disclaimers")
    .eq("owner_id", user.id)
    .maybeSingle();
  const brand: BrandGrounding | null = brandRow
    ? {
        companyName: brandRow.company_name,
        tone: brandRow.tone,
        colors: brandRow.colors,
        persianStyle: brandRow.persian_style,
        ctaStyle: brandRow.cta_style,
        forbiddenPhrases: brandRow.forbidden_phrases,
        disclaimers: brandRow.disclaimers,
      }
    : null;
  const productGrounding: ProductGrounding | null = product
    ? {
        name: product.name,
        category: product.category,
        brand: product.brand,
        model: product.model,
        technicalSpecifications: product.technical_specifications,
        applications: product.applications,
        targetSpecialties: product.target_specialties,
        advantages: product.advantages,
        differentiators: product.differentiators,
        price: product.current_cash_price,
        inventoryStatus: product.inventory_status,
        warranty: product.warranty,
        afterSalesService: product.after_sales_service,
        training: product.training,
        approvedMarketingClaims: product.approved_marketing_claims,
        hasRealImage: Boolean(product.primary_image_path),
      }
    : null;
  const customerGrounding: CustomerGrounding | null = customer
    ? {
        name: customer.name,
        city: customer.city,
        customerType: customer.status,
        crmStage: customer.lead_stage,
        lastPurchase: customer.last_purchase_at,
        purchasedProducts: customer.preferred_products,
        actualSales: customer.total_sales,
        balanceAmount: customer.holo_balance_amount,
        balanceStatus: customer.holo_balance_status,
        commercialPriority: customer.priority,
      }
    : null;
  const groundedBrief = buildGroundedBrief({
    topic,
    goal,
    audience,
    contentType,
    tone,
    product: productGrounding,
    customer: customerGrounding,
    brand,
  });

  const model =
    process.env.OPENAI_CONTENT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.2";
  let raw: string;
  try {
    raw = await generateStructuredContent({
      apiKey: process.env.OPENAI_API_KEY,
      model,
      prompt:
        channel === "whatsapp"
          ? `${groundedBrief}\n\n${buildWhatsAppPrompt({
              topic,
              productName: product?.name || productName,
              objective,
              contentType: contentType as (typeof WHATSAPP_CONTENT_TYPES)[number],
              customerName: customer?.name,
              clinicName: customer?.name,
              city: customer?.city ?? undefined,
              contactName: customer?.contact_name ?? undefined,
              })}`
          : `${groundedBrief}\n\n${buildInstagramPrompt({
              topic,
              productName: product?.name || productName,
              objective,
              formatLabel: formatLabels[requestedFormat] || requestedFormat,
            })}`,
      schemaName: channel === "whatsapp" ? "omidmed_whatsapp_content" : "omidmed_instagram_content",
      schema: channel === "whatsapp" ? whatsappOutputSchema : instagramOutputSchema,
    });
  } catch {
    redirect(`/content-studio?channel=${channel}&error=generation`);
  }

  let generated: ReturnType<typeof parseInstagramContent> | WhatsAppGeneratedContent;
  try {
    generated = channel === "whatsapp" ? parseWhatsAppContent(raw) : parseInstagramContent(raw);
  } catch {
    redirect(`/content-studio?channel=${channel}&error=parse`);
  }

  if (channel === "whatsapp") {
    const value = generated as WhatsAppGeneratedContent;
    value.whatsapp_short_text = removeUnsupportedMedicalClaims(value.whatsapp_short_text, productGrounding).text;
    value.whatsapp_long_text = removeUnsupportedMedicalClaims(value.whatsapp_long_text, productGrounding).text;
    value.whatsapp_status_text = removeUnsupportedMedicalClaims(value.whatsapp_status_text, productGrounding).text;
    value.call_to_action = removeUnsupportedMedicalClaims(value.call_to_action, productGrounding).text;
    if (!value.whatsapp_short_text || !value.whatsapp_long_text) {
      redirect(`/content-studio?channel=${channel}&error=claims`);
    }
  } else {
    const value = generated as ReturnType<typeof parseInstagramContent>;
    value.caption = removeUnsupportedMedicalClaims(value.caption, productGrounding).text;
    if (!value.caption) redirect(`/content-studio?channel=${channel}&error=claims`);
  }

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    redirect(`/content-studio?channel=${channel}&error=schedule`);
  }
  const professionalImagePrompt = buildProfessionalImagePrompt({
    product: productGrounding,
    audience,
    useCase: topic,
    environment: "professional Iranian clinic, hospital or rehabilitation setting",
    campaignGoal: goal,
    brand,
    preset: imagePreset,
    concept: generated.image_prompt || topic,
  });

  let insertError: unknown = null;
  if (channel === "whatsapp") {
    const whatsappGenerated = generated as WhatsAppGeneratedContent;
    const payload: StoredWhatsAppPayload = {
      content_type: contentType as StoredWhatsAppPayload["content_type"],
      ...whatsappGenerated,
    };
    const baseInsert = {
      created_by: user.id,
      topic,
      product_name: product?.name || productName || null,
      objective,
      audience,
      channel,
      format: contentType === "status" ? "story" : "post",
      scheduled_for: scheduledDate?.toISOString() ?? null,
      status: "draft",
      title: whatsappGenerated.title,
      caption: whatsappGenerated.whatsapp_long_text,
      on_image_text: whatsappGenerated.whatsapp_short_text,
      call_to_action: whatsappGenerated.call_to_action,
      image_prompt: professionalImagePrompt,
    };
    const extendedResult = await supabase
      .from("content_items")
      .insert({
        ...baseInsert,
        hashtags: [],
        channel_payload: payload,
        customer_id: customerId || null,
        product_id: productId || null,
        content_type: contentType,
        goal,
        tone,
        draft_text: whatsappGenerated.whatsapp_long_text,
        final_text: whatsappGenerated.whatsapp_long_text,
        provider: "openai",
        model,
        image_metadata: {
          preset: imagePreset,
          ratio: IMAGE_PRESETS[imagePreset].ratio,
          source: product?.primary_image_path ? "real_product" : "ai_concept",
          ai_is_actual_product: false,
        },
      } as never)
      .select("id")
      .single();
    insertError = extendedResult.error;
    if (extendedResult.error) {
      const compatibilityResult = await supabase.from("content_items").insert({
        ...baseInsert,
        hashtags: [encodeLegacyWhatsAppPayload(payload)],
      } as never);
      insertError = compatibilityResult.error;
    }
  } else {
    const instagramGenerated = generated as ReturnType<typeof parseInstagramContent>;
    const instagramResult = await supabase
      .from("content_items")
      .insert({
        created_by: user.id,
        topic,
        product_name: product?.name || productName || null,
        objective,
        audience,
        channel,
        format: requestedFormat,
        scheduled_for: scheduledDate?.toISOString() ?? null,
        status: "draft",
        ...instagramGenerated,
        image_prompt: professionalImagePrompt,
        customer_id: customerId || null,
        product_id: productId || null,
        content_type: contentType,
        goal,
        tone,
        draft_text: instagramGenerated.caption,
        final_text: instagramGenerated.caption,
        provider: "openai",
        model,
        image_metadata: {
          preset: imagePreset,
          ratio: IMAGE_PRESETS[imagePreset].ratio,
          source: product?.primary_image_path ? "real_product" : "ai_concept",
          ai_is_actual_product: false,
        },
      } as never)
      .select("id")
      .single();
    insertError = instagramResult.error;
  }

  if (insertError) redirect(`/content-studio?channel=${channel}&error=database`);
  revalidatePath("/content-studio");
  redirect(`/content-studio?channel=${channel}&saved=content`);
}

async function generateImage(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "instagram");
  if (!itemId) return;

  const { data: item } = await supabase
    .from("content_items")
    .select("id,title,image_prompt,format,created_by,product_id,image_metadata")
    .eq("id", itemId)
    .eq("created_by", user.id)
    .single();
  if (!item?.image_prompt) redirect(`/content-studio?channel=${channel}&error=image-prompt`);

  if (item.product_id) {
    const { data: product } = await supabase
      .from("costing_products")
      .select("primary_image_path")
      .eq("id", item.product_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (product?.primary_image_path) {
      const { error } = await supabase
        .from("content_items")
        .update({
          image_path: product.primary_image_path,
          image_url: null,
          image_metadata: {
            ...(item.image_metadata as Record<string, unknown> | null),
            source: "real_product",
            ai_is_actual_product: false,
          },
        })
        .eq("id", item.id)
        .eq("created_by", user.id);
      if (error) redirect(`/content-studio?channel=${channel}&error=image-database`);
      revalidatePath("/content-studio");
      redirect(`/content-studio?channel=${channel}&saved=image`);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!apiKey || !serviceKey || !supabaseUrl) {
    redirect(`/content-studio?channel=${channel}&error=image-config`);
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      prompt: item.image_prompt,
      size:
        (item.image_metadata as { preset?: string } | null)?.preset === "website"
          ? "1536x1024"
          : item.format === "story" || item.format === "reel" ||
              ["instagram_portrait", "whatsapp_portrait"].includes(
                (item.image_metadata as { preset?: string } | null)?.preset ?? "",
              )
            ? "1024x1536"
            : "1024x1024",
      quality: process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium",
      output_format: "png",
      n: 1,
    }),
    signal: AbortSignal.timeout(55_000),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as {
    data?: Array<{ b64_json?: string }>;
  };
  const base64 = result.data?.[0]?.b64_json;
  if (!response.ok || !base64) {
    redirect(`/content-studio?channel=${channel}&error=image-generation`);
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const path = `${user.id}/${item.id}-${crypto.randomUUID()}.png`;
  const imageBytes = Buffer.from(base64, "base64");
  if (!imageBytes.length || imageBytes.length > 15 * 1024 * 1024) {
    redirect(`/content-studio?channel=${channel}&error=image-generation`);
  }
  const { error: uploadError } = await admin.storage
    .from("content-studio")
    .upload(path, imageBytes, { contentType: "image/png", upsert: false });
  if (uploadError) redirect(`/content-studio?channel=${channel}&error=image-upload`);

  const { error: updateError } = await supabase
    .from("content_items")
    .update({
      image_path: path,
      image_url: null,
      image_metadata: {
        ...(item.image_metadata as Record<string, unknown> | null),
        source: "ai_concept",
        ai_is_actual_product: false,
        provider: "openai",
        model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
        generated_at: new Date().toISOString(),
      },
    })
    .eq("id", item.id)
    .eq("created_by", user.id);
  if (updateError) {
    await admin.storage.from("content-studio").remove([path]);
    redirect(`/content-studio?channel=${channel}&error=image-database`);
  }
  revalidatePath("/content-studio");
  redirect(`/content-studio?channel=${channel}&saved=image`);
}

async function changeStatus(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "instagram");
  const status = String(formData.get("status") ?? "") as ContentStatus;
  if (!itemId || !["draft", "pending_review", "approved", "published", "rejected"].includes(status)) return;
  const update: Record<string, unknown> = { status };
  if (status === "approved") {
    update.reviewed_by = user.id;
    update.approved_at = new Date().toISOString();
  }
  if (status === "published") update.published_at = new Date().toISOString();
  const { error } = await supabase
    .from("content_items")
    .update(update)
    .eq("id", itemId)
    .eq("created_by", user.id);
  if (error) redirect(`/content-studio?channel=${channel}&error=status`);
  revalidatePath("/content-studio");
  redirect(`/content-studio?channel=${channel}&saved=status`);
}

function formatDate(value: string | null) {
  if (!value) return "بدون زمان‌بندی";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

async function collectAllRows<T>(
  load: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await load(from, from + 999);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 1000) return { data: rows, error: null };
  }
}

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    channel?: string;
    page?: string;
    q?: string;
    status?: string;
    content_type?: string;
    customer?: string;
    product?: string;
    sent?: string;
    catalog_product?: string;
  }>;
}) {
  const params = await searchParams;
  const activeChannel: ContentChannel = params.channel === "whatsapp" ? "whatsapp" : "instagram";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 24;
  const from = (page - 1) * pageSize;
  const search = (params.q ?? "").trim().slice(0, 100).replace(/[%_]/g, "");
  const { supabase, user } = await requireUser();

  const extendedSelect =
    "id,created_by,title,topic,product_name,objective,channel,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_path,image_url,scheduled_for,status,channel_payload,customer_id,product_id,content_type,goal,tone,final_text,image_metadata,whatsapp_status,created_at";
  let contentQuery = supabase
    .from("content_items")
    .select(extendedSelect, { count: "exact" })
    .eq("created_by", user.id)
    .eq("channel", activeChannel)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (search) contentQuery = contentQuery.or(`title.ilike.%${search}%,topic.ilike.%${search}%,caption.ilike.%${search}%`);
  if (params.status && ["draft", "pending_review", "approved", "published", "rejected"].includes(params.status)) {
    contentQuery = contentQuery.eq("status", params.status);
  }
  if (params.content_type && CONTENT_TYPES.includes(params.content_type as never)) {
    contentQuery = contentQuery.eq("content_type", params.content_type);
  }
  if (params.customer) contentQuery = contentQuery.eq("customer_id", params.customer);
  if (params.product) contentQuery = contentQuery.eq("product_id", params.product);
  if (params.sent === "yes") contentQuery = contentQuery.not("sent_at", "is", null);
  if (params.sent === "no") contentQuery = contentQuery.is("sent_at", null);
  const extendedContentResult = await contentQuery.range(from, from + pageSize - 1);
  let whatsappSchemaReady = !extendedContentResult.error;
  let contentData: unknown[] = extendedContentResult.data ?? [];
  let contentError = extendedContentResult.error;
  if (extendedContentResult.error) {
    whatsappSchemaReady = false;
    const fallbackContentResult = await supabase
      .from("content_items")
      .select("id,created_by,title,topic,product_name,objective,channel,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_url,scheduled_for,status,created_at")
      .eq("created_by", user.id)
      .eq("channel", activeChannel)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    contentData = (fallbackContentResult.data ?? []).map((item) => ({
      ...item,
      channel_payload: null,
    }));
    contentError = fallbackContentResult.error;
  }
  const allItems = contentData as ContentItem[];
  let items = allItems.filter((item) => item.created_by === user.id);
  const totalItems = extendedContentResult.count ?? items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const extendedCustomerResult = await collectAllRows<CustomerOption>((rangeFrom, rangeTo) =>
    supabase
      .from("customers")
      .select("id,name,contact_name,phone,city,whatsapp_consent_status,whatsapp_consent_at")
      .eq("owner_id", user.id)
      .is("archived_at", null)
      .order("name")
      .range(rangeFrom, rangeTo) as unknown as Promise<{ data: CustomerOption[] | null; error: unknown }>,
  );
  let customerData: unknown[] = extendedCustomerResult.data ?? [];
  if (extendedCustomerResult.error) {
    whatsappSchemaReady = false;
    const fallback = await collectAllRows<Omit<CustomerOption, "whatsapp_consent_status" | "whatsapp_consent_at">>((rangeFrom, rangeTo) =>
      supabase
        .from("customers")
        .select("id,name,contact_name,phone,city")
        .eq("owner_id", user.id)
        .is("archived_at", null)
        .order("name")
        .range(rangeFrom, rangeTo) as unknown as Promise<{ data: Array<Omit<CustomerOption, "whatsapp_consent_status" | "whatsapp_consent_at">> | null; error: unknown }>,
    );
    customerData = (fallback.data ?? []).map((customer) => ({
        ...customer,
        whatsapp_consent_status: "unknown",
        whatsapp_consent_at: null,
      }));
  }
  const customers = customerData as CustomerOption[];

  const productResult = await collectAllRows<ProductOption>((rangeFrom, rangeTo) =>
    supabase
      .from("costing_products")
      .select("id,name,category,brand,model,technical_specifications,applications,target_specialties,advantages,differentiators,current_cash_price,inventory_status,warranty,after_sales_service,training,approved_marketing_claims,brochure_url,primary_image_path")
      .eq("owner_id", user.id)
      .eq("is_active", true)
      .order("name")
      .range(rangeFrom, rangeTo) as unknown as Promise<{ data: ProductOption[] | null; error: unknown }>,
  );
  const products = productResult.data;
  const { data: brandProfileData } = await supabase
    .from("brand_profiles")
    .select("company_name,tone,colors,persian_style,phone,website,instagram,cta_style,forbidden_phrases,disclaimers")
    .eq("owner_id", user.id)
    .maybeSingle();
  const brandProfile = brandProfileData as BrandProfileRow | null;
  const selectedCatalogProduct = products.find(
    (product) => product.id === params.catalog_product,
  );

  const templateResult = whatsappSchemaReady
    ? await collectAllRows<TemplateOption>((rangeFrom, rangeTo) =>
        supabase
          .from("whatsapp_templates")
          .select("id,name,status,language,category,variable_count,last_synced_at")
          .eq("owner_id", user.id)
          .eq("status", "APPROVED")
          .order("name")
          .range(rangeFrom, rangeTo) as unknown as Promise<{ data: TemplateOption[] | null; error: unknown }>,
      )
    : { data: [] as TemplateOption[], error: null };
  const templates = templateResult.data;

  let history: MessageHistory[] = [];
  const contentIds = items.map((item) => item.id);
  if (whatsappSchemaReady && contentIds.length) {
    const messageResult = await collectAllRows<MessageHistory>((rangeFrom, rangeTo) =>
      supabase
        .from("whatsapp_messages")
        .select("id,content_item_id,status,message_type,created_at,accepted_at,sent_at,delivered_at,read_at,failed_at,provider_result_unknown_at")
        .eq("owner_id", user.id)
        .in("content_item_id", contentIds)
        .order("created_at", { ascending: false })
        .range(rangeFrom, rangeTo) as unknown as Promise<{ data: MessageHistory[] | null; error: unknown }>,
    );
    if (messageResult.error) whatsappSchemaReady = false;
    else history = messageResult.data;
  }
  const readinessSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const readinessServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (whatsappSchemaReady && readinessSupabaseUrl && readinessServiceKey) {
    const readinessAdmin = createAdminClient(readinessSupabaseUrl, readinessServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    whatsappSchemaReady = await probeWhatsAppSchema(readinessAdmin);
    const paths = items.map((item) => item.image_path).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const { data: signedFiles } = await readinessAdmin.storage
        .from("content-studio")
        .createSignedUrls(paths, 3600);
      const signedByPath = new Map(
        (signedFiles ?? [])
          .filter((file) => file.signedUrl)
          .map((file, index) => [paths[index], file.signedUrl]),
      );
      items = items.map((item) => ({
        ...item,
        image_url: (item.image_path && signedByPath.get(item.image_path)) || item.image_url,
      }));
    }
  }
  const whatsappReadiness = buildWhatsAppReadiness(whatsappSchemaReady);

  const statusKeys: ContentStatus[] = ["draft", "pending_review", "approved", "published", "rejected"];
  const statusCountResults = await Promise.all(
    statusKeys.map((status) =>
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .eq("channel", activeChannel)
        .eq("status", status),
    ),
  );
  const counts = Object.fromEntries(
    statusKeys.map((status, index) => [status, statusCountResults[index].count ?? 0]),
  ) as Record<ContentStatus, number>;
  const errorLabels: Record<string, string> = {
    topic: "موضوع محتوا را کوتاه و روشن بنویس.",
    type: "نوع محتوای واتساپ معتبر نیست.",
    brief: "هدف، مخاطب یا قالب تصویر معتبر نیست.",
    product: "محصول انتخاب‌شده در کاتالوگ شما در دسترس نیست.",
    claims: "پس از حذف ادعاهای بدون منبع، متن قابل استفاده‌ای باقی نماند.",
    generation: "تولید محتوا انجام نشد؛ تنظیمات مدل یا ورودی را بررسی کن.",
    parse: "پاسخ مدل با ساختار مورد انتظار تطابق نداشت؛ دوباره تلاش کن.",
    database: "ذخیره محتوا در Supabase انجام نشد.",
    schedule: "تاریخ زمان‌بندی معتبر نیست.",
    "image-prompt": "برای این محتوا پرامپت تصویر وجود ندارد.",
    "image-config": "تنظیمات تولید تصویر کامل نیست.",
    "image-generation": "تولید تصویر انجام نشد.",
    "image-upload": "بارگذاری تصویر در Supabase انجام نشد.",
    "image-database": "آدرس تصویر ذخیره نشد.",
    brand: "ذخیره تنظیمات برند انجام نشد؛ ورودی‌ها را بررسی کن.",
    catalog: "ذخیره اطلاعات تأییدشده محصول انجام نشد.",
    "product-image": "تصویر واقعی محصول باید PNG یا JPEG معتبر و حداکثر ۱۵ مگابایت باشد.",
    status: "تغییر وضعیت محتوا انجام نشد.",
  };

  return (
    <AppShell
      active="content-studio"
      title="استودیو تولید محتوا"
      subtitle="تولید امن محتوای اینستاگرام و واتساپ امیدمِد"
    >
      <nav className={styles.channelTabs} aria-label="کانال محتوا">
        <Link className={activeChannel === "instagram" ? styles.activeChannel : ""} href="/content-studio?channel=instagram">اینستاگرام</Link>
        <Link className={activeChannel === "whatsapp" ? styles.activeChannel : ""} href="/content-studio?channel=whatsapp">واتساپ</Link>
      </nav>
      {params.saved ? <div className={styles.notice}>تغییرات با موفقیت ذخیره شد.</div> : null}
      {params.error ? <div className={styles.error}>{errorLabels[params.error] || "عملیات انجام نشد."}</div> : null}
      {contentError ? <div className={styles.error}>خواندن فهرست محتوا انجام نشد.</div> : null}
      {!whatsappSchemaReady && activeChannel === "whatsapp" ? (
        <div className={styles.error}>زیرساخت پایگاه داده واتساپ هنوز آماده نیست. تولید، ویرایش، کپی متن و دانلود تصویر فعال‌اند؛ ثبت رضایت، تاریخچه و ارسال رسمی تا اعمال جداگانه migration 023 غیرفعال می‌مانند.</div>
      ) : null}

      <section className={styles.metrics}>
        <article><span>پیش‌نویس</span><strong>{counts.draft}</strong></article>
        <article><span>منتظر تأیید</span><strong>{counts.pending_review}</strong></article>
        <article><span>تأییدشده</span><strong>{counts.approved}</strong></article>
        <article><span>منتشرشده</span><strong>{counts.published}</strong></article>
      </section>

      <section className={styles.layout}>
        <article className={styles.creator}>
          <span className={styles.eyebrow}>AI Sales Content Studio</span>
          <h2>محتوای فروش تجهیزات پزشکی</h2>
          <p>هدف، محصول واقعی، مخاطب و کانال را انتخاب کن؛ مشخصات تأییدنشده یا تصویر جعلی محصول ساخته نمی‌شود.</p>
          <form action={generateContent} className={styles.form}>
            <input type="hidden" name="channel" value={activeChannel} />
            <label>۱. هدف<select name="goal" defaultValue="product_introduction">{CONTENT_GOALS.map((value) => <option value={value} key={value}>{goalLabels[value]}</option>)}</select></label>
            <label>۲. محصول واقعی<select name="product_id" defaultValue=""><option value="">بدون محصول مشخص؛ ساخت مشخصات ممنوع</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name}{product.brand ? ` — ${product.brand}` : ""}{product.model ? ` ${product.model}` : ""}</option>)}</select></label>
            <label>نام محصول آزاد (فقط اگر هنوز در کاتالوگ نیست)<input name="product_name" maxLength={180} placeholder="بدون ساخت مشخصات فنی" /></label>
            <label>۳. مشتری / مخاطب<select name="customer_id" defaultValue=""><option value="">بدون مشتری مشخص</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} — {customer.contact_name || customer.city || "بدون مخاطب"}</option>)}</select></label>
            <label>گروه مخاطب<select name="audience" defaultValue="physiotherapist">{CONTENT_AUDIENCES.map((value) => <option value={value} key={value}>{audienceLabels[value]}</option>)}</select></label>
            <label>۴. نوع محتوا<select name="content_type" defaultValue={activeChannel === "whatsapp" ? "whatsapp_sales" : "instagram_post"}>{(activeChannel === "whatsapp" ? WHATSAPP_CONTENT_TYPES : CONTENT_TYPES.filter((value) => !value.startsWith("whatsapp_") && value !== "sms")).map((type) => <option value={type} key={type}>{whatsappTypeLabels[type] || contentTypeLabels[type] || type}</option>)}</select></label>
            <label>۵. سبک<select name="tone" defaultValue="professional"><option value="professional">حرفه‌ای و فروش‌محور</option><option value="friendly">صمیمی و محترمانه</option><option value="educational">آموزشی و اعتمادساز</option><option value="direct">کوتاه و مستقیم</option></select></label>
            <label>موضوع / Brief<textarea name="topic" required maxLength={500} placeholder="مثلاً پیگیری قیمت پس از ارسال پیش‌فاکتور؛ بدون تخفیف ساختگی" /></label>
            {activeChannel === "whatsapp" ? (
              <p className={styles.compliance}>ارسال واقعی فقط بعد از ویرایش، ذخیره، بررسی رضایت، اعتبار شماره، Preview و تأیید نهایی فعال می‌شود.</p>
            ) : (
              <label>قالب<select name="format" defaultValue="post"><option value="post">پست</option><option value="carousel">پست اسلایدی</option><option value="story">استوری</option><option value="reel">سناریوی ریلز</option><option value="article">مقاله</option></select></label>
            )}
            <label>قالب تصویر<select name="image_preset" defaultValue={activeChannel === "whatsapp" ? "whatsapp_square" : "instagram_square"}>{Object.entries(IMAGE_PRESETS).map(([value, preset]) => <option value={value} key={value}>{preset.label}</option>)}</select></label>
            <label>زمان انتشار پیشنهادی<input type="datetime-local" name="scheduled_for" /></label>
            <button type="submit">۶. تولید، اعتبارسنجی و ذخیره پیش‌نویس</button>
          </form>

          <details className={styles.advancedPanel}>
            <summary>تنظیمات پیشرفته برند</summary>
            <p>این داده‌ها در همه Briefها استفاده می‌شوند و به مدل اجازه ساخت ادعای جدید نمی‌دهند.</p>
            <form action={saveBrandProfile} className={styles.form}>
              <label>نام شرکت<input name="company_name" maxLength={180} defaultValue={brandProfile?.company_name ?? "امیدمِد"} /></label>
              <label>لحن برند<input name="brand_tone" maxLength={80} defaultValue={brandProfile?.tone ?? "professional"} /></label>
              <label>رنگ‌ها (Hex، هر مورد در یک خط)<textarea name="colors" defaultValue={(brandProfile?.colors ?? ["#172554", "#0f766e"]).join("\n")} /></label>
              <label>سبک فارسی<textarea name="persian_style" maxLength={500} defaultValue={brandProfile?.persian_style ?? ""} /></label>
              <label>شماره تماس<input name="phone" maxLength={40} defaultValue={brandProfile?.phone ?? ""} /></label>
              <label>وب‌سایت<input name="website" type="url" maxLength={300} defaultValue={brandProfile?.website ?? ""} /></label>
              <label>اینستاگرام<input name="instagram" maxLength={120} defaultValue={brandProfile?.instagram ?? ""} /></label>
              <label>سبک دعوت به اقدام<textarea name="cta_style" maxLength={500} defaultValue={brandProfile?.cta_style ?? ""} /></label>
              <label>عبارت‌های ممنوع (هر مورد در یک خط)<textarea name="forbidden_phrases" defaultValue={(brandProfile?.forbidden_phrases ?? []).join("\n")} /></label>
              <label>Disclaimers تأییدشده (هر مورد در یک خط)<textarea name="disclaimers" defaultValue={(brandProfile?.disclaimers ?? []).join("\n")} /></label>
              <button type="submit">ذخیره پروفایل برند</button>
            </form>
          </details>

          <details className={styles.advancedPanel} open={Boolean(selectedCatalogProduct)}>
            <summary>کاتالوگ و تصویر واقعی محصول</summary>
            <p>فقط مشخصات مستند را وارد کن. فیلد خالی به‌عنوان «تأییدنشده» در نظر گرفته می‌شود.</p>
            <form className={styles.form} method="get">
              <input type="hidden" name="channel" value={activeChannel} />
              <label>محصول برای تکمیل<select name="catalog_product" defaultValue={selectedCatalogProduct?.id ?? ""}><option value="">انتخاب محصول</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
              <button type="submit">بازکردن اطلاعات محصول</button>
            </form>
            {selectedCatalogProduct ? (
              <>
                <form action={saveProductGrounding} className={styles.form}>
                  <input type="hidden" name="product_id" value={selectedCatalogProduct.id} />
                  <label>برند<input name="brand" maxLength={180} defaultValue={selectedCatalogProduct.brand ?? ""} /></label>
                  <label>مدل<input name="model" maxLength={180} defaultValue={selectedCatalogProduct.model ?? ""} /></label>
                  <label>مشخصات فنی تأییدشده (هر خط: عنوان: مقدار)<textarea name="technical_specifications" defaultValue={Object.entries(selectedCatalogProduct.technical_specifications ?? {}).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")} /></label>
                  <label>کاربردها<textarea name="applications" defaultValue={selectedCatalogProduct.applications.join("\n")} /></label>
                  <label>تخصص‌های هدف<textarea name="target_specialties" defaultValue={selectedCatalogProduct.target_specialties.join("\n")} /></label>
                  <label>مزیت‌های تأییدشده<textarea name="advantages" defaultValue={selectedCatalogProduct.advantages.join("\n")} /></label>
                  <label>تمایزهای تأییدشده<textarea name="differentiators" defaultValue={selectedCatalogProduct.differentiators.join("\n")} /></label>
                  <label>موجودی<select name="inventory_status" defaultValue={selectedCatalogProduct.inventory_status}><option value="unknown">نامشخص</option><option value="in_stock">موجود</option><option value="low_stock">رو به اتمام</option><option value="out_of_stock">ناموجود</option><option value="made_to_order">سفارشی</option></select></label>
                  <label>گارانتی<textarea name="warranty" defaultValue={selectedCatalogProduct.warranty ?? ""} /></label>
                  <label>خدمات پس از فروش<textarea name="after_sales_service" defaultValue={selectedCatalogProduct.after_sales_service ?? ""} /></label>
                  <label>آموزش<textarea name="training" defaultValue={selectedCatalogProduct.training ?? ""} /></label>
                  <label>ادعاهای بازاریابی دارای منبع<textarea name="approved_marketing_claims" defaultValue={selectedCatalogProduct.approved_marketing_claims.join("\n")} /></label>
                  <label>لینک بروشور معتبر<input name="brochure_url" type="url" maxLength={500} defaultValue={selectedCatalogProduct.brochure_url ?? ""} /></label>
                  <button type="submit">ذخیره Grounding محصول</button>
                </form>
                <form action={uploadProductImage} className={styles.form} encType="multipart/form-data">
                  <input type="hidden" name="product_id" value={selectedCatalogProduct.id} />
                  <label>تصویر واقعی محصول (PNG/JPEG)<input name="product_image" type="file" accept="image/png,image/jpeg" required /></label>
                  <small>{selectedCatalogProduct.primary_image_path ? "تصویر اصلی معتبر ثبت شده است؛ فایل جدید جایگزین تصویر اصلی می‌شود." : "هنوز تصویر واقعی ثبت نشده است."}</small>
                  <button type="submit">بارگذاری امن تصویر واقعی</button>
                </form>
              </>
            ) : null}
          </details>
        </article>

        <article className={styles.calendar}>
          <header className={styles.sectionHeader}><div><span className={styles.eyebrow}>تاریخچه محتوا</span><h2>جست‌وجو، ویرایش، نسخه‌ها و ارسال</h2></div><span>{totalItems.toLocaleString("fa-IR")} محتوا</span></header>
          <form className={styles.form} method="get">
            <input type="hidden" name="channel" value={activeChannel} />
            <input name="q" defaultValue={params.q} placeholder="جست‌وجوی عنوان، موضوع یا متن" />
            <select name="status" defaultValue={params.status ?? ""}><option value="">همه وضعیت‌ها</option>{statusKeys.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select>
            <select name="product" defaultValue={params.product ?? ""}><option value="">همه محصولات</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select>
            <select name="customer" defaultValue={params.customer ?? ""}><option value="">همه مشتریان</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select>
            <select name="sent" defaultValue={params.sent ?? ""}><option value="">ارسال‌شده و نشده</option><option value="yes">ارسال‌شده</option><option value="no">ارسال‌نشده</option></select>
            <button type="submit">اعمال فیلتر</button>
          </form>
          {items.length ? (
            <div className={styles.items}>
              {items.map((item) => {
                const whatsappPayload = isStoredWhatsAppPayload(item.channel_payload)
                  ? item.channel_payload
                  : decodeLegacyWhatsAppPayload(item.hashtags);
                const instagramText = [item.caption, item.call_to_action, item.hashtags.join(" ")].filter(Boolean).join("\n\n");
                return (
                  <article className={styles.card} key={item.id}>
                    <header className={styles.cardHeader}><div><small>{item.channel === "whatsapp" && whatsappPayload ? whatsappTypeLabels[whatsappPayload.content_type] : formatLabels[item.format] || item.format}</small><h3>{item.title}</h3><p>{item.topic}</p></div><span className={`${styles.status} ${styles[item.status]}`}>{statusLabels[item.status]}</span></header>
                    <div className={styles.preview}>
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt={item.title} />
                      ) : (
                        <div className={styles.imagePlaceholder}><span>هنوز تصویر ساخته نشده است.</span>{item.image_prompt && item.created_by === user.id ? <form action={generateImage}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="channel" value={activeChannel} /><button type="submit">ساخت تصویر</button></form> : null}</div>
                      )}
                      {item.channel === "instagram" ? <div className={styles.copy}><strong>{item.on_image_text || "متن روی تصویر تعیین نشده"}</strong><p>{item.caption}</p>{item.call_to_action ? <b>{item.call_to_action}</b> : null}{item.hashtags.length ? <small>{item.hashtags.join(" ")}</small> : null}<ContentRevisionEditor itemId={item.id} initialText={item.final_text || item.caption} channelPayload={item.channel_payload ?? {}} /></div> : null}
                    </div>
                    {item.channel === "whatsapp" && whatsappPayload ? (
                      <WhatsAppContentCard itemId={item.id} imageUrl={item.image_url} payload={whatsappPayload} customers={customers} history={history.filter((message) => message.content_item_id === item.id)} readiness={whatsappReadiness} templates={templates} />
                    ) : item.channel === "instagram" ? (
                      <div className={styles.actions}><CopyButton itemId={item.id} className={styles.copyButton} text={instagramText} label="کپی متن اینستاگرام" /><span className={styles.date}>{formatDate(item.scheduled_for)}</span></div>
                    ) : <div className={styles.error}>ساختار ذخیره‌شده این محتوا معتبر نیست.</div>}
                    <div className={styles.actions}>
                      <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="channel" value={activeChannel} /><input type="hidden" name="status" value="pending_review" /><button className={styles.secondary} type="submit">ارسال برای تأیید</button></form>
                      <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="channel" value={activeChannel} /><input type="hidden" name="status" value="approved" /><button className={styles.approve} type="submit">تأیید</button></form>
                      <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="channel" value={activeChannel} /><input type="hidden" name="status" value="published" /><button type="submit">منتشر شد</button></form>
                      <span className={styles.date}>{formatDate(item.scheduled_for)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className={styles.empty}><h3>هنوز محتوایی برای این کانال ساخته نشده است.</h3><p>از فرم کنار صفحه اولین پیش‌نویس را تولید کن.</p></div>}
          {totalPages > 1 ? (
            <nav className={styles.actions} aria-label="صفحه‌بندی تاریخچه محتوا">
              {page > 1 ? <Link href={{ pathname: "/content-studio", query: { ...params, channel: activeChannel, page: page - 1 } }}>صفحه قبل</Link> : null}
              <span>صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}</span>
              {page < totalPages ? <Link href={{ pathname: "/content-studio", query: { ...params, channel: activeChannel, page: page + 1 } }}>صفحه بعد</Link> : null}
            </nav>
          ) : null}
        </article>
      </section>
    </AppShell>
  );
}
