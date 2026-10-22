// کمکی‌های کوچکی که چند فایل بهشون نیاز دارن

// شماره‌ی ۱-مبنا → اندیس ۰-مبنا؛ اگه نامعتبر بود -1
export function toIndex(value, max) {
  if (typeof value !== "number" && typeof value !== "string") return -1;
  if (typeof value === "string" && value.trim() === "") return -1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n - 1 : -1;
}

// اولین بلوک JSON داخل خروجی AI رو درمیاره (AI گاهی دور JSON متن اضافه می‌نویسه)
export function parseJson(raw) {
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON پیدا نشد");
  return JSON.parse(match[0]);
}

// " + برچسب عدد" یا " − برچسب عدد" برای خط تاس؛ اگه عدد صفر بود چیزی نمی‌نویسه
export function signedPart(label, value) {
  if (!value) return "";
  return value > 0 ? ` + ${label} ${value}` : ` − ${label} ${Math.abs(value)}`;
}