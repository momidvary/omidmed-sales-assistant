import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import AppShell from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import styles from "./content-studio.module.css";

export const runtime = "nodejs";
export const maxDuration = 60;

type ContentStatus = "draft" | "pending_review" | "approved" | "published" | "rejected";
type ContentItem = {
  id: string;
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
  rejection_note: string | null;
  created_at: string;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
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

function textFromResponse(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();
  return (data.output ?? [])
    .flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseGeneratedContent(raw: string) {
  const cleaned = raw.replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  return {
    title: String(value.title ?? "محتوای جدید امیدمِد").slice(0, 180),
    caption: String(value.caption ?? "").slice(0, 8000),
    on_image_text: String(value.on_image_text ?? "").slice(0, 500),
    call_to_action: String(value.call_to_action ?? "").slice(0, 500),
    hashtags: Array.isArray(value.hashtags)
      ? value.hashtags.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 15)
      : [],
    image_prompt: String(value.image_prompt ?? "").slice(0, 5000),
  };
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) redirect("/content-studio?error=openai");

  const prompt = `برای برند امیدمِد یک محتوای اینستاگرامی فارسی تولید کن.
مخاطب: فیزیوتراپیست و مدیر کلینیک فیزیوتراپی
موضوع: ${topic}
محصول: ${productName || "محصولات مصرفی فیزیوتراپی"}
هدف: ${objective}
قالب: ${formatLabels[format] || format}

هویت برند: تأمین‌کننده تخصصی و اقتصادی لوازم مصرفی کلینیک، کیفیت مطمئن، قیمت منصفانه، چاپ اختصاصی لوگوی کلینیک و ارسال سریع.
قواعد: ادعای پزشکی یا مشخصات و قیمت اختراع نکن. اگر قیمت داده نشده، قیمت نساز. لحن حرفه‌ای، مودبانه و طبیعی باشد. متن برای فروش B2B به فیزیوتراپیست نوشته شود.
فقط JSON معتبر با کلیدهای title، caption، on_image_text، call_to_action، hashtags و image_prompt برگردان. hashtags آرایه‌ای از رشته‌ها باشد. image_prompt را انگلیسی، مناسب تصویر تبلیغاتی واقعی و بدون درج نوشته فارسی داخل تصویر بنویس.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_CONTENT_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "low" },
      instructions: "You are Omidmed's careful Persian B2B content strategist. Return only valid JSON.",
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

  try {
    const generated = parseGeneratedContent(textFromResponse(data));
    if (!generated.caption) redirect("/content-studio?error=empty");

    const { error } = await supabase.from("content_items").insert({
      created_by: user.id,
      topic,
      product_name: productName || null,
      objective,
      audience: "physiotherapists",
      channel: "instagram",
      format,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      status: "draft",
      ...generated,
    });

    if (error) {
      console.error("Content insert failed:", error.message);
      redirect("/content-studio?error=database");
    }
  } catch (error) {
    console.error("Generated JSON parse failed:", error);
    redirect("/content-studio?error=parse");
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
    .select("id,title,image_prompt,format")
    .eq("id", itemId)
    .single();

  if (!item?.image_prompt) redirect("/content-studio?error=image-prompt");

  const apiKey = process.env.OPENAI_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiKey || !serviceKey || !supabaseUrl) redirect("/content-studio?error=image-config");

  const size = item.format === "story" || item.format === "reel" ? "1024x1536" : "1024x1024";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: `${item.image_prompt}\nBrand context: Omidmed physiotherapy consumables, clean clinical setting, premium navy and turquoise accents, realistic products, no invented logo, no readable text.`,
      size,
      quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
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
    .upload(path, Buffer.from(base64, "base64"), { contentType: "image/png", upsert: false });

  if (uploadError) {
    console.error("Image upload failed:", uploadError.message);
    redirect("/content-studio?error=image-upload");
  }

  const { data: publicData } = admin.storage.from("content-studio").getPublicUrl(path);
  await supabase
    .from("content_items")
    .update({ image_path: path, image_url: publicData.publicUrl })
    .eq("id", item.id);

  revalidatePath("/content-studio");
  redirect("/content-studio?saved=image");
}

async function changeStatus(formData: FormData) {
  "use server";

  const { supabase, user } = await requireUser();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ContentStatus;
  const allowed: ContentStatus[] = ["draft", "pending_review", "approved", "published", "rejected"];
  if (!itemId || !allowed.includes(status)) return;

  const patch: Record<string, unknown> = { status };
  if (status === "approved") {
    patch.reviewed_by = user.id;
    patch.approved_at = new Date().toISOString();
  }
  if (status === "published") patch.published_at = new Date().toISOString();

  await supabase.from("content_items").update(patch).eq("id", itemId);
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
    .select("id,title,topic,product_name,objective,channel,format,caption,on_image_text,call_to_action,hashtags,image_prompt,image_url,scheduled_for,status,rejection_note,created_at")
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
    empty: "مدل متن قابل استفاده‌ای برنگرداند.",
    parse: "ساختار پاسخ مدل معتبر نبود؛ دوباره تلاش کن.",
    database: "ذخیره محتوا انجام نشد؛ migration دیتابیس را اجرا کن.",
    "image-prompt": "برای این محتوا پرامپت تصویر وجود ندارد.",
    "image-config": "تنظیمات OpenAI یا Supabase Service Role کامل نیست.",
    "image-generation": "تولید تصویر انجام نشد؛ دسترسی مدل تصویر را بررسی کن.",
    "image-upload": "تصویر تولید شد اما در فضای ذخیره‌سازی ثبت نشد.",
  };

  return (
    <AppShell
      active="content-studio"
      title="استودیو محتوای امیدمِد"
      subtitle="ایده را به متن، تصویر و برنامه انتشار اینستاگرام تبدیل کن؛ انتشار فقط بعد از تأیید انجام می‌شود."
    >
      {params.error ? <div className={styles.error}>{errorLabels[params.error] || "عملیات انجام نشد."}</div> : null}
      {params.saved ? <div className={styles.notice}>تغییرات با موفقیت ذخیره شد.</div> : null}
      {error ? <div className={styles.error}>خواندن محتوا با خطا روبه‌رو شد: {error.message}</div> : null}

      <section className={styles.metrics}>
        <article><span>پیش‌نویس</span><strong>{counts.draft.toLocaleString("fa-IR")}</strong></article>
        <article><span>منتظر تأیید</span><strong>{counts.pending_review.toLocaleString("fa-IR")}</strong></article>
        <article><span>تأییدشده</span><strong>{counts.approved.toLocaleString("fa-IR")}</strong></article>
        <article><span>منتشرشده</span><strong>{counts.published.toLocaleString("fa-IR")}</strong></article>
      </section>

      <section className={styles.layout}>
        <aside className={styles.creator}>
          <span className={styles.eyebrow}>تولید با هوش مصنوعی</span>
          <h2>محتوای جدید</h2>
          <p>موضوع، محصول و هدف را بده؛ متن فروش‌محور و پرامپت تصویر آماده می‌شود.</p>

          <form action={generateContent} className={styles.form}>
            <label>
              موضوع محتوا
              <textarea name="topic" required maxLength={500} placeholder="مثلاً تخفیف ویژه پد اسپانیایی به مناسبت روز فیزیوتراپی" />
            </label>
            <label>
              محصول
              <input name="product_name" placeholder="پد اسپانیایی، ملحفه ۴۰ گرم، پک بیمار..." />
            </label>
            <div className={styles.twoColumns}>
              <label>
                هدف
                <select name="objective" defaultValue="sales">
                  <option value="sales">افزایش فروش</option>
                  <option value="lead_generation">جذب مشتری جدید</option>
                  <option value="education">آموزش و اعتمادسازی</option>
                  <option value="repeat_purchase">خرید مجدد</option>
                </select>
              </label>
              <label>
                قالب
                <select name="format" defaultValue="post">
                  <option value="post">پست</option>
                  <option value="carousel">پست اسلایدی</option>
                  <option value="story">استوری</option>
                  <option value="reel">سناریوی ریلز</option>
                </select>
              </label>
            </div>
            <label>
              زمان پیشنهادی انتشار
              <input name="scheduled_for" type="datetime-local" />
            </label>
            <button type="submit">تولید متن و ایده تصویر</button>
          </form>
        </aside>

        <div className={styles.calendar}>
          <header className={styles.sectionHeader}>
            <div><span className={styles.eyebrow}>تقویم و تأیید</span><h2>صف انتشار اینستاگرام</h2></div>
            <span>{items.length.toLocaleString("fa-IR")} محتوا</span>
          </header>

          {items.length ? (
            <div className={styles.items}>
              {items.map((item) => (
                <article className={styles.card} key={item.id}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span className={styles.date}>{formatDate(item.scheduled_for)}</span>
                      <h3>{item.title}</h3>
                      <p>{formatLabels[item.format] || item.format} · {item.product_name || "محتوای عمومی"}</p>
                    </div>
                    <span className={`${styles.status} ${styles[item.status]}`}>{statusLabels[item.status]}</span>
                  </div>

                  <div className={styles.preview}>
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt={item.title} />
                    ) : (
                      <div className={styles.imagePlaceholder}>
                        <span>تصویر هنوز ساخته نشده</span>
                        {item.image_prompt ? <form action={generateImage}><input type="hidden" name="item_id" value={item.id} /><button type="submit">تولید تصویر</button></form> : null}
                      </div>
                    )}
                    <div className={styles.copy}>
                      {item.on_image_text ? <strong>{item.on_image_text}</strong> : null}
                      <p>{item.caption}</p>
                      {item.call_to_action ? <b>{item.call_to_action}</b> : null}
                      {item.hashtags?.length ? <small>{item.hashtags.join(" ")}</small> : null}
                    </div>
                  </div>

                  <div className={styles.actions}>
                    {item.status === "draft" || item.status === "rejected" ? (
                      <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="status" value="pending_review" /><button type="submit">ارسال برای تأیید</button></form>
                    ) : null}
                    {item.status === "pending_review" ? (
                      <>
                        <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="status" value="approved" /><button className={styles.approve} type="submit">تأیید مدیر</button></form>
                        <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="status" value="rejected" /><button className={styles.secondary} type="submit">برگشت برای اصلاح</button></form>
                      </>
                    ) : null}
                    {item.status === "approved" ? (
                      <form action={changeStatus}><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="status" value="published" /><button className={styles.approve} type="submit">ثبت به‌عنوان منتشرشده</button></form>
                    ) : null}
                    <button className={styles.copyButton} type="button" title="متن را انتخاب و کپی کن">متن آماده اینستاگرام</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}><h3>هنوز محتوایی ساخته نشده</h3><p>اولین موضوع فروش یا آموزشی را از فرم کناری تولید کن.</p></div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
