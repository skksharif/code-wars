import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/db";
import { DbError } from "../src/errors";

/**
 * Test-only Db that runs against in-process Postgres, so Worker routes can be
 * exercised against the real migrations and functions. It understands the
 * small subset of the REST query syntax the Worker uses: `col=eq.value` filters
 * a `select=` column list and `order=col.asc`.
 */
export function createPgliteDb(pg: PGlite): Db {
  const fail = (error: unknown): never => {
    const e = error as { message?: string; detail?: string };
    throw new DbError(e.message ?? "database error", e.detail);
  };

  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      if (!/^[a-z_]+$/.test(fn)) throw new Error(`Bad function name ${fn}`);
      const names = Object.keys(args);
      const list = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
      try {
        const result = await pg.query<{ r: T }>(
          `select public.${fn}(${list}) as r`,
          names.map((name) => args[name]),
        );
        return result.rows[0]!.r;
      } catch (error) {
        return fail(error);
      }
    },

    async select<T>(table: string, query: string): Promise<T[]> {
      if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name ${table}`);
      const params = new URLSearchParams(query);
      const columns = params.get("select") ?? "*";
      if (!/^[a-z_,*]+$/.test(columns)) throw new Error(`Unsupported select ${columns}`);
      const where: string[] = [];
      const values: unknown[] = [];
      let orderBy = "";
      for (const [key, value] of params) {
        if (key === "select") continue;
        if (key === "order") {
          const order = /^([a-z_]+)\.(asc|desc)$/.exec(value);
          if (!order) throw new Error(`Unsupported order ${value}`);
          orderBy = ` order by ${order[1]} ${order[2]}`;
          continue;
        }
        if (!/^[a-z_]+$/.test(key) || !value.startsWith("eq.")) {
          throw new Error(`Unsupported filter ${key}=${value}`);
        }
        values.push(value.slice(3));
        where.push(`${key}::text = $${values.length}`);
      }
      try {
        const sql = `select ${columns} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy}`;
        return (await pg.query<T>(sql, values)).rows;
      } catch (error) {
        return fail(error);
      }
    },
  };
}
