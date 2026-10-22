import {
  sqliteTable,
  integer as intCol,
  real as realCol,
  text as textCol,
  unique as uniqueReal,
} from "drizzle-orm/sqlite-core";
import { eq as eqReal, and as andReal, sql as sqlReal } from "drizzle-orm";

export const table = sqliteTable;
export const integer = (name) => intCol(name);
export const text = (name) => textCol(name);
export const real = (name) => realCol(name);
export const boolean = (name) => intCol(name, { mode: "boolean" });
export const json = (name) => textCol(name, { mode: "json" });
export const unique = uniqueReal;
export const sql = sqlReal;
export const eq = eqReal;
export const and = andReal;
