import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("Falta DATABASE_URL");
  const client = postgres(url, { max: 5, prepare: false });
  return drizzle(client, { schema });
}

/** Una conexión o una transacción abierta: las dos sirven para consultar. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

let shared: Db | undefined;

/** Conexión compartida para el servidor web (se reutiliza entre requests). */
export function getDb(): Db {
  shared ??= createDb();
  return shared;
}
