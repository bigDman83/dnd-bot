// اجرا از پوشه‌ی پروژه:  node local-test-v05/run_all.mjs
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// روی ویندوز --import باید URL از نوع file:// باشه (نه مسیر C:\...)
const registerUrl = pathToFileURL(path.join(here, "register.mjs")).href;
const files = readdirSync(here).filter((f) => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--import", registerUrl, path.join(here, f)], { encoding: "utf8", env: process.env });
  const out = `${r.stdout}${r.stderr}`;
  const passed = (out.match(/✅/g) || []).length;
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${f}: ${passed} تست پاس${ok ? "" : "\n" + out.split("\n").filter((l) => !l.startsWith("📊")).slice(0, 25).join("\n")}`);
}
console.log(failed ? `\n❌ ${failed} فایل شکست خورد` : "\n✅ همه‌ی فایل‌های تست پاس شد");
process.exit(failed ? 1 : 0);
