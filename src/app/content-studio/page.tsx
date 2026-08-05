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
import { generateStructuredContent } from "@/lib/content-studio/openai";
import {
  decodeLegacyWhatsAppPayload,
  encodeLegacyWhatsAppPayload,
  isStoredWhatsAppPayload,
  type StoredWhatsAppPayload,
} from "@/lib/content-studio/whatsapp-legacy";
import { createClient } from "@/lib/supabase/server";
import { buildWhatsAppReadiness, probeWhatsAppSchema } from "@/lib/whatsapp/readiness";

import CopyButton from "./copy-button";
import styles from "./content-studio.module.css";
import WhatsAppContentCard from "./whatsapp-content-card";

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
  scheduled_for: string | null;
  status: ContentStatus;
  channel_payload?: Record<string, unknown> | null;
  created_at: string;
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

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function generateContent(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const channel = String(formData.get("channel") ?? "instagram") as ContentChannel;
  const topic = String(formData.get("topic") ?? "").trim();
  const productName = String(formData.get("product_name") ?? "").trim();
  const objective = String(formData.get("objective") ?? "sales").trim();
  const requestedFormat = String(formData.get("format") ?? "post").trim();
  const scheduledFor = String(formData.get("scheduled_for") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const contentType = String(formData.get("content_type") ?? "product_intro");

  if (!topic || topic.length > 500 || !["instagram", "whatsapp"].includes(channel)) {
    redirect(`/content-studio?channel=${channel}&error=topic`);
  }
  if (channel === "whatsapp" && !WHATSAPP_CONTENT_TYPES.includes(contentType as never)) {
    redirect("/content-studio?channel=whatsapp&error=type");
  }

  let customer: { name: string; contact_name: string | null; city: string | null } | null = null;
  if (channel === "whatsapp" && customerId) {
    const result = await supabase
      .from("customers")
      .select("name,contact_name,city")
      .eq("id", customerId)
      .eq("owner_id", user.id)
      .maybeSingle();
    customer = result.data;
  }

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
          ? buildWhatsAppPrompt({
              topic,
              productName,
              objective,
              contentType: contentType as (typeof WHATSAPP_CONTENT_TYPES)[number],
              customerName: customer?.name,
              clinicName: customer?.name,
              city: customer?.city ?? undefined,
              contactName: customer?.contact_name ?? undefined,
            })
          : buildInstagramPrompt({
              topic,
              productName,
              objective,
              formatLabel: formatLabels[requestedFormat] || requestedFormat,
            }),
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

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    redirect(`/content-studio?channel=${channel}&error=schedule`);
  }

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
      product_name: productName || null,
      objective,
      audience: "physiotherapists",
      channel,
      format: contentType === "status" ? "story" : "post",
      scheduled_for: scheduledDate?.toISOString() ?? null,
      status: "draft",
      title: whatsappGenerated.title,
      caption: whatsappGenerated.whatsapp_long_text,
      on_image_text: whatsappGenerated.whatsapp_short_text,
      call_to_action: whatsappGenerated.call_to_action,
      image_prompt: whatsappGenerated.image_prompt,
    };
    const extendedResult = await supabase.from("content_items").insert({
      ...baseInsert,
      hashtags: [],
      channel_payload: payload,
    } as never);
    insertError = extendedResult.error;
    if (extendedResult.error) {
      const compatibilityResult = await supabase.from("content_items").insert({
        ...baseInsert,
        hashtags: [encodeLegacyWhatsAppPayload(payload)],
      } as never);
      insertError = compatibilityResult.error;
    }
  } else {
    const instagramResult = await supabase.from("content_items").insert({
      created_by: user.id,
      topic,
      product_name: productName || null,
      objective,
      audience: "physiotherapists",
      channel,
      format: requestedFormat,
      scheduled_for: scheduledDate?.toISOString() ?? null,
      status: "draft",
      ...generated,
    } as never);
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
    .select("id,title,image_prompt,format,created_by")
    .eq("id", itemId)
    .eq("created_by", user.id)
    .single();
  if (!item?.image_prompt) redirect(`/content-studio?channel=${channel}&error=image-prompt`);

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
      prompt: `${item.image_prompt}\nBrand context: Omidmed physiotherapy consumables, clean clinical setting, premium navy and turquoise accents, realistic products, no invented logo, no readable text.`,
      size: item.format === "story" || item.format === "reel" ? "1024x1536" : "1024x1024",
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
  const path = `${user.id}/${item.id}-${Date.now()}.png`;
  const { error: uploadError } = await admin.storage
    .from("content-studio")
    .upload(path, Buffer.from(base64, "base64"), { contentType: "image/png", upsert: false });
  if (uploadError) redirect(`/content-studio?channel=${channel}&error=image-upload`);

  const { data: publicData } = admin.storage.from("content-studio").getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("content_items")
    .update({ image_path: path, image_url: publicData.publicUrl })
    .eq("id", item.id)
    .eq("created_by", user.id);
  if (updateError) redirect(`/content-studio?channel=${channel}&error=image-database`);
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
  const { error } = await supabase.from("content_items").update(update).eq("id", itemId);
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

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; channel?: string }>;
}) {
  const params = await searchParams;
  const activeChannel: ContentChannel = params.channel === "whatsapp" ? "whatsapp" : "instagram";
  const { supabase, user } = await requireUser();

  const extendedSelect =
    "id,created_by,title,topic,product_name,objective,channel,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_url,scheduled_for,status,channel_payload,created_at";
  const extendedContentResult = await supabase
    .from("content_items")
    .select(extendedSelect)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);
  let whatsappSchemaReady = !extendedContentResult.error;
  let contentData: unknown[] = extendedContentResult.data ?? [];
  let contentError = extendedContentResult.error;
  if (extendedContentResult.error) {
    whatsappSchemaReady = false;
    const fallbackContentResult = await supabase
      .from("content_items")
      .select("id,created_by,title,topic,product_name,objective,channel,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_url,scheduled_for,status,created_at")
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100);
    contentData = (fallbackContentResult.data ?? []).map((item) => ({
      ...item,
      channel_payload: null,
    }));
    contentError = fallbackContentResult.error;
  }
  const allItems = contentData as ContentItem[];
  const items = allItems.filter(
    (item) => item.channel === activeChannel && (item.channel !== "whatsapp" || item.created_by === user.id),
  );

  const extendedCustomerResult = await supabase
    .from("customers")
    .select("id,name,contact_name,phone,city,whatsapp_consent_status,whatsapp_consent_at")
    .eq("owner_id", user.id)
    .is("archived_at", null)
    .order("name")
    .limit(500);
  let customerData: unknown[] = extendedCustomerResult.data ?? [];
  if (extendedCustomerResult.error) {
    whatsappSchemaReady = false;
    const fallback = await supabase
      .from("customers")
      .select("id,name,contact_name,phone,city")
      .eq("owner_id", user.id)
      .is("archived_at", null)
      .order("name")
      .limit(500);
    customerData = (fallback.data ?? []).map((customer) => ({
        ...customer,
        whatsapp_consent_status: "unknown",
        whatsapp_consent_at: null,
      }));
  }
  const customers = customerData as CustomerOption[];

  let history: MessageHistory[] = [];
  if (whatsappSchemaReady) {
    const messageResult = await supabase
      .from("whatsapp_messages")
      .select("id,content_item_id,status,message_type,created_at,accepted_at,sent_at,delivered_at,read_at,failed_at,provider_result_unknown_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (messageResult.error) whatsappSchemaReady = false;
    else history = (messageResult.data ?? []) as MessageHistory[];
  }
  const readinessSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const readinessServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (whatsappSchemaReady && readinessSupabaseUrl && readinessServiceKey) {
    const readinessAdmin = createAdminClient(readinessSupabaseUrl, readinessServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    whatsappSchemaReady = await probeWhatsAppSchema(readinessAdmin);
  }
  const whatsappReadiness = buildWhatsAppReadiness(whatsappSchemaReady);

  const counts = items.reduce<Record<ContentStatus, number>>(
    (acc, item) => ({ ...acc, [item.status]: acc[item.status] + 1 }),
    { draft: 0, pending_review: 0, approved: 0, published: 0, rejected: 0 },
  );
  const errorLabels: Record<string, string> = {
    topic: "موضوع محتوا را کوتاه و روشن بنویس.",
    type: "نوع محتوای واتساپ معتبر نیست.",
    generation: "تولید محتوا انجام نشد؛ تنظیمات مدل یا ورودی را بررسی کن.",
    parse: "پاسخ مدل با ساختار مورد انتظار تطابق نداشت؛ دوباره تلاش کن.",
    database: "ذخیره محتوا در Supabase انجام نشد.",
    schedule: "تاریخ زمان‌بندی معتبر نیست.",
    "image-prompt": "برای این محتوا پرامپت تصویر وجود ندارد.",
    "image-config": "تنظیمات تولید تصویر کامل نیست.",
    "image-generation": "تولید تصویر انجام نشد.",
    "image-upload": "بارگذاری تصویر در Supabase انجام نشد.",
    "image-database": "آدرس تصویر ذخیره نشد.",
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
          <span className={styles.eyebrow}>تولید با هوش مصنوعی</span>
          <h2>محتوای جدید {activeChannel === "whatsapp" ? "واتساپ" : "اینستاگرام"}</h2>
          <p>{activeChannel === "whatsapp" ? "متن کوتاه، کامل، استاتوس و پیش‌نویس Template به‌صورت ساختاریافته ساخته می‌شود." : "جریان فعلی تولید متن، تصویر و تأیید اینستاگرام حفظ شده است."}</p>
          <form action={generateContent} className={styles.form}>
            <input type="hidden" name="channel" value={activeChannel} />
            <label>موضوع<textarea name="topic" required maxLength={500} placeholder="مثلاً معرفی پد فرانسوی برای مدیر کلینیک" /></label>
            <label>محصول<input name="product_name" maxLength={180} placeholder="مثلاً پد فرانسوی" /></label>
            {activeChannel === "whatsapp" ? (
              <>
                <label>نوع محتوای واتساپ<select name="content_type" defaultValue="product_intro">{WHATSAPP_CONTENT_TYPES.map((type) => <option value={type} key={type}>{whatsappTypeLabels[type]}</option>)}</select></label>
                <label>شخصی‌سازی اختیاری با مشتری<select name="customer_id" defaultValue=""><option value="">بدون مشتری مشخص</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} — {customer.contact_name || customer.city || "بدون مخاطب"}</option>)}</select></label>
              </>
            ) : (
              <label>قالب<select name="format" defaultValue="post"><option value="post">پست</option><option value="carousel">پست اسلایدی</option><option value="story">استوری</option><option value="reel">سناریوی ریلز</option><option value="article">مقاله</option></select></label>
            )}
            <label>هدف<select name="objective" defaultValue="sales"><option value="sales">افزایش فروش</option><option value="education">آموزش</option><option value="trust">اعتمادسازی</option><option value="engagement">تعامل</option></select></label>
            <label>زمان انتشار پیشنهادی<input type="datetime-local" name="scheduled_for" /></label>
            <button type="submit">تولید و ذخیره پیش‌نویس</button>
          </form>
        </article>

        <article className={styles.calendar}>
          <header className={styles.sectionHeader}><div><span className={styles.eyebrow}>تقویم محتوا</span><h2>پیش‌نویس‌ها و برنامه انتشار</h2></div><span>{items.length} محتوا</span></header>
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
                      {item.channel === "instagram" ? <div className={styles.copy}><strong>{item.on_image_text || "متن روی تصویر تعیین نشده"}</strong><p>{item.caption}</p>{item.call_to_action ? <b>{item.call_to_action}</b> : null}{item.hashtags.length ? <small>{item.hashtags.join(" ")}</small> : null}</div> : null}
                    </div>
                    {item.channel === "whatsapp" && whatsappPayload ? (
                      <WhatsAppContentCard itemId={item.id} imageUrl={item.image_url} payload={whatsappPayload} customers={customers} history={history.filter((message) => message.content_item_id === item.id)} readiness={whatsappReadiness} />
                    ) : item.channel === "instagram" ? (
                      <div className={styles.actions}><CopyButton className={styles.copyButton} text={instagramText} label="کپی متن اینستاگرام" /><span className={styles.date}>{formatDate(item.scheduled_for)}</span></div>
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
        </article>
      </section>
    </AppShell>
  );
}
