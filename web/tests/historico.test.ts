import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDia, linhasDaSerie, resumoHistorico } from "../src/componentes/HistoricoMunicipio";
import type { Serie } from "../src/dados/tipos";

test("data da semana não volta um dia pelo fuso", () => {
  assert.equal(fmtDia("2026-10-18"), "18/10/2026");
  assert.equal(fmtDia("2026-10-18", 6), "24/10/2026");
  assert.equal(fmtDia("2025-12-28", 6), "03/01/2026");
});

test("resumo: semanas com caso, pico e última semana com caso", () => {
  // Série de teste montada à mão (não é dado do RN).
  const s: Serie = { geocodigo: 1, doenca: "dengue", se: [202601, 202602, 202603, 202604], dt: ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"],
    c: [0, 5, 2, null], ce: [0, 6, 3, null], i: [0, 1, 0.4, null], nv: [1, 2, 1, null], rt: [null, 1.2, 0.8, null], n_mun: [1, 1, 1, 1] };
  const r = resumoHistorico(linhasDaSerie(s));
  assert.equal(r.comCaso, 2); assert.equal(r.total, 7);
  assert.equal(r.pico?.se, 202602); assert.equal(r.ultima?.se, 202603);
});
