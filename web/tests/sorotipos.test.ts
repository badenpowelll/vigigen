import { test } from "node:test";
import assert from "node:assert/strict";
import { destaquesSorotipos, tabelaSorotipos } from "../src/componentes/Sorotipos";

// Composição de teste montada à mão (não é dado do GenBank).
const comp = [
  { a: 2020, s: "DENV-2", n: 40 }, { a: 2020, s: "DENV-1", n: 10 },
  { a: 2021, s: "DENV-1", n: 30 }, { a: 2021, s: "DENV-3", n: 10 },
  { a: 2022, s: "DENV-1", n: 20 }, { a: 2022, s: "não declarado", n: 30 },
  { a: 2023, s: "DENV-3", n: 5 },
];

test("tabela soma por ano, ordena do mais recente e marca amostra pequena", () => {
  const t = tabelaSorotipos(comp, null);
  assert.deepEqual(t.map((l) => l.a), [2023, 2022, 2021, 2020]);
  assert.equal(t[0].n, 5); assert.equal(t[0].pequeno, true);
  assert.equal(t[1].n, 50); assert.equal(t[1].dominante, "DENV-1"); // "não declarado" nunca predomina
  assert.equal(tabelaSorotipos(comp, 2022).length, 2);
});

test("destaques usam só anos com amostra suficiente", () => {
  const d = destaquesSorotipos(tabelaSorotipos(comp, null));
  assert.equal(d.ultimo?.a, 2022);
  assert.deepEqual(d.trocas, [{ a: 2021, de: "DENV-2", para: "DENV-1" }]);
  assert.equal(d.picoDenv3?.a, 2021); assert.equal(d.picoDenv3?.p, 0.25);
  assert.equal(d.denv3.find((x) => x.a === 2023), undefined);
});
