const chain = () => new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : chain()), apply: () => chain() });
export const integer = chain(), real = chain(), text = chain(), boolean = chain(), json = chain(), unique = chain();
export const table = (name, cols, extra) => {
  const t = { __t: name };
  for (const k of Object.keys(cols)) t[k] = { t: name, name: k };
  if (extra) { try { extra(t); } catch {} }
  return t;
};
export const eq = (col, val) => ({ pred: (r) => r[col.name] === val });
export const and = (...cs) => ({ pred: (r) => cs.every((c) => c.pred(r)) });
export const sql = (strings, ...vals) => ({ sqlTag: true, pred: (r) => r[vals[0].name] <= vals[1] });
