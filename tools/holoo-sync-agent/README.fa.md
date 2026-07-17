# عامل همگام‌سازی فقط‌خواندنی هلو برای ویندوز

این ابزار اطلاعات مشتریان، ماندهٔ حساب و فاکتورهای فروش هلو را از SQL Server محلی می‌خواند و به گیرندهٔ امن OmidMed می‌فرستد. کد Agent هیچ دستور نوشتنی روی دیتابیس هلو اجرا نمی‌کند.

## رفتار امنیتی

- اتصال پیش‌فرض به `localhost\TNC` و دیتابیس `Holoo1` با Windows Integrated Security است.
- همهٔ queryها باید با `SELECT` شروع شوند. guard داخلی statement چندگانه، comment و هر command غیر SELECT را رد می‌کند.
- connection string با `ApplicationIntent=ReadOnly` ساخته می‌شود.
- بهتر است حساب ویندوز اجراکننده در SQL Server فقط مجوز `SELECT` داشته باشد. Agent هیچ کاربر یا مجوزی در هلو ایجاد یا تغییر نمی‌دهد.
- `HOLO_SYNC_AGENT_SECRET` با DPAPI و در scope کاربر نصب‌کننده ذخیره می‌شود و فقط همان کاربر، `SYSTEM` و Administrators به فایل دسترسی دارند.
- Secret داخل config، command line، Git یا log نوشته نمی‌شود.
- payload و نام، تلفن، آدرس یا اطلاعات واقعی مشتریان در log نوشته نمی‌شود؛ log فقط metadata source، تعدادها، وضعیت batch و خطاهای کنترل‌شده را نگه می‌دارد.
- فایل‌های `config.json`، state، log، فایل‌های `*.dpapi` و پوشهٔ runtime در `.gitignore` قرار دارند.

## کشف خودکار ساختار هلو

Agent در هر اجرا metadata را فقط از `sys.objects`، `sys.schemas` و `sys.columns` می‌خواند و table/view مناسب را بر اساس ستون‌های واقعی انتخاب می‌کند. نام‌های رایج و ساختار تأییدشدهٔ این نصب عبارت‌اند از:

- مشتری و مانده: `dbo.W_Calc_Mandeh_Customer` با `C_Code`، `C_Name`، `Mandeh` و `Type_Mandeh`
- سربرگ فاکتور: `dbo.FACTURE`
- اقلام: `dbo.FACTART`
- کالا: `dbo.ARTICLE`

اگر یک نام رایج وجود نداشته باشد، Agent بین tableها و viewها به‌دنبال مجموعه ستون‌های لازم می‌گردد. اگر mapping امن و کامل پیدا نشود، اجرا fail می‌شود و هیچ payloadی ارسال نمی‌گردد.

فقط ردیف‌هایی که `Fac_Type = 'F'` دارند به‌عنوان فروش خوانده می‌شوند. مقدار `Type_Mandeh=1` بدهکار، `Type_Mandeh=-1` بستانکار و ماندهٔ صفر `zero` است.

## قرارداد API

Endpoint:

```text
https://omidmed-sales-assistant.vercel.app/api/holo-agent/sync
```

Headerها:

```text
Authorization: Bearer <DPAPI protected secret>
Content-Type: application/json
```

ساختار top-level هر batch:

```json
{
  "runId": "holoo-HOST-...",
  "mode": "initial | incremental | weekly_full | manual_full",
  "batchType": "customers | invoices | finish",
  "sourceServer": "localhost\\TNC",
  "sourceDatabase": "Holoo1",
  "final": false,
  "customers": [],
  "invoices": []
}
```

هر batch مشتری حداکثر ۱۵۰ رکورد و هر batch فاکتور حداکثر ۲۵ فاکتور دارد. برای رعایت سقف ۲٫۵ مگابایتی receiver، Agent batch را در صورت نیاز کوچک‌تر می‌کند و به‌طور پیش‌فرض body را زیر ۲٬۲۵۰٬۰۰۰ بایت نگه می‌دارد. batch پایانی `batchType=finish` و `final=true` است.

Customer:

```json
{
  "code": "00001",
  "name": "...",
  "contactName": null,
  "mobile": null,
  "telephone": null,
  "province": null,
  "city": null,
  "address": null,
  "balanceAmount": 0,
  "balanceStatus": "debtor | creditor | zero | unknown",
  "sourceUpdatedAt": "ISO-8601 or null"
}
```

Invoice:

```json
{
  "facCode": "000001",
  "facType": "F",
  "invoiceNumber": "1",
  "documentNumber": null,
  "customerCode": "00001",
  "customerName": null,
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": null,
  "creationDate": "ISO-8601 or null",
  "totalQuantity": 0,
  "totalAmount": 0,
  "cashAmount": 0,
  "checkAmount": 0,
  "cardAmount": 0,
  "creditAmount": 0,
  "discountAmount": 0,
  "isDeleted": false,
  "items": [
    {
      "rowNumber": 1,
      "productName": "...",
      "quantity": 0,
      "unitPrice": 0,
      "lineTotal": 0,
      "description": null,
      "articleCode": "...",
      "articleIndex": 1,
      "buyPrice": 0,
      "discountAmount": 0,
      "levyAmount": 0,
      "taxAmount": 0
    }
  ]
}
```

