// Estado de dados do painel. Começa pelo retrato embutido (se houver) e tenta
// o dado ao vivo; se o ao vivo falhar, o retrato continua na tela com a data
// em que foi tirado e o motivo da falha. Nada é inventado: sem retrato e sem
// conexão, a tela diz que não há dado e por quê.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Doenca, Malha, Resumo, Semana, Serie } from "./tipos";
import { DOENCAS } from "./tipos";
import { RETRATO, consultas, mensagemErro, type ErroFonte, type Origem } from "./fonte";
import { supabase, viaSupabase } from "./supabase";

export interface Dados {
  origem: Origem | null;
  lidoEm: string | null;          // quando o dado foi lido do banco
  aviso: string | null;           // por que não é ao vivo, quando não é
  carregando: boolean;
  resumo: Resumo | null;
  malha: Malha | null;
  semana: Partial<Record<Doenca, Semana>>;
  serieEstado: Partial<Record<Doenca, Serie>>;
}

const inicial: Dados = RETRATO
  ? {
      origem: "retrato", lidoEm: RETRATO.gerado_em, aviso: null, carregando: true,
      resumo: RETRATO.resumo, malha: RETRATO.malha, semana: RETRATO.semana, serieEstado: RETRATO.serie_estado,
    }
  : { origem: null, lidoEm: null, aviso: null, carregando: true, resumo: null, malha: null, semana: {}, serieEstado: {} };

type Chamada = <T>(funcao: string, posicional: unknown[], nomeados: Record<string, unknown>) => Promise<{ dado: T; em: number }>;

const chamarConector: Chamada = (f, pos) => {
  const m = {
    painel_resumo: () => consultas.resumo(),
    painel_malha: () => consultas.malha(),
    painel_semana: () => consultas.semana(pos[0] as Doenca),
    painel_serie: () => consultas.serie(pos[0] as number | null, pos[1] as Doenca, (pos[2] as number) ?? 202001),
  } as Record<string, () => Promise<{ dado: unknown; em: number }>>;
  return m[f]() as never;
};
const chamarSupabase: Chamada = (f, _pos, nom) => viaSupabase(f, nom) as never;

export function useDados() {
  const [d, setD] = useState<Dados>(inicial);
  const chamada = useRef<Chamada | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // tenta conector (claude.ai), depois Supabase direto (web com login)
      const rotas: [Origem, Chamada][] = [["conector", chamarConector]];
      if (supabase) rotas.push(["supabase", chamarSupabase]);
      let ultimoErro: ErroFonte | null = null;
      for (const [origem, ch] of rotas) {
        try {
          const r = await ch<Resumo>("painel_resumo", [], {});
          const [malha, ...semanas] = await Promise.all([
            ch<Malha>("painel_malha", [], {}),
            ...DOENCAS.map((x) => ch<Semana>("painel_semana", [x], { p_doenca: x })),
          ]);
          const series = await Promise.all(DOENCAS.map((x) => ch<Serie>("painel_serie", [null, x, 202001], { p_geocodigo: null, p_doenca: x, p_desde: 202001 })));
          if (!vivo) return;
          chamada.current = ch;
          setD({
            origem, lidoEm: new Date(r.em).toISOString(), aviso: null, carregando: false,
            resumo: r.dado, malha: malha.dado as Malha,
            semana: Object.fromEntries(DOENCAS.map((x, i) => [x, semanas[i].dado as Semana])),
            serieEstado: Object.fromEntries(DOENCAS.map((x, i) => [x, series[i].dado])),
          });
          return;
        } catch (e) {
          ultimoErro = e as ErroFonte;
        }
      }
      if (!vivo) return;
      setD((s) => ({
        ...s, carregando: false,
        aviso: ultimoErro ? mensagemErro(ultimoErro) : null,
      }));
    })();
    return () => { vivo = false; };
  }, []);

  /** Série de um município. Ao vivo quando possível; senão a do retrato, se existir. */
  const serieMunicipio = useCallback(async (g: number, doenca: Doenca): Promise<Serie | null> => {
    if (chamada.current) {
      try {
        const r = await chamada.current<Serie>("painel_serie", [g, doenca, 202001], { p_geocodigo: g, p_doenca: doenca, p_desde: 202001 });
        return r.dado;
      } catch { /* cai para o retrato */ }
    }
    return RETRATO?.series_municipio?.[`${g}:${doenca}`] ?? null;
  }, []);

  return { ...d, serieMunicipio, aoVivo: d.origem === "conector" || d.origem === "supabase" };
}

/** Últimas 12 semanas de casos, do retrato, para quando não há série ao vivo. */
export function ult12Retrato(g: number, doenca: Doenca): (number | null)[] | null {
  return RETRATO?.ult12?.[doenca]?.c[String(g)] ?? null;
}
