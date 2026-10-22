import { DEGREES } from "lib/core/degrees";

// Group Check (طراحی V07، بخش 11): همه‌ی اعضا جدا تاس می‌ریزن؛
// موفقیت گروه = حداقل نصف اعضا موفق شده باشن. تابع خالص.
// نتیجه‌ی هر عضو: margin >= 0 یعنی موفق.

function degreeByKey(key) {
  return DEGREES.find((d) => d.key === key) || DEGREES[0];
}

// results: خروجی rollChecks (هر کدوم ممکنه groupId داشته باشه)
export function summarizeGroups(results) {
  const byId = new Map();
  for (const r of results || []) {
    if (!r.groupId) continue;
    if (!byId.has(r.groupId)) byId.set(r.groupId, []);
    byId.get(r.groupId).push(r);
  }
  const out = [];
  for (const [id, members] of byId) {
    const total = members.length;
    const successes = members.filter((m) => m.margin >= 0).length;
    const success = successes * 2 >= total;
    const key = success ? "success" : successes > 0 ? "fail" : "critFail";
    const degree = degreeByKey(key);
    out.push({
      id,
      skill: members[0].skill,
      members: members.map((m) => m.name),
      reason: members[0].reason || "",
      total,
      successes,
      success,
      degree,
      label: degree.label,
      hint: degree.hint,
    });
  }
  return out;
}
