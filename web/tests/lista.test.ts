import { test } from "node:test";
import assert from "node:assert/strict";
import { ordenarMunicipios } from "../src/componentes/ListaMunicipios";
import type { MunicipioSemana } from "../src/dados/tipos";

// Linhas de teste montadas à mão só para checar a ordenação (não são dados do RN).
const m = (n: string, i: number | null, c: number | null): MunicipioSemana =>
  ({ g: n.length, n, c, ce: null, i, nv: null, rt: null, prt: null, pop: null, ca: null, dt: null });
const L = [m("Bb", 5, 2), m("Aa", null, null), m("Ác", 9, 1), m("Cc", 5, 0)];

test("lista: incidência decrescente, sem dado sempre no fim", () => {
  assert.deepEqual(ordenarMunicipios(L, "i", true).map((x) => x.n), ["Ác", "Bb", "Cc", "Aa"]);
  assert.deepEqual(ordenarMunicipios(L, "i", false).map((x) => x.n), ["Bb", "Cc", "Ác", "Aa"]);
});

test("lista: nome em ordem alfabética do português", () => {
  assert.deepEqual(ordenarMunicipios(L, "n", false).map((x) => x.n), ["Aa", "Ác", "Bb", "Cc"]);
});
