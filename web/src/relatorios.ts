// Relatórios exportáveis do painel. Cada relatório é montado só com o que o
// painel já leu do banco (ao vivo ou retrato do banco): nada é calculado de
// novo nem completado. Todo arquivo leva a fonte, a origem e as datas.
import type { Doenca, Serie } from "./dados/tipos";
import type { Ctx } from "./telas/ctx";
import { FONTE_GENBANK, FONTE_INFODENGUE } from "./telas/ctx";
import { DOENCA_ROTULO, fmtDataHora, fmtSE } from "./util";

export type Celula = string | number | null;
export interface Coluna { r: string; tipo?: "txt" | "num" | "pct" }

export interface Relatorio {
  id: string;
  titulo: string;
  descricao: string;
  fonte: string;
  colunas: Coluna[];
  linhas: Celula[][];
  notas: string[];
  /** depende do agravo escolhido no topo do painel */
  porAgravo?: boolean;
}

const NIVEL_ROTULO: Record<number, string> = { 1: "1 Baixo", 2: "2 Atenção", 3: "3 Alerta", 4: "4 Emergência" };
const STATUS_ALERTA: Record<string, string> = { novo: "Novo", em_analise: "Em análise", confirmado: "Confirmado", descartado: "Descartado" };

function linhasSerie(s: Serie | null | undefined): Celula[][] {
  if (!s) return [];
  return s.se.map((se, i) => [fmtSE(se), s.dt[i] ?? null, s.c[i], s.ce[i], s.i[i], s.nv[i] ? NIVEL_ROTULO[s.nv[i]!] : null, s.rt[i], s.n_mun[i]]);
}

