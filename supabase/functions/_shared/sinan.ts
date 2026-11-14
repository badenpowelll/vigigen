// VigiGen — agregação das notificações do SINAN (API DEMAS) sem colunas pessoais.
// Mesma regra de src/ingest/demas.py (agregar_sinan); os testes conferem as duas
// com as mesmas respostas reais (tests/fixtures/FIXTURE_demas_*).
// D-020: a resposta original traz idade, sexo, raça etc. e NÃO é gravada; só as
// contagens abaixo e o sha256 da resposta original vão para public.bruto.

export const CHAVE_SINAN = [
  "nu_ano", "sem_not", "id_municip", "id_mn_resi", "classi_fin", "criterio", "sorotipo",
] as const;

type Chave = typeof CHAVE_SINAN[number];
export type Contagem = { [K in Chave]: string | null } & { n: number };

const VAZIOS = new Set(["", "nan", "NaN", "None", "null"]);

function valor(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return VAZIOS.has(s) ? null : s;
}

export function agregarSinan(registros: Record<string, unknown>[]): Contagem[] {
  const mapa = new Map<string, Contagem>();
  for (const r of registros) {
    const vals = CHAVE_SINAN.map((k) => valor(r[k]));
    const id = JSON.stringify(vals);
    const atual = mapa.get(id);
    if (atual) atual.n++;
    else {
      const linha = Object.fromEntries(CHAVE_SINAN.map((k, i) => [k, vals[i]])) as unknown as Contagem;
      linha.n = 1;
      mapa.set(id, linha);
    }
  }
  const ordem = (c: Contagem) => CHAVE_SINAN.map((k) => c[k] ?? "");
  return [...mapa.values()].sort((a, b) => {
    const x = ordem(a), y = ordem(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
}

export function corpoAgregado(agravo: string, registros: Record<string, unknown>[]) {
  return { agravo, registros_originais: registros.length, chave: [...CHAVE_SINAN], contagens: agregarSinan(registros) };
}
