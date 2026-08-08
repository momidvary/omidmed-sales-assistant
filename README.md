# دستیار فروش امیدمِد

برنامه شخصی و تک‌کاربره برای سازمان‌دهی فروش، مشتریان، پیگیری‌ها، کمپین‌ها، گزارش‌های هلو و حسابداری مدیریتی کارگاه امیدمِد.

## بخش‌های اصلی

- بانک مشتریان و پرونده هر مشتری
- پیگیری‌های روزانه و اولویت‌بندی تماس
- ورود و همگام‌سازی گزارش‌های هلو
- آرشیو طرح چاپ کیف و فاکتورهای مشتری
- کمپین‌های فروش و پیگیری قیمت‌های باز
- گزارش‌های فروش و خروجی Excel/CSV
- دستیار هوش مصنوعی فروش
- استودیو محتوای هوشمند برای تولید متن و تصویر، تقویم اینستاگرام و تأیید مدیر
- حسابداری مدیریتی کارگاه
  - تأمین‌کنندگان و فاکتورهای خرید
  - مواد اولیه و قیمت جایگزینی
  - هزینه‌های کارگاه و حقوق نیروها
  - فرمول ساخت محصولات (BOM)
  - محاسبه بهای تاریخی، میانگین و جایگزینی
  - پیشنهاد قیمت نقدی، عمده، جشنواره و اعتباری

## اجرای محلی

```powershell
cd C:\Projects\omidmed-sales-assistant-step1
npm install
npm run dev
```

سپس `http://localhost:3000` را باز کنید.

## متغیرهای محیطی

فایل `.env.local` باید شامل متغیرهای Supabase باشد. کلید OpenAI برای دستیار هوش مصنوعی و استودیو محتوا استفاده می‌شود.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.2
OPENAI_CONTENT_MODEL=gpt-5.2
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_VARIANT_COUNT=3
```

فایل `.env.local` نباید وارد GitHub شود.

## دیتابیس

فایل‌های پوشه `supabase/migrations` باید به ترتیب شماره اجرا شوند. برای راه‌اندازی استودیو محتوا، migration شماره `015_content_studio.sql` باید بعد از migration شماره 014 اعمال شود.

## نکته مالی

این بخش برای تصمیم‌گیری مدیریتی، بهای تمام‌شده و قیمت‌گذاری ساخته شده و جایگزین ثبت رسمی حسابداری، مالیات یا نرم‌افزار هلو نیست.

## استودیوی محتوای واتساپ

بخش `/content-studio?channel=whatsapp` سه قابلیت جدا دارد:

- تولید محتوای ساختاریافته با OpenAI؛ شامل متن کوتاه، متن کامل، متن استاتوس، فراخوان اقدام، پرامپت تصویر و پیش‌نویس Template.
- آماده‌سازی دستی؛ کپی متن، دانلود تصویر و بازکردن لینک امن `wa.me`. بازشدن این لینک به معنی ارسال یا تحویل پیام نیست.
- ارسال اختیاری یک‌به‌یک با API رسمی Meta WhatsApp Business Cloud API. هیچ کتابخانه WhatsApp Web، QR، کنترل مرورگر، cookie یا روش غیررسمی استفاده نمی‌شود.

استاتوس واتساپ فقط تولید، کپی و دانلود می‌شود. برنامه استاتوس را خودکار منتشر نمی‌کند و WhatsApp Web را کنترل نمی‌کند.

### تنظیمات سرور

متغیرهای زیر فقط روی سرور (برای نمونه Vercel) تنظیم می‌شوند. هیچ‌کدام نباید با پیشوند `NEXT_PUBLIC_` تعریف شوند و مقدار واقعی آن‌ها نباید در Git قرار بگیرد:

```env
WHATSAPP_CLOUD_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_GRAPH_API_VERSION=
```

### راه‌اندازی رسمی Meta در ۲۰ مرحله

1. در [Meta for Developers](https://developers.facebook.com/) یک Business App مخصوص محیط Production بسازید.
2. محصول WhatsApp را به App اضافه کنید؛ از WhatsApp Web، QR یا کتابخانه‌های غیررسمی استفاده نکنید.
3. WhatsApp Business Account (WABA) سازمان را در Business Manager ایجاد یا انتخاب کنید.
4. App را در تنظیمات رسمی Meta به همان WABA متصل کنید.
5. شماره تجاری را اضافه و مالکیت آن را طبق فرایند Meta تأیید کنید.
6. `Phone Number ID` همان شماره و `WhatsApp Business Account ID` همان WABA را از داشبورد رسمی بردارید؛ مقدارها را در Git یا تیکت ثبت نکنید.
7. برای Production یک token با حداقل دسترسی لازم و چرخه نگهداری/تعویض سازمانی بسازید؛ token موقت داشبورد را مبنای دائمی قرار ندهید.
8. شش متغیر server-only بالا را در Vercel ثبت کنید. نام‌ها قابل مستندسازی‌اند، اما مقدارها نباید در خروجی build، log یا مرورگر ظاهر شوند.
9. `WHATSAPP_GRAPH_API_VERSION` را صریحاً بر اساس نسخه پشتیبانی‌شده در مستندات جاری Meta تعیین کنید؛ برنامه نسخه پیش‌فرض حدس نمی‌زند.
10. Callback وبهوک را روی `https://<production-domain>/api/whatsapp/webhook` قرار دهید.
11. یک Verify Token تصادفی بسازید و همان مقدار را در Meta و `WHATSAPP_WEBHOOK_VERIFY_TOKEN` قرار دهید.
12. App Secret همان App را فقط در `WHATSAPP_APP_SECRET` سرور ثبت کنید؛ امضای `X-Hub-Signature-256` روی raw body بررسی می‌شود.
13. فیلد `messages` را برای WABA subscribe کنید و verify شدن callback را در Meta تأیید کنید.
14. Templateهای لازم را در WhatsApp Manager بسازید و تا وضعیت تأیید رسمی صبر کنید؛ پیشنهاد AI به‌تنهایی تأیید محسوب نمی‌شود.
15. پیش از تغییر دیتابیس، migration 023 و فایل rollback-only آن را بازبینی کنید. روش پیشنهادی فقط پس از مجوز جداگانه: ابتدا `npx supabase migration list --linked` و `npx supabase db push --dry-run --linked`، سپس در پنجره انتشار مجاز `npx supabase db push --linked`. این PR هیچ‌کدام را اجرا نمی‌کند.
16. پس از اعمال مجاز migration و ثبت متغیرها، Vercel را redeploy کنید تا متغیرهای server-only وارد runtime شوند.
17. با یک کاربر واردشده `GET /api/whatsapp/health` را اجرا کنید؛ خروجی فقط Booleanهای آمادگی schema، Cloud API، Webhook و Graph version است و پیامی ارسال نمی‌کند.
18. اولین آزمایش واقعی را فقط پس از تأیید جداگانه، با شماره شخصی مالک، رضایت ثبت‌شده و یک `client_request_id` جدید انجام دهید.
19. تاریخچه را بررسی کنید: `accepted` فقط پذیرش درخواست است؛ سپس وبهوک باید `sent`، `delivered` و `read` را بدون عقب‌گرد ثبت کند. `provider_result_unknown` یعنی نتیجه قطعی نیست و نباید خودکار دوباره ارسال شود.
20. برای توقف اضطراری ارسال، متغیر token یا Phone Number ID را از runtime حذف و redeploy کنید، سپس تنظیمات webhook/App را در Meta بررسی کنید. حذف داده، غیرفعال‌کردن RLS یا retry انبوه راه توقف اضطراری نیست.