export function montarRelatorios({ dados, doenca, g, nomeSel, serieMun }: Ctx): Relatorio[] {
  const r = dados.resumo!;
  const agr = DOENCA_ROTULO[doenca];
  const nomes = new Map((dados.malha?.features ?? []).map((f) => [f.properties.g, f.properties.n]));
  const nome = (x: number | null) => (x === null ? "Rio Grande do Norte (estado)" : nomes.get(x) ?? String(x));
  const sem = dados.semana[doenca as Doenca];

  const situacao: Relatorio = {
    id: "situacao", porAgravo: true,
    titulo: `Situação por município, ${agr}, ${fmtSE(sem?.se)}`,
    descricao: "Casos notificados, casos estimados, incidência, nível de alerta e Rt de cada município na semana epidemiológica mais recente.",
    fonte: FONTE_INFODENGUE,
    colunas: [
      { r: "Código IBGE" }, { r: "Município" }, { r: "Casos notificados", tipo: "num" }, { r: "Casos estimados", tipo: "num" },
      { r: "Incidência por 100 mil hab.", tipo: "num" }, { r: "Nível InfoDengue" }, { r: "Rt", tipo: "num" },
      { r: "P(Rt > 1)", tipo: "num" }, { r: "População", tipo: "num" }, { r: "Início da SE" },
    ],
    linhas: [...(sem?.municipios ?? [])].sort((a, b) => a.n.localeCompare(b.n, "pt-BR"))
      .map((m) => [m.g, m.n, m.c, m.ce, m.i, m.nv ? NIVEL_ROTULO[m.nv] : null, m.rt, m.prt, m.pop, m.dt]),
    notas: [
      `Semana epidemiológica ${fmtSE(sem?.se)}; carga do InfoDengue em ${fmtDataHora(sem?.ingerido_em)}.`,
      "Casos estimados e Rt são calculados pelo InfoDengue (nowcasting), não pelo VigiGen.",
    ],
  };

  const serieTerr = g === null ? dados.serieEstado[doenca] : serieMun;
  const serie: Relatorio = {
    id: "serie", porAgravo: true,
    titulo: `Série semanal, ${agr}, ${nomeSel}`,
    descricao: "Uma linha por semana epidemiológica desde 2020 para o território escolhido no topo do painel.",
    fonte: FONTE_INFODENGUE,
    colunas: [
      { r: "Semana" }, { r: "Início da SE" }, { r: "Casos notificados", tipo: "num" }, { r: "Casos estimados", tipo: "num" },
      { r: "Incidência por 100 mil hab.", tipo: "num" }, { r: "Nível InfoDengue" }, { r: "Rt", tipo: "num" }, { r: "Municípios com dado", tipo: "num" },
    ],
    linhas: linhasSerie(serieTerr),
    notas: [
      g === null ? "Estado: soma dos municípios com dado em cada semana." : `Município: ${nomeSel} (IBGE ${g}).`,
      "Para outro território, troque a escolha em \"Território\" no topo do painel.",
    ],
  };

  const cobertura: Relatorio = {
    id: "cobertura",
    titulo: `Cobertura genômica observável no GenBank por município (dengue)`,
    descricao: "Sequências depositadas no GenBank com município de coleta, divididas pelos casos notificados no trimestre.",
    fonte: `${FONTE_GENBANK} e ${FONTE_INFODENGUE}`,
    colunas: [
      { r: "Código IBGE" }, { r: "Município" }, { r: "Trimestre" }, { r: "Sequências com o município", tipo: "num" },
      { r: "Casos notificados", tipo: "num" }, { r: "Cobertura", tipo: "pct" }, { r: "Motivo de não calcular" },
    ],
    linhas: [...r.cobertura_municipal_trimestre].sort((a, b) => nome(a.g).localeCompare(nome(b.g), "pt-BR"))
      .map((x) => [x.g, nome(x.g), x.p, x.num, x.den, x.v, x.mot]),
    notas: [
      "Zero quer dizer zero sequência pública com aquele município, não falta de sequenciamento: nenhuma sequência ingerida traz município de coleta.",
      "Só dengue: o VigiGen ainda não ingere sequências de chikungunya e Zika.",
    ],
  };

  const oport = r.indicadores.filter((x) => x.t.startsWith("oportunidade_mediana_dias:"))
    .sort((a, b) => a.nivel.localeCompare(b.nivel) || b.p.localeCompare(a.p) || a.t.localeCompare(b.t));
  const oportunidade: Relatorio = {
    id: "oportunidade",
    titulo: "Oportunidade: dias entre a coleta e o depósito no GenBank",
    descricao: "Mediana e quartis por ano de coleta e sorotipo, no Brasil e no RN.",
    fonte: FONTE_GENBANK,
    colunas: [
      { r: "Nível" }, { r: "Ano de coleta" }, { r: "Sorotipo" }, { r: "Mediana (dias)", tipo: "num" },
      { r: "P25 (dias)", tipo: "num" }, { r: "P75 (dias)", tipo: "num" }, { r: "Sequências", tipo: "num" }, { r: "Calculado em" },
    ],
    linhas: oport.map((x) => [
      x.nivel === "pais" ? "Brasil" : x.nivel === "estado" ? "RN" : nome(x.g), x.p, x.t.split(":")[1] ?? null, x.v,
      (x.d.p25 as number) ?? null, (x.d.p75 as number) ?? null, (x.d.n as number) ?? x.den, fmtDataHora(x.em),
    ]),
    notas: [
      "Só coletas com data completa (dia, mês e ano). Data de disponibilidade: criação do registro no GenBank (GBSeq_create-date).",
    ],
  };

  const seqRn: Relatorio = {
    id: "sequencias_rn",
    titulo: "Sequências de dengue do RN no GenBank",
    descricao: "Cada sequência atribuída ao Rio Grande do Norte, com acesso, sorotipo e datas.",
    fonte: FONTE_GENBANK,
    colunas: [
      { r: "Acesso" }, { r: "Sorotipo" }, { r: "Coleta" }, { r: "Publicação" }, { r: "Local informado" },
      { r: "Tamanho (nt)", tipo: "num" }, { r: "Atribuída pelo nome da cepa" }, { r: "Título" },
    ],
    linhas: r.sequencias_rn.map((s) => [s.acc, s.soro, s.coleta, s.pub, s.geo, s.nt, s.por_nome ? "sim" : "não", s.titulo]),
    notas: ["Nenhuma traz município de coleta; por isso contam só no nível estadual."],
  };

  const composicao: Relatorio = {
    id: "composicao",
    titulo: "Sorotipos informados nos metadados das sequências brasileiras, por ano",
    descricao: "Contagem de sequências por ano de coleta e sorotipo declarado.",
    fonte: FONTE_GENBANK,
    colunas: [{ r: "Ano de coleta" }, { r: "Sorotipo" }, { r: "Sequências", tipo: "num" }],
    linhas: [...r.composicao_brasil].sort((a, b) => b.a - a.a || a.s.localeCompare(b.s)).map((x) => [x.a, x.s, x.n]),
    notas: ["Os percentuais representam as sequências disponíveis e não a prevalência dos sorotipos na população brasileira."],
  };

  const alertas: Relatorio = {
    id: "alertas",
    titulo: "Alertas de mudança no perfil genômico",
    descricao: "Alertas gravados pelas regras de detecção e o estado de revisão de cada um.",
    fonte: "VigiGen (regras R1, R2 e R3 sobre a classificação Nextclade)",
    colunas: [{ r: "Território" }, { r: "Regra" }, { r: "Trimestre" }, { r: "Status" }, { r: "Criado em" }, { r: "Revisado em" }],
    linhas: r.alertas.map((a) => [nome(a.g), a.tipo, a.p, STATUS_ALERTA[a.status] ?? a.status, fmtDataHora(a.criado), a.rev ? fmtDataHora(a.rev) : null]),
    notas: ["Nenhum alerta se confirma sozinho: todo alerta passa por revisão humana."],
  };

  const fontes: Relatorio = {
    id: "fontes",
    titulo: "Fontes e última carga de cada uma",
    descricao: "Situação da última ingestão de cada fonte pública.",
    fonte: "Registro de ingestão do VigiGen (tabela auditoria)",
    colunas: [{ r: "Fonte" }, { r: "Situação" }, { r: "Registros", tipo: "num" }, { r: "Início" }, { r: "Fim" }, { r: "Rota" }],
    linhas: Object.entries(r.fontes ?? {}).map(([k, f]) => [k, f.status, f.registros, fmtDataHora(f.iniciado_em), fmtDataHora(f.finalizado_em), f.rota ?? null]),
    notas: ["InfoDengue é semanal; o GenBank é verificado todo dia e as sequências chegam por lote, com defasagem de semanas a meses."],
  };

  return [situacao, serie, cobertura, oportunidade, seqRn, composicao, alertas, fontes];
}

