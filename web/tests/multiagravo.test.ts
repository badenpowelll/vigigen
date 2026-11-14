// Prova que, com Zika ou chikungunya selecionado, nenhum número de dengue é
// reutilizado, e que estados sem dado nunca viram "zero" nem "sem alerta".
// Dados: tests/fixtures/FIXTURE_resumo_multiagravo.json (fictícios, só teste).
import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "../../tests/fixtures/FIXTURE_resumo_multiagravo.json";
import { atualidadeSerie, estadoDeteccao, genomicaDe, seDe, semanasEntre } from "../src/dados/calc";
import { metadados, montarRelatorios } from "../src/relatorios";
import type { Resumo } from "../src/dados/tipos";
import type { Ctx } from "../src/telas/ctx";

const base = () => structuredClone(fixture) as unknown as Resumo;
const NUMS_DENGUE = ["7777", "7.777", "5555", "5.555", "0,0777", "7,77"];

test("Zika sem bloco genômico: nada de dengue, estado não ingerido", () => {
  const g = genomicaDe(base(), "zika");
  assert.equal(g.estado, "nao_ingerido");
  assert.equal(g.r!.genbank.total, 0);
  assert.equal(g.classificadas, 0, "não herda o total global de classificação");
  assert.deepEqual(g.r!.cobertura_municipal_trimestre, []);
  assert.deepEqual(g.r!.por_ano_brasil, []);
});

test("Chikungunya com bloco próprio usa só os números do bloco", () => {
  const r = base();
  r.genomica = { chikungunya: {
    agravo: "chikungunya", config: { termo: "FIXTURE chik", referencia: "NC_004162.2", tamanho_referencia: 11826, limiar: 9914, criterio_limiar: "provisório", classificacao: "a verificar" },
    fonte: { id: 42, status: "ok", iniciado_em: "2026-11-14T11:20:00Z", finalizado_em: "2026-11-14T11:30:00Z", registros: 12 },
    genbank: { total: 12, rn: 1, rn_por_nome_cepa: 0, brasil_sem_estado: 0, sem_geo: 0, genoma_quase_completo: 3, por_sorotipo: {}, termo: "FIXTURE chik" },
    sequencias_rn: [], composicao_brasil: [], por_ano_brasil: [], indicadores: [], cobertura_municipal_trimestre: [],
    classificacao: { total: 0 },
  } };
  const g = genomicaDe(r, "chikungunya");
  assert.equal(g.estado, "ok");
  assert.equal(g.r!.genbank.total, 12);
  assert.equal(g.classificadas, 0);
  assert.equal(g.execucao, 42);
  assert.equal(g.provisorio, true, "limiar provisório marcado como exploratório");
  assert.equal(estadoDeteccao(r, "chikungunya", null).estado, "aguardando_classificacao");
});

test("Alertas: filtro por agravo e território; legado sem agravo conta como dengue", () => {
  const r = base();
  assert.equal(estadoDeteccao(r, "zika", null).alertas.length, 0);
  assert.equal(estadoDeteccao(r, "zika", null).estado, "sem_sequencias");
  assert.equal(estadoDeteccao(r, "dengue", 2408102).alertas.length, 1);
  assert.equal(estadoDeteccao(r, "dengue", 2400208).alertas.length, 0, "outro município");
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "alertas_pendentes");
});

test("Estados da detecção nunca mostram 'sem alerta' sem execução registrada", () => {
  const r = base(); r.alertas = [];
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "deteccao_pendente");
  r.deteccao = { em: "2026-11-14T12:00:00Z", resumo: { pares_abaixo_do_minimo: 3 } };
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "concluida_sem_alertas");
  r.classificacao.total = 0; r.exclusoes_qc = { "cobertura < 70%": 4 };
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "qc_insuficiente");
  r.exclusoes_qc = {};
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "aguardando_classificacao");
  r.alertas = [{ id: "FIXTURE_A2", g: 2408102, a: "dengue", tipo: "R2", p: "2026T3", status: "descartado", ev: {}, criado: "2026-11-14T11:00:00Z", rev: "2026-11-14T12:00:00Z" } as never];
  r.classificacao.total = 5;
  assert.equal(estadoDeteccao(r, "dengue", null).estado, "alertas_revisados");
});

test("Semana epidemiológica e atualidade por agravo", () => {
  assert.equal(seDe(new Date("2026-11-14T12:00:00Z")), 202645);
  assert.equal(seDe(new Date("2026-01-04T12:00:00Z")), 202601);
  assert.equal(seDe(new Date("2026-01-03T12:00:00Z")), 202553);
  assert.equal(semanasEntre(202553, 202601), 1);
  const hoje = new Date("2026-11-14T12:00:00Z");
  assert.deepEqual(atualidadeSerie(202644, hoje), { estado: "em_dia", semanas: 1 });
  assert.equal(atualidadeSerie(202635, hoje).estado, "atrasada");
  assert.equal(atualidadeSerie(202407, hoje).estado, "parada", "Zika na SE 07/2024");
  assert.equal(atualidadeSerie(null, hoje).estado, "sem_dado");
});

test("Relatórios de Zika não carregam nenhum número de dengue e levam procedência", () => {
  const r = base();
  const ctx = {
    dados: { origem: "retrato", lidoEm: "2026-11-14T12:00:00Z", resumo: r, malha: null, semana: {}, serieEstado: {} },
    doenca: "zika", g: null, nomeSel: "Rio Grande do Norte", serieMun: null, setG: () => {}, irPara: () => {},
  } as unknown as Ctx;
  const rels = montarRelatorios(ctx);
  for (const rel of rels.filter((x) => x.porAgravo)) {
    const texto = JSON.stringify([rel.titulo, rel.linhas, rel.notas]);
    for (const n of NUMS_DENGUE) assert.ok(!texto.includes(n), `${rel.id} contém ${n}`);
  }
  const cob = rels.find((x) => x.id === "cobertura")!;
  assert.equal(cob.linhas.length, 0);
  const meta = Object.fromEntries(metadados(cob, ctx, new Date("2026-11-14T12:00:00Z")));
  assert.equal(meta["Território selecionado"], "Rio Grande do Norte");
  assert.ok(meta["Versão do método"].includes("013"));
  assert.ok(meta["Link da fonte"].startsWith("https://"));
  assert.ok(meta["Ressalva"].includes("não instantâneos"));
});
