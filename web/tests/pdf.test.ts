import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarPdf } from "../src/relatorios";
import { relativos, TRACOS_MARCA } from "../src/marcaPdf";
import { carimboImpressao } from "../src/util";

test("carimbo: matrícula, e-mail e hora com segundos no horário de Brasília", () => {
  const em = new Date("2026-11-14T23:05:09Z"); // 20:05:09 em Brasília
  assert.equal(carimboImpressao({ email: "pessoa@exemplo.org", matricula: "123" }, em),
    "Impresso em 14/11/2026, 20:05:09 (horário de Brasília) · matrícula 123 · pessoa@exemplo.org");
  assert.match(carimboImpressao({ email: "a@b.c", matricula: null }, em), /matrícula não cadastrada/);
  assert.match(carimboImpressao(null, em), /sem login/);
});

test("marca: o laço da hélice fecha no ponto de partida", () => {
  const laco = TRACOS_MARCA[2];
  const soma = relativos(laco).reduce((a, r) => [a[0] + r[r.length - 2], a[1] + r[r.length - 1]], [0, 0]);
  assert.deepEqual(soma, [0, 0]);
});

test("PDF: cabeçalho e rodapé com a marca e o carimbo em todas as páginas", async () => {
  // Relatório de teste montado à mão (linhas sintéticas só para paginar; não são dados do RN).
  const rel = { id: "t", titulo: "FIXTURE relatório de teste", descricao: "", fonte: "teste", porAgravo: false, notas: [],
    colunas: [{ r: "A" }, { r: "B", tipo: "int" }], linhas: Array.from({ length: 120 }, (_, i) => [`linha ${i}`, i]) } as never;
  const carimbo = "Impresso em 14/11/2026, 20:05:09 (horário de Brasília) · matrícula 123 · pessoa@exemplo.org";
  const blob = await gerarPdf(rel, [["Relatório", "x"], ["Impressão", carimbo]]);
  const txt = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  const paginas = (txt.match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(paginas >= 2, `esperava 2+ páginas, veio ${paginas}`);
  // texto do carimbo no rodapé de cada página, mais uma vez nos metadados da 1ª
  assert.equal((txt.match(/matr\S*cula 123/g) ?? []).length, paginas + 1);
  assert.equal((txt.match(/\(VigiGen\) Tj/g) ?? []).length, paginas);
  assert.match(txt, new RegExp(`P\\S*gina ${paginas} de ${paginas}`));
});