## حالت‌های اجرا

- `initial`: خواندن کامل برای اولین همگام‌سازی. اگر Scheduled Task افزایشی بدون state موفق قبلی اجرا شود، به‌صورت خودکار به این حالت ارتقا می‌یابد.
- `incremental`: خواندن از watermark قبلی با overlap پیش‌فرض ۱۵ دقیقه. overlap همراه upsert مقصد مانع از دست‌رفتن رکوردهای هم‌زمان می‌شود.
- `weekly_full`: بازخوانی کامل هفتگی برای پوشش تغییرها یا حذف‌هایی که timestamp قابل اتکا ندارند.
- `manual_full`: بازخوانی کامل با درخواست اپراتور.
- `dry_run`: اتصال، کشف metadata و خواندن/اعتبارسنجی کامل را انجام می‌دهد، اما API را صدا نمی‌زند و state را جلو نمی‌برد.

مقصد مشتری را با کد هلو و در شرایط محدود با تلفن نرمال‌شده upsert می‌کند. فاکتور با `(Fac_Type, Fac_Code)` upsert می‌شود و اقلام همان فاکتور جایگزین می‌شوند؛ بنابراین تکرار یک run دادهٔ تکراری ایجاد نمی‌کند. Agent یک `runId` pending را تا موفقیت کامل نگه می‌دارد تا retry پس از قطع اجرا همان run را ادامه دهد.

## Dry Run اولیه

این مرحله Secret یا Administrator نمی‌خواهد و باید قبل از نصب/Sync واقعی اجرا شود:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd tools\holoo-sync-agent
.\Invoke-HolooSync.ps1 -Mode dry_run -ConfigPath .\config.example.json
```

فقط تست سریع اتصال و metadata:

```powershell
.\Test-HolooSyncConnection.ps1 -ConfigPath .\config.example.json
```

## نصب

Windows PowerShell را با **Run as administrator** باز کنید. Installer هنگام نیاز Secret را دو بار با SecureString می‌گیرد؛ مقدار واردشده نمایش داده یا log نمی‌شود.

```powershell
cd tools\holoo-sync-agent
.\Install-HolooSyncAgent.ps1
```

Installer این کارها را انجام می‌دهد:

1. فایل‌ها را در `%ProgramData%\OmidMed\HolooSyncAgent` کپی می‌کند.
2. config محلی و پوشهٔ data با ACL محدود می‌سازد.
3. Secret را با DPAPI کاربر جاری ذخیره می‌کند.
4. اتصال SQL، metadata و احراز هویت GET در API را تست می‌کند؛ Sync واقعی انجام نمی‌دهد.
5. دو Scheduled Task با همان کاربر نصب‌کننده می‌سازد:
   - `OmidMed Holoo Incremental Sync`: هر دو ساعت
   - `OmidMed Holoo Weekly Full Sync`: یکشنبه ساعت ۰۳:۰۰ محلی

Scheduled Taskها با `MultipleInstances=IgnoreNew` ساخته می‌شوند و mutex سراسری Agent نیز از اجرای هم‌زمان دستی/زمان‌بندی‌شده جلوگیری می‌کند.

## اولین Sync واقعی

تنها بعد از تأیید اپراتور اجرا شود:

```powershell
& "$env:ProgramData\OmidMed\HolooSyncAgent\Invoke-HolooSync.ps1" `
  -Mode initial `
  -ConfigPath "$env:ProgramData\OmidMed\HolooSyncAgent\config.json"
```

بعد از موفقیت، صفحهٔ زیر باید آخرین run و تعدادهای پردازش‌شده را نشان دهد:

```text
https://omidmed-sales-assistant.vercel.app/settings/holo-sync
```

## State، retry و timeout

- state با write اتمیک در `data\state.json` ذخیره می‌شود.
- retry پیش‌فرض ۵ تلاش با backoff نمایی ۲ تا ۳۰ ثانیه است.
- timeout اتصال SQL برابر ۱۵ ثانیه، query برابر ۱۲۰ ثانیه و API برابر ۶۰ ثانیه است.
- log روزانه است و به‌طور پیش‌فرض ۳۰ روز نگه داشته می‌شود.
- اگر اجرا وسط ارسال قطع شود، `pendingRunId` حفظ و در اجرای بعدی همان mode استفاده می‌شود.

## حذف نصب

عملیات زیر مخرب است، Administrator می‌خواهد و قبل از حذف تأیید متنی `UNINSTALL` می‌گیرد:

```powershell
& "$env:ProgramData\OmidMed\HolooSyncAgent\Uninstall-HolooSyncAgent.ps1"
```

برای نگه‌داشتن DPAPI secret، state و logها:

```powershell
& "$env:ProgramData\OmidMed\HolooSyncAgent\Uninstall-HolooSyncAgent.ps1" -KeepData
```
