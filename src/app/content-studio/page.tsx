import { Buffer } from "node:buffer";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

import CopyInstagramButton from "./copy-instagram-button";
import styles from "./content-studio.module.css";

export const runtime = "nodejs";
export const maxDuration = 60;

type ContentStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "published"
  | "rejected";

type ContentItem = {
  id: string;
  title: string;
  topic: string;
  product_name: string | null;
  objective: string;
  format: string;
  caption: string;
  on_image_text: string | null;
  call_to_action: string | null;
  hashtags: string[];
  image_prompt: string | null;
  image_url: string | null;
  scheduled_for: string | null;
  status: ContentStatus;
  created_at: string;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
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
  story: "استوری",
  reel: "سناریوی ریلز",
  article: "مقاله",
};

function extractOutputText(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();

  return (data.output ?? [])
    .flatMap((item) => (item.type === "message" ? item.content ?? [] : []))
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseGeneratedContent(raw: string) {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;

  return {
    title: String(value.title ?? "محتوای جدید امیدمِد").slice(0, 180),
    caption: String(value.caption ?? "").slice(0, 8000),
    on_image_text: String(value.on_image_text ?? "").slice(0, 500) || null,
    call_to_action: String(value.call_to_action ?? "").slice(0, 500) || null,
    hashtags: Array.isArray(value.hashtags)
      ? value.hashtags
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 15)
      : [],
    image_prompt: String(value.image_prompt ?? "").slice(0, 5000) || null,
  };
}

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
  const topic = String(formData.get("topic") ?? "").trim();
  const productName = String(formData.get("product_name") ?? "").trim();
  const objective = String(formData.get("objective") ?? "sales").trim();
  const format = String(formData.get("format") ?? "post").trim();
  const scheduledFor = String(formData.get("scheduled_for") ?? "").trim();

  if (!topic || topic.length > 500) redirect("/content-studio?error=topic");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) redirect("/content-studio?error=openai");

  const prompt = `برای برند امیدمِد یک محتوای فارسی تولید کن.
مخاطب: فیزیوتراپیست و مدیر کلینیک فیزیوتراپی
موضوع: ${topic}
محصول: ${productName || "محصولات مصرفی فیزیوتراپی"}
هدف: ${objective}
قالب: ${formatLabels[format] || format}

هویت برند: تأمین‌کننده تخصصی و اقتصادی لوازم مصرفی کلینیک، کیفیت مطمئن، قیمت منصفانه، چاپ اختصاصی لوگوی کلینیک و ارسال سریع.
قواعد: ادعای پزشکی، قیمت یا مشخصات اختراع نکن. لحن حرفه‌ای و طبیعی باشد. متن برای فروش B2B نوشته شود.
فقط JSON معتبر با کلیدهای title، caption، on_image_text، call_to_action، hashtags و image_prompt برگردان. hashtags آرایه رشته باشد. image_prompt انگلیسی و بدون نوشته داخل تصویر باشد.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.OPENAI_CONTENT_MODEL?.trim() ||
        process.env.OPENAI_MODEL?.trim() ||
        "gpt-5.2",
      reasoning: { effort: "low" },
      instructions:
        "You are Omidmed's careful Persian B2B content strategist. Return only valid JSON.",
      input: prompt,
      max_output_tokens: 1800,
      store: false,
    }),
    signal: AbortSignal.timeout(55_000),
    cache: "no-store",
  });

  const data = (await response.json()) as OpenAIResponse;
  if (!response.ok) {
    console.error("Content generation failed:", response.status, data.error?.message);
    redirect("/content-studio?error=generation");
  }

  let generated: ReturnType<typeof parseGeneratedContent>;
  try {
    generated = parseGeneratedContent(extractOutputText(data));
  } catch (error) {
    console.error("Generated JSON parse failed:", error);
    redirect("/content-studio?error=parse");
  }

  if (!generated.caption) redirect("/content-studio?error=empty");

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    redirect("/content-studio?error=schedule");
  }

  const { error } = await supabase.from("content_items").insert({
    created_by: user.id,
    topic,
    product_name: productName || null,
    objective,
    audience: "physiotherapists",
    channel: "instagram",
    format,
    scheduled_for: scheduledDate?.toISOString() ?? null,
    status: "draft",
    ...generated,
  });

  if (error) {
    console.error("Content insert failed:", error.message);
    redirect("/content-studio?error=database");
  }

  revalidatePath("/content-studio");
  redirect("/content-studio?saved=content");
}

async function generateImage(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const itemId = String(formData.get("item_id") ?? "").trim();
  if (!itemId) return;

  const { data: item } = await supabase
    .from("content_items")
    .select("id,title,image_prompt,format,created_by")
    .eq("id", itemId)
    .eq("created_by", user.id)
    .single();

  if (!item?.image_prompt) redirect("/content-studio?error=image-prompt");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!apiKey || !serviceKey || !supabaseUrl) {
    redirect("/content-studio?error=image-config");
  }

  const size =
    item.format === "story" || item.format === "reel"
      ? "1024x1536"
      : "1024x1024";

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      prompt: `${item.image_prompt}\nBrand context: Omidmed physiotherapy consumables, clean clinical setting, premium navy and turquoise accents, realistic products, no invented logo, no readable text.`,
      size,
      quality: process.env.OPENAI_IMAGE_QUALITY?.trim() || "medium",
      output_format: "png",
      n: 1,
    }),
    signal: AbortSignal.timeout(55_000),
    cache: "no-store",
  });

  const result = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };
  const base64 = result.data?.[0]?.b64_json;

  if (!response.ok || !base64) {
    console.error("Image generation failed:", response.status, result.error?.message);
    redirect("/content-studio?error=image-generation");
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const path = `${user.id}/${item.id}-${Date.now()}.png`;
  const { error: uploadError } = await admin.storage
    .from("content-studio")
    .upload(path, Buffer.from(base64, "base64"), {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadError) {
    console.error("Image upload failed:", uploadError.message);
    redirect("/content-studio?error=image-upload");
  }

  const { data: publicData } = admin.storage
    .from("content-studio")
    .getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ image_path: path, image_url: publicData.publicUrl })
    .eq("id", item.id)
    .eq("created_by", user.id);

  if (updateError) redirect("/content-studio?error=image-database");

  revalidatePath("/content-studio");
  redirect("/content-studio?saved=image");
}

async function changeStatus(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ContentStatus;
  const allowed: ContentStatus[] = [
    "draft",
    "pending_review",
    "approved",
    "published",
    "rejected",
  ];

  if (!itemId || !allowed.includes(status)) return;

  const patch: Record<string, unknown> = { status };
  if (status === "approved") {
    patch.reviewed_by = user.id;
    patch.approved_at = new Date().toISOString();
  }
  if (status === "published") patch.published_at = new Date().toISOString();

  const { error } = await supabase
    .from("content_items")
    .update(patch)
    .eq("id", itemId);

  if (error) redirect("/content-studio?error=status");

  revalidatePath("/content-studio");
  redirect("/content-studio?saved=status");
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
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("content_items")
    .select(
      "id,title,topic,product_name,objective,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_url,scheduled_for,status,created_at",
    )
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  const items = (data ?? []) as ContentItem[];
  const counts = items.reduce<Record<ContentStatus, number>>(
    (acc, item) => ({ ...acc, [item.status]: acc[item.status] + 1 }),
    { draft: 0, pending_review: 0, approved: 0, published: 0, rejected: 0 },
  );

  const errorLabels: Record<string, string> = {
    topic: "موضوع محتوا را کوتاه و روشن بنویس.",
    openai: "کلید OpenAI تنظیم نشده است.",
    generation: "تولید متن انجام نشد؛ مدل یا اعتبار API را بررسی کن.",
    parse: "پاسخ مدل ساختار معتبر نداشت؛ دوباره تلاش کن.",
    empty: "مدل متن قابل ذخیره تولید نکرد.",
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
      subtitle="تولید متن و تصویر، تأیید و زمان‌بندی محتوای امیدمِد"
    >
      {params.saved ? (
        <div className={styles.notice}>تغییرات با موفقیت ذخیره شد.</div>
      ) : null}
      {params.error ? (
        <div className={styles.error}>
          {errorLabels[params.error] || "عملیات انجام نشد."}
        </div>
      ) : null}
      {error ? <div className={styles.error}>{error.message}</div> : null}

      <section className={styles.metrics}>
        <article><span>پیش‌نویس</span><strong>{counts.draft}</strong></article>
        <article><span>منتظر تأیید</span><strong>{counts.pending_review}</strong></article>
        <article><span>تأییدشده</span><strong>{counts.approved}</strong></article>
        <article><span>منتشرشده</span><strong>{counts.published}</strong></article>
      </section>

      <section className={styles.layout}>
        <article className={styles.creator}>
          <span className={styles.eyebrow}>تولید با هوش مصنوعی</span>
          <h2>محتوای جدید</h2>
          <p>موضوع و قالب را مشخص کن؛ متن و پرامپت تصویر ساخته و به‌صورت پیش‌نویس ذخیره می‌شود.</p>

          <form action={generateContent} className={styles.form}>
            <label>
              موضوع
              <textarea name="topic" required maxLength={500} placeholder="مثلاً تفاوت پد اسپانیایی و فرانسوی" />
            </label>
            <label>
              محصول
              <input name="product_name" maxLength={180} placeholder="مثلاً پد فرانسوی" />
            </label>
            <div className={styles.twoColumns}>
              <label>
                قالب
                <select name="format" defaultValue="post">
                  <option value="post">پست</option>
                  <option value="carousel">پست اسلایدی</option>
                  <option value="story">استوری</option>
                  <option value="reel">سناریوی ریلز</option>
                  <option value="article">مقاله</option>
                </select>
              </label>
              <label>
                هدف
                <select name="objective" defaultValue="sales">
                  <option value="sales">افزایش فروش</option>
                  <option value="education">آموزش</option>
                  <option value="trust">اعتمادسازی</option>
                  <option value="engagement">تعامل</option>
                </select>
              </label>
            </div>
            <label>
              زمان انتشار پیشنهادی
              <input type="datetime-local" name="scheduled_for" />
            </label>
            <button type="submit">تولید و ذخیره پیش‌نویس</button>
          </form>
        </article>

        <article className={styles.calendar}>
          <header className={styles.sectionHeader}>
            <div>
              <span className={styles.eyebrow}>تقویم محتوا</span>
              <h2>پیش‌نویس‌ها و برنامه انتشار</h2>
            </div>
            <span>{items.length} محتوا</span>
          </header>

          {items.length ? (
            <div className={styles.items}>
              {items.map((item) => {
                const instagramText = [
                  item.caption,
                  item.call_to_action,
                  item.hashtags.join(" "),
                ].filter(Boolean).join("\n\n");

                return (
                  <article className={styles.card} key={item.id}>
                    <header className={styles.cardHeader}>
                      <div>
                        <small>{formatLabels[item.format] || item.format}</small>
                        <h3>{item.title}</h3>
                        <p>{item.topic}</p>
                      </div>
                      <span className={`${styles.status} ${styles[item.status]}`}>
                        {statusLabels[item.status]}
                      </span>
                    </header>

                    <div className={styles.preview}>
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt={item.title} />
                      ) : (
                        <div className={styles.imagePlaceholder}>
                          <span>هنوز تصویر ساخته نشده است.</span>
                          {item.image_prompt ? (
                            <form action={generateImage}>
                              <input type="hidden" name="item_id" value={item.id} />
                              <button type="submit">ساخت تصویر</button>
                            </form>
                          ) : null}
                        </div>
                      )}

                      <div className={styles.copy}>
                        <strong>{item.on_image_text || "متن روی تصویر تعیین نشده"}</strong>
                        <p>{item.caption}</p>
                        {item.call_to_action ? <b>{item.call_to_action}</b> : null}
                        {item.hashtags.length ? <small>{item.hashtags.join(" ")}</small> : null}
                      </div>
                    </div>

                    <div className={styles.actions}>
                      <CopyInstagramButton className={styles.copyButton} text={instagramText} />
                      <form action={changeStatus}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="status" value="pending_review" />
                        <button className={styles.secondary} type="submit">ارسال برای تأیید</button>
                      </form>
                      <form action={changeStatus}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button className={styles.approve} type="submit">تأیید</button>
                      </form>
                      <form action={changeStatus}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="status" value="published" />
                        <button type="submit">منتشر شد</button>
                      </form>
                      <span className={styles.date}>{formatDate(item.scheduled_for)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <h3>هنوز محتوایی ساخته نشده است.</h3>
              <p>از فرم کنار صفحه اولین پیش‌نویس را تولید کن.</p>
            </div>
          )}
        </article>
      </section>
    </AppShell>
  );
}
