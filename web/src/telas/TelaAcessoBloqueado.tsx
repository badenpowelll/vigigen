import { Marca, Nota } from "../componentes/basicos";
import { sair, type Situacao } from "../dados/auth";

const TEXTO: Record<string, { titulo: string; corpo: string; tentar: boolean }> = {
  desativado: {
    titulo: "Conta desativada",
    corpo: "O administrador desativou esta conta. A sessão foi encerrada. Fale com o administrador do VigiGen se precisar do acesso de volta.",
    tentar: false,
  },
  sem_perfil: {
    titulo: "Acesso não confirmado",
    corpo: "O login funcionou, mas esta conta não tem perfil no VigiGen. Fale com o administrador.",
    tentar: true,
  },
  sem_vinculo: {
    titulo: "Conta sem território",
    corpo: "Esta conta ainda não está ligada a nenhuma organização, então não há dado que ela possa ver. Fale com o administrador.",
    tentar: true,
  },
  erro: {
    titulo: "Não foi possível confirmar o acesso",
    corpo: "O banco não respondeu à consulta do seu perfil. Por segurança, o painel só abre depois dessa confirmação.",
    tentar: true,
  },
};

/** Sessão aberta, mas sem perfil ativo confirmado: o painel não abre. */
export function TelaAcessoBloqueado({ situacao, aoTentar }: { situacao: Situacao; aoTentar: () => void }) {
  const t = TEXTO[situacao] ?? TEXTO.erro;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-imd text-white">
        <div className="gutter mx-auto flex max-w-7xl items-center gap-3 py-3">
          <Marca variante="escuro" className="h-9 w-auto" />
          <h1 className="text-xl font-bold tracking-tight">VigiGen</h1>
        </div>
      </header>
      <main className="gutter mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <div className="cartao p-5 sm:p-6" role="alert">
          <h2 className="mb-2 text-lg font-bold">{t.titulo}</h2>
          <Nota tipo="aviso">{t.corpo}</Nota>
          <div className="mt-4 flex flex-wrap gap-2">
            {t.tentar && <button type="button" className="botao-primario" onClick={aoTentar}>Tentar de novo</button>}
            {situacao === "desativado"
              ? <button type="button" className="font-semibold text-[var(--destaque)] hover:underline" onClick={aoTentar}>Voltar ao login</button>
              : <button type="button" className="font-semibold text-[var(--destaque)] hover:underline" onClick={() => void sair()}>Sair</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
