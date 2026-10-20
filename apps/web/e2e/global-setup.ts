import { execFileSync } from "node:child_process";
import path from "node:path";

const web = path.resolve(__dirname, "..");

/** Deja la base de test con las migraciones y los datos de demo (más algo de historial de precios). */
export default function globalSetup() {
  const url = process.env.DATABASE_URL!;
  const env = { ...process.env, DATABASE_URL: url };
  const run = (cmd: string, args: string[], cwd = web) => execFileSync(cmd, args, { cwd, env, stdio: "inherit" });
  const tsx = path.join(web, "node_modules/.bin/tsx");

  run("pnpm", ["--filter", "@precios/db", "migrate"]);
  run(tsx, ["e2e/db.mts", "reset"]);
  run("pnpm", ["--filter", "@precios/db", "seed"]);
  run(tsx, ["e2e/db.mts", "history"]);
}
