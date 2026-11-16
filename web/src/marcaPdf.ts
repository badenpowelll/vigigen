// Logomarca Hélice-pulso desenhada em vetor no jsPDF (mesma geometria de
// componentes/basicos.tsx › Marca e de public/logo-marca.svg, viewBox 0 0 120 64).
// Vetor, sem imagem: fica nítida em qualquer zoom e não depende de canvas.
import type { jsPDF } from "jspdf";

type P = [number, number];
type Seg = { tipo: "L"; p: P } | { tipo: "C"; c1: P; c2: P; p: P };
interface Traco { inicio: P; segs: Seg[]; cor: string; largura: number; opacidade?: number }

export const MARCA_CORES = { id1: "#2670e8", barras: "#9CC3EE", id2: "#eb6834" } as const;

/** Traços da marca, em coordenadas do viewBox 120×64. */
export const TRACOS_MARCA: Traco[] = [
  { inicio: [18, 23], segs: [{ tipo: "L", p: [18, 41] }], cor: MARCA_CORES.barras, largura: 4.5 },
  { inicio: [42, 23], segs: [{ tipo: "L", p: [42, 41] }], cor: MARCA_CORES.barras, largura: 4.5 },
  { inicio: [6, 32], cor: MARCA_CORES.id1, largura: 6.5, segs: [
    { tipo: "C", c1: [8, 15], c2: [28, 15], p: [30, 32] },
    { tipo: "C", c1: [32, 49], c2: [52, 49], p: [54, 32] },
    { tipo: "C", c1: [52, 15], c2: [32, 15], p: [30, 32] },
    { tipo: "C", c1: [28, 49], c2: [8, 49], p: [6, 32] },
  ] },
  { inicio: [54, 32], cor: MARCA_CORES.id2, largura: 6.5, segs: [
    { tipo: "L", p: [61, 32] }, { tipo: "L", p: [68, 7] }, { tipo: "L", p: [77, 57] },
    { tipo: "L", p: [83, 32] }, { tipo: "L", p: [113, 32] },
  ] },
];

/** Converte os segmentos absolutos no formato relativo do jsPDF.lines(). */
export function relativos(t: Traco): number[][] {
  let a = t.inicio;
  return t.segs.map((s) => {
    const r = s.tipo === "L"
      ? [s.p[0] - a[0], s.p[1] - a[1]]
      : [s.c1[0] - a[0], s.c1[1] - a[1], s.c2[0] - a[0], s.c2[1] - a[1], s.p[0] - a[0], s.p[1] - a[1]];
    a = s.p;
    return r;
  });
}

/** Desenha a marca com o canto superior esquerdo em (x, y) e a altura pedida (pt). Devolve a largura usada. */
export function desenharMarca(doc: jsPDF, x: number, y: number, altura: number): number {
  const k = altura / 64;
  doc.saveGraphicsState();
  doc.setLineCap("round").setLineJoin("round");
  for (const t of TRACOS_MARCA) {
    doc.setDrawColor(t.cor).setLineWidth(t.largura * k);
    doc.lines(relativos(t), x + t.inicio[0] * k, y + t.inicio[1] * k, [k, k], "S", false);
  }
  doc.restoreGraphicsState();
  return 120 * k;
}

const AZUL: [number, number, number] = [19, 81, 180]; // --blue-warm-vivid-70 do gov.br DS

/** Altura reservada no topo e na base de cada página para cabeçalho e rodapé. */
export const MARGEM_CABECALHO = 56;
export const MARGEM_RODAPE = 50;

/**
 * Cabeçalho e rodapé com a logomarca em TODAS as páginas, e o carimbo de quem
 * imprimiu e quando (regras do Baden, 14/11/2026). Chamar depois de montar o
 * documento, para saber o total de páginas.
 */
export function cabecalhoERodape(doc: jsPDF, carimbo: string, fonte: string) {
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    // cabeçalho
    const w = desenharMarca(doc, 40, 14, 30);
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...AZUL);
    doc.text("VigiGen", 40 + w + 8, 30);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90);
    doc.text("Vigilância genômica de arboviroses · Rio Grande do Norte", 40 + w + 8, 41);
    doc.setDrawColor(...AZUL).setLineWidth(1);
    doc.line(40, 50, larg - 40, 50);
    // rodapé
    doc.setDrawColor(200).setLineWidth(0.5);
    doc.line(40, alt - 42, larg - 40, alt - 42);
    const wr = desenharMarca(doc, 40, alt - 37, 16);
    const xt = 40 + wr + 6;
    const lim = larg - 40 - xt - 70;
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(60);
    doc.text(doc.splitTextToSize(carimbo, lim)[0] as string, xt, alt - 29);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize(fonte, lim)[0] as string, xt, alt - 19);
    doc.text(`Página ${i} de ${total}`, larg - 40, alt - 19, { align: "right" });
  }
}
