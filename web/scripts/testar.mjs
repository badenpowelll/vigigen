// Roda os testes do painel (web/tests/*.test.ts) sem dependência nova:
// o esbuild que já vem com o Vite empacota cada teste e o node:test executa.
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dir = new URL("../tests/", import.meta.url).pathname;
const saida = new URL("../node_modules/.cache/testes/", import.meta.url).pathname;
mkdirSync(saida, { recursive: true });
const arquivos = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
const gerados = [];
for (const f of arquivos) {
  const out = join(saida, f.replace(/\.ts$/, ".mjs"));
  await build({ entryPoints: [join(dir, f)], outfile: out, bundle: true, platform: "node", format: "esm",
    external: ["xlsx", "jspdf", "jspdf-autotable"], logLevel: "warning" });
  gerados.push(out);
}
const r = spawnSync(process.execPath, ["--test", ...gerados], { stdio: "inherit" });
process.exit(r.status ?? 1);
