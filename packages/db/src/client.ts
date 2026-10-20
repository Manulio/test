import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("Falta DATABASE_URL");
  // idle_timeout: las conexiones sin uso se cierran solas (en segundos), para no agotar las de Postgres.
  const client = postgres(url, { max: 5, prepare: false, idle_timeout: 30 });
  return drizzle(client, { schema });
}

/** Una conexión o una transacción abierta: las dos sirven para consultar. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// En globalThis y no en una variable del módulo: en desarrollo, Next vuelve a evaluar el módulo en cada
// recarga en caliente y cada vez abría un pool nuevo sin cerrar el anterior, hasta agotar las conexiones.
const holder = globalThis as typeof globalThis & { __preciosDb?: Db };

/** Conexión compartida para el servidor web (se reutiliza entre requests y recargas). */
export function getDb(): Db {
  holder.__preciosDb ??= createDb();
  return holder.__preciosDb;
}
