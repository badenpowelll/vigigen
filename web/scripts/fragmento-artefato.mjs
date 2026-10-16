// Converte dist-artefato/index.html num fragmento para o Artifact do claude.ai,
// que já envolve a página em <!doctype><html><head><body> com charset e viewport.
import { readFileSync, writeFileSync } from "node:fs";
let h = readFileSync("dist-artefato/index.html", "utf8");
h = h
  .replace(/<!doctype html>/i, "")
  .replace(/<\/?html[^>]*>/gi, "")
  .replace(/<\/?head>/gi, "")
  .replace(/<\/?body[^>]*>/gi, "")
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  .replace(/<link rel="apple-touch-icon"[^>]*>/i, "")
  .trim();
writeFileSync("dist-artefato/vigigen.html", h + "\n");
console.log("dist-artefato/vigigen.html", h.length, "bytes");