ارسال متن یا تصویر آزاد فقط داخل پنجره مکالمه ۲۴ ساعته مجاز است و کاربر باید بازبودن پنجره را صریحاً تأیید کند. بیرون این پنجره فقط Template تأییدشده Meta قابل استفاده است. نام و متغیر Template پیشنهادی AI صرفاً پیش‌نویس است؛ Template باید ابتدا در WhatsApp Manager تأیید شده باشد. قبل از هر ارسال واقعی نیز رضایت مشتری، منبع و زمان رضایت ثبت می‌شود و انصراف مشتری ارسال را متوقف می‌کند.

وضعیت `accepted` فقط یعنی Meta درخواست را پذیرفته است و معادل تحویل نیست. وبهوک وضعیت‌های `sent`، `delivered`، `read` و `failed` را ثبت می‌کند. رویدادهای تکراری idempotent هستند و شماره کامل مشتری یا payload پیام در log نوشته نمی‌شود.

اگر schema واتساپ هنوز آماده نباشد، تولید هر ۹ نوع محتوا، ویرایش، کپی نسخه‌ها، ساخت/دانلود تصویر و آماده‌سازی دستی استاتوس فعال می‌ماند. ثبت رضایت، تاریخچه و ارسال Cloud API تا اعمال migration غیرفعال‌اند. لینک `wa.me` فقط وقتی شماره معتبر و رضایت ثبت‌شده در دسترس باشد فعال می‌شود و بازشدن آن هرگز به‌عنوان ارسال ثبت نمی‌شود.

پردازش هر status وبهوک در RPC اتمیک انجام می‌شود: ردیف پیام قفل می‌شود، event به‌شکل idempotent ثبت می‌شود و transition در همان transaction اعمال می‌شود. duplicate معتبر 2xx می‌گیرد؛ شکست دیتابیس 5xx برمی‌گرداند تا Meta retry کند. وضعیت‌های `delivered` و `read` به `failed` عقب‌گرد نمی‌کنند و timestamp معتبر قبلی حفظ می‌شود.

زیرساخت دیتابیس در migration افزایشی `023_whatsapp_content_studio.sql` قرار دارد. این migration باید جداگانه بازبینی و در فرایند مجاز انتشار اعمال شود؛ اجرای build یا test آن را روی هیچ دیتابیس Remote اعمال نمی‌کند.

### تست بدون ارسال واقعی

```powershell
npm ci
npm test
npm run lint
npm run build
```

تمام درخواست‌های Meta و OpenAI در تست‌ها mock هستند. تست‌ها هیچ پیام واقعی ارسال نمی‌کنند و به دیتابیس Production متصل نمی‌شوند.