/** Linhas de cabeçalho que vão em todo arquivo exportado. */
export function metadados(rel: Relatorio, ctx: Ctx, geradoEm: Date): [string, string][] {
  const { dados, doenca } = ctx;
  const origem =
    dados.origem === "conector" ? "Banco do VigiGen, lido ao vivo pelo conector Supabase"
      : dados.origem === "supabase" ? "Banco do VigiGen, lido ao vivo"
        : `Retrato do banco do VigiGen tirado em ${fmtDataHora(dados.lidoEm)}`;
  return [
    ["Relatório", rel.titulo],
    ...(rel.porAgravo ? [["Agravo", DOENCA_ROTULO[doenca]] as [string, string]] : []),
    ["Fonte", rel.fonte],
    ["Origem do dado", origem],
    ["Dado lido em", fmtDataHora(dados.lidoEm)],
    ["Arquivo gerado em", fmtDataHora(geradoEm.toISOString())],
    ["Linhas", String(rel.linhas.length)],
    ["Natureza", "Dados reais das fontes públicas citadas; nenhum valor simulado ou completado."],
    ...rel.notas.map((n) => ["Nota", n] as [string, string]),
  ];
}

// ---------- formatos ----------

const num = (v: number, casas: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas, useGrouping: false });

export function textoCelula(v: Celula, c: Coluna, agrupar = true): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (c.tipo === "pct") return num(v * 100, 2) + "%";
    if (c.tipo === "num") return agrupar ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : num(v, 4);
    return String(v);
  }
  return v;
}

