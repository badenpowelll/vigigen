// PR #3, portado do vitest para o node:test usado em web/scripts/testar.mjs.
// Testes do isolamento por agravo e dos estados "sem dado" (auditoria de 14/11/2026).
// Os objetos abaixo são FIXTURE_: fictícios, só para teste, nunca exibidos no painel.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
const expect = (v: unknown) => ({ toBe: (e: unknown) => assert.equal(v, e), toEqual: (e: unknown) => assert.deepEqual(v, e) });
import { alertasDe, classificadasDe, estadoCobertura, genomicaDe } from "../src/dados/calc";
import type { Alerta, GenbankResumo, Genomica, Resumo } from "../src/dados/tipos";

const gb = (total: number): GenbankResumo => ({
  total, rn: 0, rn_por_nome_cepa: 0, brasil_sem_estado: 0, sem_geo: 0,
  genoma_quase_completo: 0, por_sorotipo: {}, termo: "FIXTURE_termo",
});
const alerta = (id: string, a: Alerta["a"], g: number | null): Alerta => ({
  id, g, a, tipo: "FIXTURE_R1", p: "2024T1", status: "novo", ev: {}, criado: "2024-01-01T00:00:00Z", rev: null,
});
const bloco = (agravo: Genomica["agravo"], total: number, classificadas?: number): Genomica => ({
  agravo, genbank: gb(total), sequencias_rn: [], composicao_brasil: [], por_ano_brasil: [],
  indicadores: [], cobertura_municipal_trimestre: [],
  ...(classificadas === undefined ? {} : { classificacao: { total: classificadas } }),
});
const FIXTURE_resumo = (extra: Partial<Resumo> = {}): Resumo => ({
  gerado_em: "2024-01-01T00:00:00Z", fontes: null, em_andamento: [], genbank: gb(100),
  sequencias_rn: [], composicao_brasil: [], por_ano_brasil: [], indicadores: [],
  cobertura_municipal_trimestre: [], alertas: [], classificacao: { total: 40 }, exclusoes_qc: {},
  ...extra,
});

describe("classificadasDe", () => {
  it("usa a contagem do próprio vírus quando o banco a informa", () => {
    const r = FIXTURE_resumo({ genomica: { dengue: bloco("dengue", 100, 40), zika: bloco("zika", 5, 0), chikungunya: bloco("chikungunya", 9, 3) } });
    expect(classificadasDe(r, "dengue")).toBe(40);
    expect(classificadasDe(r, "zika")).toBe(0);
    expect(classificadasDe(r, "chikungunya")).toBe(3);
  });
  it("sem bloco por agravo, o total antigo vale só para dengue", () => {
    const r = FIXTURE_resumo();
    expect(classificadasDe(r, "dengue")).toBe(40);
    expect(classificadasDe(r, "zika")).toBe(0);
    expect(classificadasDe(r, "chikungunya")).toBe(0);
  });
  it("sem leitura do banco devolve zero", () => expect(classificadasDe(null, "dengue")).toBe(0));
});

describe("alertasDe", () => {
  const r = FIXTURE_resumo({ alertas: [alerta("1", "dengue", 2408102), alerta("2", "zika", 2408102), alerta("3", undefined, null), alerta("4", "dengue", 2400109)] });
  it("não devolve alerta de outro vírus", () => {
    expect(alertasDe(r, "zika", null).map((a) => a.id)).toEqual(["2"]);
    expect(alertasDe(r, "chikungunya", null)).toEqual([]);
  });
  it("alerta sem agravo (anterior à migração 013) conta como dengue", () => {
    expect(alertasDe(r, "dengue", null).map((a) => a.id)).toEqual(["1", "3", "4"]);
  });
  it("filtra agravo e território ao mesmo tempo", () => {
    expect(alertasDe(r, "dengue", 2408102).map((a) => a.id)).toEqual(["1"]);
    expect(alertasDe(r, "zika", 2400109)).toEqual([]);
  });
});

describe("estadoCobertura", () => {
  it("lista vazia é indicador não calculado, não zero", () => expect(estadoCobertura([])).toBe("nao_calculado"));
  it("só nulos é sem dado, não zero", () => expect(estadoCobertura([null, null])).toBe("so_sem_dado"));
  it("zero só quando algum município tem zero de verdade", () => expect(estadoCobertura([null, 0, 0])).toBe("zero_observado"));
  it("qualquer valor positivo", () => expect(estadoCobertura([null, 0, 0.02])).toBe("com_valor"));
});

describe("genomicaDe", () => {
  it("sem bloco do agravo, Zika e chikungunya nunca recebem números de dengue", () => {
    const r = FIXTURE_resumo();
    for (const d of ["zika", "chikungunya"] as const) {
      const x = genomicaDe(r, d);
      expect(x.estado).toBe("nao_ingerido");
      expect(x.r?.genbank.total).toBe(0);
    }
    expect(genomicaDe(r, "dengue").r?.genbank.total).toBe(100);
  });
  it("com bloco, usa o do próprio vírus", () => {
    const r = FIXTURE_resumo({ genomica: { zika: bloco("zika", 5) } });
    expect(genomicaDe(r, "zika").r?.genbank.total).toBe(5);
    expect(genomicaDe(r, "zika").estado).toBe("ok");
  });
});
