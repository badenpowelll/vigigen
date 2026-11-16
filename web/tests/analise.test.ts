import { test } from "node:test";
import assert from "node:assert/strict";
import { transmissaoCrescendo, subidaSemanal, incidenciaSemNotificacao, nivelAlto, faltamSequencias, condutasSugeridas, maiorIncidencia } from "../src/dados/analise";
import type { MunicipioSemana, Semana } from "../src/dados/tipos";

// Linhas montadas à mão só para testar as regras (não são dados do RN).
const m = (g: number, n: string, o: Partial<MunicipioSemana>): MunicipioSemana =>
  ({ g, n, c: 0, ce: 0, i: 0, nv: 1, rt: null, prt: null, pop: 1000, ca: 0, dt: null, ...o });
const S: Semana = { doenca: "dengue", se: 202644, se_anterior: 202643, ingerido_em: null, municipios: [
  m(1, "A", { c: 10, ce: 12, i: 50, rt: 1.4, prt: 0.95, ca: 4, nv: 3 }),
  m(2, "B", { c: 1, ce: 1, i: 40, rt: 3.0, prt: 0.99, ca: 0 }),
  m(3, "C", { c: 0, ce: 9, i: 60, ca: 0 }),
  m(4, "D", { c: 2, ce: 2, i: 5, ca: 5 }),
  m(5, "E", { c: null, ce: null, i: null, nv: null, ca: null }),
] };

test("Rt: probabilidade alta e casos suficientes; poucos casos ficam como instáveis", () => {
  const r = transmissaoCrescendo(S, "dengue");
  assert.deepEqual(r.itens.map((x) => x.n), ["A"]);
  assert.match(r.resumo, /instável \(B\)/);
});

test("subida: só onde os notificados passaram os da semana anterior", () => {
  assert.deepEqual(subidaSemanal(S, "dengue").itens.map((x) => x.n), ["A", "B"]);
});

test("incidência alta com 0 ou 1 notificado", () => {
  assert.deepEqual(incidenciaSemNotificacao(S, "dengue").itens.map((x) => x.n), ["C"]);
});

test("nível 3 ou 4 e a contagem por nível", () => {
  const r = nivelAlto(S, "dengue");
  assert.deepEqual(r.itens.map((x) => x.n), ["A"]);
  assert.match(r.resumo, /3 Baixo, 0 Atenção, 1 Alerta, 0 Emergência/);
});

test("sequências: sem ingestão não vira zero; zero observado só com casos", () => {
  assert.equal(faltamSequencias([], new Map(), "zika", false).itens.length, 0);
  assert.match(faltamSequencias([], new Map(), "zika", false).resumo, /não é zero/);
  const r = faltamSequencias([{ g: 1, p: "2026T3", v: 0, num: 0, den: 30, mot: null }, { g: 2, p: "2026T3", v: null, num: 0, den: 0, mot: "sem casos" }], new Map([[1, "A"]]), "dengue", true);
  assert.deepEqual(r.itens.map((x) => x.n), ["A"]);
});

test("condutas: município com mais sinais primeiro, sem repetir a mesma conduta", () => {
  const r = condutasSugeridas(S, "dengue");
  assert.equal(r.itens[0].n, "A");
  assert.match(r.aviso!, /não o que a gestão do município fez/);
});

test("maior incidência ignora sem dado e zero", () => {
  const r = maiorIncidencia({ dengue: S }, 2);
  assert.deepEqual(r.itens.map((x) => x.n), ["C · Dengue", "A · Dengue"]);
});