function csvCampo(s: string): string {
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function gerarCsv(rel: Relatorio, meta: [string, string][]): string {
  const linhas = [
    ...meta.map(([k, v]) => [`# ${k}`, v]),
    [],
    rel.colunas.map((c) => c.r),
    ...rel.linhas.map((l) => l.map((v, i) => textoCelula(v, rel.colunas[i], false))),
  ];
  // BOM para o Excel abrir em UTF-8; ponto e vírgula e vírgula decimal (pt-BR)
  return "﻿" + linhas.map((l) => l.map((x) => csvCampo(String(x))).join(";")).join("\r\n") + "\r\n";
}

export async function gerarXlsx(rel: Relatorio, meta: [string, string][]): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const dadosAoa = [rel.colunas.map((c) => c.r), ...rel.linhas];
  const ws = XLSX.utils.aoa_to_sheet(dadosAoa);
  rel.colunas.forEach((c, i) => {
    if (c.tipo !== "pct") return;
    for (let lin = 1; lin <= rel.linhas.length; lin++) {
      const cel = ws[XLSX.utils.encode_cell({ r: lin, c: i })];
      if (cel && typeof cel.v === "number") cel.z = "0.00%";
    }
  });
  ws["!cols"] = rel.colunas.map((c, i) => ({
    wch: Math.min(60, Math.max(c.r.length, ...rel.linhas.slice(0, 200).map((l) => String(l[i] ?? "").length)) + 2),
  }));
  XLSX.utils.book_append_sheet(wb, ws, "Dados");
  const wm = XLSX.utils.aoa_to_sheet([["Campo", "Valor"], ...meta]);
  wm["!cols"] = [{ wch: 20 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wm, "Fonte e método");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export async function gerarPdf(rel: Relatorio, meta: [string, string][]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: rel.colunas.length > 5 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const azul: [number, number, number] = [19, 81, 180]; // --blue-warm-vivid-70 do gov.br DS
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...azul);
  doc.text("VigiGen", 40, 44);
  doc.setTextColor(20).setFontSize(12);
  const tit = doc.splitTextToSize(rel.titulo, larg - 80);
  doc.text(tit, 40, 64);
  let y = 64 + tit.length * 15;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(60);
  for (const [k, v] of meta.filter(([k]) => k !== "Relatório")) {
    const t = doc.splitTextToSize(`${k}: ${v}`, larg - 80);
    doc.text(t, 40, y);
    y += t.length * 11;
  }
  autoTable(doc, {
    startY: y + 6,
    head: [rel.colunas.map((c) => c.r)],
    body: rel.linhas.map((l) => l.map((v, i) => textoCelula(v, rel.colunas[i]))),
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: azul, textColor: 255 },
    alternateRowStyles: { fillColor: [243, 243, 243] },
    columnStyles: Object.fromEntries(rel.colunas.map((c, i) => [i, { halign: c.tipo ? "right" : "left" }])),
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      doc.setFontSize(7.5).setTextColor(110);
      doc.text(`VigiGen · ${rel.fonte}`, 40, alt - 20);
      doc.text(`Página ${doc.getNumberOfPages()}`, larg - 40, alt - 20, { align: "right" });
    },
  });
  return doc.output("blob");
}

// ---------- salvar ----------

interface Downloads { save(r: { filename: string; data: string | Blob | ArrayBuffer }): Promise<{ status: string }> }
let downloadsPromessa: Promise<Downloads | null> | null = null;
function obterDownloads(): Promise<Downloads | null> {
  if (!downloadsPromessa) {
    const w = window as unknown as { claude?: { use: (n: string) => Promise<unknown> } };
    downloadsPromessa = w.claude?.use ? (w.claude.use("downloads") as Promise<Downloads | null>).catch(() => null) : Promise.resolve(null);
  }
  return downloadsPromessa;
}
export function prepararDownloads() { void obterDownloads(); }

const MIME: Record<string, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** Devolve a mensagem para mostrar ao usuário. */
export async function salvar(nomeArquivo: string, dado: string | Blob | ArrayBuffer): Promise<{ ok: boolean; msg: string }> {
  const d = await obterDownloads();
  if (d) {
    try {
      await d.save({ filename: nomeArquivo, data: dado });
      return { ok: true, msg: `Arquivo ${nomeArquivo} entregue para salvar.` };
    } catch (e) {
      const cod = (e as { code?: string }).code;
      if (cod === "declined") return { ok: false, msg: "Download cancelado." };
      if (cod === "rate_limited") return { ok: false, msg: "Já há um pedido de download aberto. Responda a ele e tente de novo." };
      if (cod === "too_large") return { ok: false, msg: "Arquivo grande demais para este destino. Tente o CSV." };
      // demais códigos: tenta o caminho do navegador
    }
  }
  try {
    const ext = nomeArquivo.split(".").pop() ?? "";
    const blob = dado instanceof Blob ? dado : new Blob([dado], { type: MIME[ext] ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, msg: `Download de ${nomeArquivo} iniciado.` };
  } catch {
    return { ok: false, msg: "Este visualizador não permite baixar arquivos." };
  }
}

export function nomeArquivo(rel: Relatorio, ctx: Ctx, ext: string, em: Date): string {
  const base = [
    "vigigen", rel.id, rel.porAgravo ? ctx.doenca : null,
    rel.id === "serie" ? (ctx.g === null ? "rn" : String(ctx.g)) : null,
    em.toISOString().slice(0, 10),
  ].filter(Boolean).join("_");
  return `${base}.${ext}`;
}
