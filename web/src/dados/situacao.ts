// Regra pura de quem pode abrir o painel web (sem dependência do Supabase,
// para ser testada em web/tests/acesso.test.ts).

export interface Perfil {
  user_id: string;
  email: string;
  nome: string | null;
  administrador: boolean;
  ativo: boolean;
  vinculos: { papel: string; organizacao: string; tipo: string }[];
}

/**
 * Situação do acesso depois do login. Só "ok" abre o painel: sessão válida sem
 * perfil confirmado pelo banco não basta (auditoria de 14/11/2026).
 * - desativado: o administrador desativou a conta (a sessão aberta é encerrada)
 * - sem_perfil: o banco não devolveu perfil para este usuário
 * - sem_vinculo: perfil ativo, não administrador e sem organização (nada a ver)
 * - erro: a consulta ao perfil falhou (rede, banco); não abre por omissão
 */
export type Situacao = "carregando" | "sem_sessao" | "ok" | "desativado" | "sem_perfil" | "sem_vinculo" | "erro";

export function situacaoDoPerfil(p: Perfil | null, falhou: boolean): Exclude<Situacao, "carregando" | "sem_sessao"> {
  if (falhou) return "erro";
  if (!p || !p.user_id) return "sem_perfil";
  if (p.ativo !== true) return "desativado";
  if (!p.administrador && (!Array.isArray(p.vinculos) || p.vinculos.length === 0)) return "sem_vinculo";
  return "ok";
}

