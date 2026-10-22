# دیپلوی dnd-bot روی Cloudflare Workers

## ⚠️ اگه قبلاً یه‌بار دیپلوی کردی (آپدیت، نه نصب تازه)

این نسخه ۹ تا ویژگی جدید داره (`/help`، کارنامه، انتخاب تعداد بازیکن، شروع خودکار ماجراجویی و...) و ۳ تا ستون جدید به دیتابیس اضافه شده. **این‌ها رو انجام بده:**

1. فایل‌های جدید رو جایگزین قبلی‌ها کن (`schema.js`, `handlers/`, `lib/`, `drizzle-migrations/0001_...sql`, `package.json`)
2. **فوراً** توی `handlers/message.js` مقدار `OWNER_TG_ID` رو دوباره با آیدی خودت پر کن (چون این فایل جایگزین شده و مقدارش برگشته به ۰)
3. migration جدید رو (نه اون قبلی، فقط این یکی) روی دیتابیس زنده‌ت اجرا کن:
   ```bash
   npm run db:apply:update:remote
   ```
4. دوباره دیپلوی کن:
   ```bash
   npm run deploy
   ```
همین — نیازی به `d1 create` یا `setWebhook` دوباره نیست، چون دیتابیس و آدرس Worker عوض نشدن.

---

## نصب تازه (اگه اولین‌باره)

این پکیج همون منطق فاز ۱ تا ۵ رو داره (بدون هیچ تغییری در schema.js / handlers / lib) —
فقط لایه‌ی `sdk` با یه نسخه‌ی واقعی (Drizzle + D1 + تلگرام واقعی) جایگزین شده.

## قدم‌به‌قدم

### ۱. نصب ابزارها
```bash
cd cloudflare-deploy
npm install
npx wrangler login
```
(مرورگر باز میشه، با اکانت Cloudflare‌ت لاگین کن — رایگانه، بدون لیست انتظار)

### ۲. ساخت دیتابیس D1
```bash
npx wrangler d1 create dnd-bot-db
```
خروجی یه چیزی شبیه این می‌ده:
```
[[d1_databases]]
binding = "DB"
database_name = "dnd-bot-db"
database_id = "xxxxxxxx-xxxx-...."
```
این `database_id` رو کپی کن و توی `wrangler.toml` به‌جای `PLACEHOLDER` بذار.

### ۳. اعمال جدول‌ها روی دیتابیس واقعی
```bash
npm run db:apply:remote
```

### ۴. تنظیم توکن بات (به‌عنوان secret، نه متن ساده)
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
(توکن رو که از BotFather گرفتی پیست کن)

### ۵. دیپلوی
```bash
npm run deploy
```
خروجی یه URL می‌ده شبیه:
```
https://dnd-bot.<your-subdomain>.workers.dev
```

### ۶. ثبت Webhook (این یه‌باره)
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://dnd-bot.<your-subdomain>.workers.dev"
```

### ۷. تست
توی تلگرام برو به گروه‌ت (یا بسازش)، ربات رو اضافه کن، بزن `/startgame`.

---

## نکات مهم

- **`OWNER_TG_ID`** توی `handlers/message.js` رو با آیدی عددی خودت (از @userinfobot) پر کن — همون کاری که برای Telegram Serverless هم لازم بود.
- **کلیدهای OpenRouter/Groq**: بعد از دیپلوی، توی چت خصوصی با ربات بزن `/setkey openrouter sk-or-...` و `/setkey groq gsk_...` (دقیقاً همون مکانیزم قبلی — چون Cloudflare هم مثل Telegram Serverless یه Secrets Vault برای کلیدهای شخص‌ثالث نداره، فقط برای متغیرهای *خودِ* Worker مثل TELEGRAM_BOT_TOKEN داره).
- **لاگ‌ها**: `npx wrangler tail` رو بزن تا لاگ‌های زنده‌ی Worker رو ببینی (خیلی به‌دردت می‌خوره برای دیباگ).
- اگه بعداً خواستی schema.js رو عوض کنی: `npm run db:generate` یه migration جدید می‌سازه، بعد `npm run db:apply:remote`.

## اگه Telegram Serverless دسترسیش اومد

می‌تونی هردو رو موازی نگه داری — چون `schema.js`، `handlers/`، و `lib/` **کاملاً مشترکن**. فقط باید یه بار دیگه `/شروع_بازی` رو توی گروه بزنی که به دیتابیس مربوطه وصل بشه (دو تا دیتابیس جدا خواهند بود، پس داده‌ها sync نمیشن — ولی کد دقیقاً همونه).

## چیزهای جدید در این نسخه

- `/help` — لیست کامل دستورها
- `/کارنامه` (توی چت خصوصی) — هر وقت خواستی، شیت کامل شخصیتت رو با اینونتوری/اسپل/توضیحات ببین
- `/startgame` حالا اول می‌پرسه چند نفر بازی می‌کنن؛ وقتی همون تعداد آماده و صاحب شخصیت شدن، ماجراجویی **خودکار** شروع میشه — دیگه لازم نیست دستی `/بساز_دنیا` بزنی (هنوز می‌تونی از قبل تم دلخواه بدی)
- صحنه‌ی افتتاحیه شخصیت‌ها رو به هم وصل می‌کنه و ۳ پیشنهاد + دکمه‌ی Skip میده
- قرارداد نوشتاری: دیالوگ داخل `()`، اکشن داخل `[]`
- مهارت‌ها و اسپل‌ها موقع انتخاب توضیح فارسی دارن

