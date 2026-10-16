import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` gera o painel web normal (dist/).
// `npm run build:artefato` gera um único index.html autocontido (dist-artefato/),
// usado como Artifact no claude.ai (sem acesso de rede próprio: lê o banco pelo
// conector Supabase do visitante, ou mostra o retrato embutido).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "artefato" ? [viteSingleFile()] : [])],
  base: "./",
  build: {
    outDir: mode === "artefato" ? "dist-artefato" : "dist",
    assetsInlineLimit: mode === "artefato" ? 100_000_000 : 4096,
  },
}));
