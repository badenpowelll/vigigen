// Usado por tests/test_demas.py: aplica a agregação da Edge Function
// (supabase/functions/_shared/sinan.ts) às fixtures reais e imprime o resultado,
// para comparar com a agregação do CLI Python.
import { corpoAgregado } from "../../supabase/functions/_shared/sinan.ts";

const saida: Record<string, unknown> = {};
for (const arq of Deno.args) {
  const f = JSON.parse(await Deno.readTextFile(arq));
  saida[arq] = corpoAgregado("teste", f.registros);
}
console.log(JSON.stringify(saida));
