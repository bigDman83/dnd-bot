import { fetch } from 'sdk';

// نکته: فیلتر مستقیم بر اساس کلاس در Open5e v2 برام تایید نشده (فقط سطح/مکتب تاییدشده)،
// پس فعلاً بر اساس سطح می‌گیریم و از بین همون‌ها انتخاب می‌کنیم — قابل تصحیح در آینده
export async function fetchSpellOptions(level, limit = 10) {
  const base = 'https://api.open5e.com/v2/spells/';
  let res = await fetch(`${base}?level=${level}&document__key__in=srd-2024&limit=${limit}`);
  let data = res.ok ? await res.json() : { results: [] };

  if (!data.results || data.results.length === 0) {
    res = await fetch(`${base}?level=${level}&limit=${limit}`);
    if (!res.ok) throw new Error(`Open5e HTTP ${res.status}`);
    data = await res.json();
  }

  return (data.results || []).map((s) => ({
    name: s.name,
    school: (s.school && s.school.name) || s.school || '',
    desc: (s.desc || '').slice(0, 150),
  }));
}
