// تست محلی بدون اینترنت و بدون drizzle: importهای «sdk» و «sdk/db» با دیتابیس جعلی عوض میشن
// و بقیه‌ی کد (schema.js، lib/*، handlers/*) همون کد واقعی پروژه‌ست.
// ریشه‌ی پروژه: متغیر DND_SRC، وگرنه پوشه‌ی جاری (همون که package.json توشه).
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.env.DND_SRC || process.cwd());
const fileUrl = (p) => pathToFileURL(p).href;

export async function resolve(spec, ctx, next) {
  if (spec === "sdk") return { url: fileUrl(path.join(HERE, "fake_sdk.mjs")), shortCircuit: true };
  if (spec === "sdk/db") return { url: fileUrl(path.join(HERE, "fake_dbfns.mjs")), shortCircuit: true };
  if (spec === "schema") return { url: fileUrl(path.join(SRC, "schema.js")), shortCircuit: true };
  if (spec.startsWith("lib/") || spec.startsWith("handlers/")) {
    return { url: fileUrl(path.join(SRC, `${spec}.js`)), shortCircuit: true };
  }
  return next(spec, ctx);
}
