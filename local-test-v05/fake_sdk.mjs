const raw = {};
export const tables = new Proxy(raw, { get: (o, k) => (o[k] ||= []), set: (o, k, v) => ((o[k] = v), true) });
export const sent = [];
export const api = { sendMessage: async (p) => sent.push(p) };
export const fetch = async () => { throw new Error("fetch not available in test"); };
export let failWrites = false; export const setFail = (v) => (failWrites = v);
const clone = (x) => JSON.parse(JSON.stringify(x));
let seq = 0;
const stamp = (t, row) => { row.__seq = ++seq; return row; };
export const db = {
  select: () => ({ from: (t) => ({
    where: (c) => ({
      get: async () => { const r = tables[t.__t].find(c.pred); return r ? clone(r) : undefined; },
      all: async () => tables[t.__t].filter(c.pred).map(clone),
    }),
    orderBy: () => ({ limit: () => ({ get: async () => { const rows = [...tables[t.__t]].sort((a, b) => (b.__seq || 0) - (a.__seq || 0)); return rows[0] ? clone(rows[0]) : undefined; } }) }),
  }) }),
  insert: (t) => ({ values: (v) => {
    const ins = () => { if (failWrites && t.__t === "trace_ring") throw new Error("boom"); tables[t.__t].push(stamp(t, clone(v))); };
    return { run: async () => ins(), onConflictDoUpdate: ({ target, set }) => ({ run: async () => {
      const row = tables[t.__t].find((r) => r[target.name] === v[target.name]);
      if (row) Object.assign(row, set); else ins(); } }) };
  } }),
  update: (t) => ({ set: (s) => ({ where: (c) => ({ run: async () => { tables[t.__t].filter(c.pred).forEach((r) => { for (const k in s) if (!s[k]?.sqlTag) r[k] = clone(s[k]); stamp(t, r); }); } }) }) }),
  delete: (t) => ({ where: (c) => ({ run: async () => { tables[t.__t] = tables[t.__t].filter((r) => !c.pred(r)); } }) }),
};
