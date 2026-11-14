import { test } from "node:test";
import assert from "node:assert/strict";
import { intervaloDoFiltro, semanasNoRecorte } from "../src/componentes/SerieFiltrada";
import type { Serie } from "../src/dados/tipos";

// Série de teste montada à mão (não é dado do RN): semanas começando em domingo.
const s: Serie = { geocodigo: 1, doenca: "dengue", se: [202643, 202644, 202645, 202646], dt: ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-29"],
  c: [1, 2, 3, 4], ce: [1, 2, 3, 4], i: [0, 0, 0, 0], nv: [1, 1, 1, 1], rt: [null, null, null, null], n_mun: [1, 1, 1, 1] };

test("mês: entram as semanas com algum dia no mês, inclusive as de borda", () => {
  const r = intervaloDoFiltro({ ano: "2026", mes: "10", de: "", ate: "" }); // novembro
  assert.deepEqual(semanasNoRecorte(s, r).map((k) => s.se[k]), [202644, 202645, 202646]);
  const out = intervaloDoFiltro({ ano: "2026", mes: "9", de: "", ate: "" }); // outubro: 25/10 a 31/10
  assert.deepEqual(semanasNoRecorte(s, out).map((k) => s.se[k]), [202643]);
});

test("intervalo de datas e sem filtro", () => {
  const r = intervaloDoFiltro({ ano: "", mes: "", de: "2026-11-05", ate: "2026-11-09" });
  assert.deepEqual(semanasNoRecorte(s, r).map((k) => s.se[k]), [202644, 202645]);
  assert.equal(semanasNoRecorte(s, intervaloDoFiltro({ ano: "", mes: "", de: "", ate: "" })).length, 4);
});
