import type { Ctx } from "./ctx";
import type { Doenca } from "../dados/tipos";
import { atualidadeSerie, genomicaDe } from "../dados/calc";
import { DOENCA_ROTULO, fmtSE } from "../util";
import { BarraMeta, Dica, Nota, Secao } from "../componentes/basicos";
import { fmtDataHora, fmtNum } from "../util";

const FONTES = [
  { id: "infodengue", nome: "InfoDengue (Fiocruz / FGV)", url: "https://info.dengue.mat.br/services/api", uso: "Casos notificados e estimados, incidência, Rt e nível de alerta por município e semana epidemiológica. Endpoint /api/alertcity, formato JSON. Atualização semanal." },
  { id: "genbank", nome: "NCBI GenBank (E-utilities)", url: "https://www.ncbi.nlm.nih.gov/books/NBK25501/", uso: "Sequências depositadas com origem Brasil, um termo de busca por vírus (dengue, chikungunya e Zika; o estado de cada um aparece abaixo): esearch + efetch (GBSet XML). Metadados de coleta, origem, sorotipo declarado (só dengue) e FASTA. O vírus de cada sequência vem do organismo declarado no registro." },
  { id: "ibge", nome: "IBGE: Localidades e malha municipal", url: "https://servicodados.ibge.gov.br/api/docs/localidades", uso: "Lista oficial dos 167 municípios do RN e limites municipais. A rota usada em cada carga (API servicodados ou GeoServer BC250, alternativa usada quando a API falhou por certificado TLS em outubro de 2026) aparece ao lado e fica registrada no banco." },
];

const ROTA_IBGE: Record<string, string> = {
  servicodados: "API servicodados do IBGE (localidades e Malhas v3)",
  geoservicos_wfs: "GeoServer do IBGE (BC250), alternativa",
};
const ATUAL: Record<string, string> = { em_dia: "em dia", atrasada: "atrasada", parada: "parada", sem_dado: "sem dado" };
const AGRAVOS: Doenca[] = ["dengue", "chikungunya", "zika"];

