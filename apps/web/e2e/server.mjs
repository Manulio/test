// Prepara la base y levanta la app para las e2e: `next build && next start` sobre una copia en e2e/.app,
// así su .next no pisa el de un `next dev` que esté corriendo en apps/web.
//
// La base se prepara acá y no en un globalSetup: Playwright espera a que el webServer responda antes de
// correr el globalSetup, y con la base vacía (como en CI) la portada da 500 y la espera nunca termina.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(web, "e2e/.app");
const next = path.join(web, "node_modules/.bin/next");
const port = process.env.PORT ?? "3100";
const tsx = path.join(web, "node_modules/.bin/tsx");

/** Deja la base de test con las migraciones y los datos de demo (más algo de historial de precios). */
function prepareDatabase() {
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: web, stdio: "inherit" });
  run("pnpm", ["--filter", "@precios/db", "migrate"]);
  run(tsx, ["e2e/db.mts", "reset"]);
  run("pnpm", ["--filter", "@precios/db", "seed"]);
  run(tsx, ["e2e/db.mts", "history"]);
}

prepareDatabase();

mkdirSync(app, { recursive: true });
rmSync(path.join(app, "src"), { recursive: true, force: true });
for (const f of ["src", "public", "package.json", "tsconfig.json", "postcss.config.mjs"]) {
  cpSync(path.join(web, f), path.join(app, f), { recursive: true });
}
// Misma config que la app, pero sin `standalone` (next start no lo usa).
writeFileSync(
  path.join(app, "next.config.ts"),
  `import base from "../../next.config";\nexport default { ...base, output: undefined };\n`,
);

execFileSync(next, ["build"], { cwd: app, stdio: "inherit" });
const server = spawn(next, ["start", "-p", port], { cwd: app, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
