import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// O painel web (público na internet, com login) NÃO pode levar o retrato
// embutido: o arquivo JS é baixado antes do login e qualquer um leria os dados.
// Neste modo, retrato.json vira `null` e o painel só mostra o que o banco
// devolver para a sessão autenticada (RLS por território).
function semRetrato(): Plugin {
  return {
    name: "vigigen-sem-retrato",
    enforce: "pre",
    load(id) {
      if (id.split("?")[0].endsWith("/src/dados/retrato.json")) return "null"; // JSON válido: o plugin de JSON do Vite o exporta como `default`
      return null;
    },
  };
}

// `npm run build` gera o painel web normal (dist/), sem retrato.
// `npm run build:artefato` gera um único index.html autocontido (dist-artefato/),
// usado como Artifact no claude.ai (sem acesso de rede próprio: lê o banco pelo
// conector Supabase do visitante, ou mostra o retrato embutido).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "artefato" ? [viteSingleFile()] : [semRetrato()])],
  base: "./",
  build: {
    outDir: mode === "artefato" ? "dist-artefato" : "dist",
    assetsInlineLimit: mode === "artefato" ? 100_000_000 : 4096,
  },
}));
