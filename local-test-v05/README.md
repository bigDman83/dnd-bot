# تست‌های محلی V05 (ردگیری، /trace، /why، /replay)

بدون اینترنت و بدون دیتابیس واقعی اجرا میشن؛ کد واقعی پروژه (`schema.js`، `lib/*`، `handlers/*`) با یک sdk/دیتابیس جعلی تست میشه.

## اجرا (PowerShell، داخل پوشه‌ی داخلی پروژه که package.json توشه)
```
node local-test-v05\run_all.mjs
```
یا یک فایل:
```
node --import .\local-test-v05\register.mjs .\local-test-v05\3_replay.test.js
```
پوشه‌ی `local-test-v05` رو کنار `package.json` بذار. اگه جای دیگه‌ست: `$env:DND_SRC = "مسیر پوشه‌ی پروژه"`.

## چی رو می‌سنجن
- `1_trace_debug.test.js` — `/trace`، `/debug`، ثبت spanها، حلقوی ۵۰ دور، سقف تلاش و span، debug
- `2_why.test.js` — `/why` برای scene، تاس، سفر، استراحت
- `3_replay.test.js` — `/replay` (۹ «جهش عمدی» که هرکدوم باید ⚠️ بدن) و `computeClock` در برابر فرمول قدیمی
- `4_startgame_clears_trace.test.js` — پاک‌شدن trace با `/startgame`

## نکته
تست‌ها به ساختار فعلی `schema.js` (از جمله `traceRing`) و نام‌های export شده‌ی `lib/*` وابسته‌ان؛ اگه کدی که تست می‌کنه عوض شد و تست شکست خورد، اول ببین تغییر عمدی بوده یا نه.