export function TelaSobre({ dados }: Ctx) {
  const r = dados.resumo!;
  return (
    <div className="flex flex-col gap-4">
      <Secao id="sla" titulo="SLA de atualização dos dados · meta de 95%"
        subtitulo="Percentual das horas dos últimos 30 dias em que cada dado estava dentro do prazo máximo de idade definido pela agenda de cargas.">
        {r.sla?.fontes?.length ? (
          <>
            <ul className="flex flex-col gap-3">
              {r.sla.fontes.map((f) => (
                <li key={f.fonte} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(12rem,1fr)_2fr]">
                  <span className="inline-flex items-center gap-1 text-sm font-semibold">
                    {f.rotulo}
                    <Dica rotulo={`Detalhes do SLA: ${f.rotulo}`} texto={<>
                      Agenda: {f.agenda}. Prazo máximo de idade: {fmtNum(f.meta_horas)} h.<br />
                      Última atualização bem-sucedida: {f.ultima_ok ? `${fmtDataHora(f.ultima_ok)} (há ${fmtNum(f.idade_horas, 1)} h)` : "nenhuma"}.<br />
                      {f.dentro ? "Agora: dentro do prazo." : "Agora: fora do prazo."} Horas medidas: {fmtNum(f.horas_medidas_30d)}.
                    </>} />
                  </span>
                  <BarraMeta valor={f.cumprimento_30d} meta={r.sla!.meta_cumprimento} rotulo={`Cumprimento do SLA de ${f.rotulo} em 30 dias`} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-suave">
              {r.sla.fontes.filter((f) => f.atende).length} de {r.sla.fontes.length} fontes atendem a meta de {r.sla.meta_cumprimento}%.
              Calculado em {fmtDataHora(r.sla.calculado_em)}. "Sem medição" quer dizer que a etapa nunca rodou com sucesso, não que cumpriu a meta.
            </p>
          </>
        ) : (
          <Nota tipo="aviso">
            O SLA ainda não é publicado por este banco para o painel (a função painel_sla, da migração 016, aguarda aprovação para ser aplicada).
            Nenhum percentual é mostrado no lugar. A meta definida é 95% das horas dos últimos 30 dias dentro do prazo de cada fonte.
          </Nota>
        )}
      </Secao>
      <Secao titulo="Fontes" subtitulo="Toda resposta externa é gravada crua, com data e hash, antes de qualquer transformação.">
        <ul className="flex flex-col gap-3">
          {FONTES.map((f) => {
            const st = r.fontes?.[f.id];
            return (
              <li key={f.id} className="rounded-[var(--raio)] border border-borda p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold underline">{f.nome}</a>
                  <span className="num text-xs text-suave">
                    {st ? `última carga ${fmtDataHora(st.finalizado_em)} · ${fmtNum(st.registros)} registros` : "sem carga concluída"}
                    {st?.id != null ? ` · execução nº ${st.id}` : ""}
                    {f.id === "ibge" && st?.rota ? ` · rota: ${ROTA_IBGE[st.rota] ?? st.rota}` : ""}
                    {r.em_andamento.includes(f.id) ? " · carga em andamento" : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm text-suave">{f.uso}</p>
              </li>
            );
          })}
        </ul>
      </Secao>
      <Secao titulo="Saúde das fontes, por agravo" subtitulo="A data de leitura do banco não torna o dado recente: cada agravo mostra a última semana publicada e a última consulta ao GenBank.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabela de saúde das fontes por agravo">
          <table className="tabela-relatorio w-full text-sm">
            <thead><tr><th className="text-left">Agravo</th><th className="text-left">Última SE no InfoDengue</th><th className="text-left">Atualidade</th><th className="text-left">GenBank</th><th className="text-right">Sequências</th><th className="text-right">Classificadas</th></tr></thead>
            <tbody>
              {AGRAVOS.map((d) => {
                const se = dados.semana[d]?.se;
                const at = atualidadeSerie(se);
                const gen = genomicaDe(r, d);
                return (
                  <tr key={d}>
                    <td>{DOENCA_ROTULO[d]}</td>
                    <td>{fmtSE(se)}</td>
                    <td>{ATUAL[at.estado]}{at.semanas !== null ? ` (${at.semanas} sem.)` : ""}</td>
                    <td>{gen.estado === "ok" ? `consulta em ${fmtDataHora(gen.consultaEm)}` : gen.estado === "vazio" ? "consulta sem resultado" : "ainda não ingerido"}</td>
                    <td className="text-right tabular-nums">{gen.estado === "ok" ? fmtNum(gen.r?.genbank.total) : "—"}</td>
                    <td className="text-right tabular-nums">{gen.estado === "ok" ? fmtNum(gen.classificadas) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-suave">Atualidade: em dia até 4 semanas da semana corrente; atrasada até 12; parada acima disso. O InfoDengue revisa semanas recentes retroativamente.</p>
      </Secao>
      <Secao titulo="Método">
        <div className="flex max-w-prose flex-col gap-2 text-sm">
          <p><strong>Razão de sequências públicas identificáveis por casos notificados</strong> = sequências do vírus depositadas no GenBank com coleta no período e município identificado ÷ casos notificados do mesmo agravo no mesmo período e território. Mede o que é público e identificável, não o sequenciamento feito pelos laboratórios. Fica sem dado, com o motivo, quando não há casos ou quando há sequência do RN sem município.</p>
          <p><strong>Genoma quase completo</strong>: 9.000 nt para dengue (limiar histórico do projeto). Para chikungunya e Zika o limiar é provisório (a mesma fração do genoma de referência) e o indicador é exploratório até haver critério de QC validado por vírus.</p>
          <p><strong>Oportunidade</strong> = dias entre a coleta e a criação do registro no GenBank, por sorotipo e ano. Mediana com P25 e P75; só coletas com data exata.</p>
          <p><strong>Origem da sequência</strong> vem do campo geo_loc_name (country) do GenBank. Sequências com "/RN/" no nome da cepa, mas sem RN no geo_loc, são contadas à parte e não entram nos indicadores.</p>
          <p><strong>Duplicidade (achado de 14/11/2026, em investigação)</strong>: 17 títulos de registro aparecem mais de uma vez na base, o que pode indicar segmentos diferentes de uma mesma amostra. As contagens ainda tratam cada registro como uma sequência.</p>
          <p><strong>Nível de alerta</strong> é o do InfoDengue (1 a 4), mostrado sempre com cor, ícone e rótulo.</p>
          <p><strong>Atualização</strong>: cargas automáticas agendadas no banco (InfoDengue segunda e quinta, GenBank todo dia, IBGE mensal) e indicadores recalculados a cada 6 horas. Os dados não são instantâneos: cada número mostra a origem e a data.</p>
          <p><strong>Acesso</strong>: o banco usa Row Level Security. Cada usuário só vê o território da própria organização; o laboratório e o estado veem tudo; toda revisão de alerta fica em auditoria que não pode ser apagada.</p>
        </div>
      </Secao>
      <Secao titulo="Sobre o projeto">
        <p className="max-w-prose text-sm">
          VigiGen é o artefato de uma tese de doutorado em Bioinformática na UFRN/IMD, construída com Design Science Research.
          A interface segue o Padrão Digital de Governo (gov.br Design System 3.7.0); a marca é a do próprio VigiGen. Painel gerado em {fmtDataHora(r.gerado_em)}.
        </p>
      </Secao>
    </div>
  );
}
