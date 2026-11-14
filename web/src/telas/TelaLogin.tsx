import { useState, type FormEvent, type ReactNode } from "react";
import { Marca, Nota } from "../componentes/basicos";
import { entrar, usarCodigo } from "../dados/auth";

type Modo = "entrar" | "codigo";

export function TelaLogin() {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aoEntrar(e: FormEvent) {
    e.preventDefault();
    setErro(null); setOcupado(true);
    setErro(await entrar(email, senha));
    setOcupado(false);
  }

  async function aoUsarCodigo(e: FormEvent) {
    e.preventDefault();
    setErro(null); setOk(null);
    if (senha !== senha2) { setErro("As duas senhas não são iguais."); return; }
    setOcupado(true);
    const falha = await usarCodigo(email.trim().toLowerCase(), codigo, senha);
    if (falha) { setErro(falha); setOcupado(false); return; }
    setOk("Senha definida. Entrando…");
    setErro(await entrar(email, senha));
    setOcupado(false);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-imd text-white">
        <div className="gutter mx-auto flex max-w-7xl items-center gap-3 py-3">
          <Marca variante="escuro" className="h-9 w-auto" />
          <div className="leading-tight">
            <h1 className="text-xl font-bold tracking-tight">VigiGen</h1>
            <p className="text-[0.8rem] text-white/80">Vigilância genômica de arboviroses · Rio Grande do Norte</p>
          </div>
        </div>
      </header>
      <main className="gutter mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <div className="cartao p-5 sm:p-6">
          <h2 className="mb-1 text-lg font-bold">{modo === "entrar" ? "Entrar" : "Primeiro acesso ou nova senha"}</h2>
          <p className="mb-4 text-sm text-suave">
            {modo === "entrar"
              ? "Acesso restrito a usuários convidados pela administração do VigiGen."
              : "Use o código de uso único que a administração do VigiGen passou para você e escolha a sua senha."}
          </p>
          <form onSubmit={modo === "entrar" ? aoEntrar : aoUsarCodigo} className="flex flex-col gap-3">
            <Campo rotulo="E-mail">
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="entrada" />
            </Campo>
            {modo === "codigo" && (
              <Campo rotulo="Código de acesso">
                <input required autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX" value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase())} className="entrada num tracking-widest" />
              </Campo>
            )}
            <Campo rotulo={modo === "entrar" ? "Senha" : "Nova senha (mínimo 10 caracteres)"}>
              <input type="password" required minLength={modo === "codigo" ? 10 : undefined}
                autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                value={senha} onChange={(e) => setSenha(e.target.value)} className="entrada" />
            </Campo>
            {modo === "codigo" && (
              <Campo rotulo="Repita a nova senha">
                <input type="password" required minLength={10} autoComplete="new-password" value={senha2}
                  onChange={(e) => setSenha2(e.target.value)} className="entrada" />
              </Campo>
            )}
            {erro && <p role="alert" className="text-sm font-semibold" style={{ color: "var(--estado-4-texto)" }}>{erro}</p>}
            {ok && <p role="status" className="text-sm font-semibold" style={{ color: "var(--estado-1-texto)" }}>{ok}</p>}
            <button type="submit" disabled={ocupado} className="botao-primario">
              {ocupado ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Definir senha e entrar"}
            </button>
          </form>
          <div className="mt-4 border-t border-borda pt-3 text-sm">
            {modo === "entrar" ? (
              <button className="font-semibold text-[var(--destaque)] hover:underline" onClick={() => { setModo("codigo"); setErro(null); }}>
                Recebi um código de acesso / esqueci a senha
              </button>
            ) : (
              <button className="font-semibold text-[var(--destaque)] hover:underline" onClick={() => { setModo("entrar"); setErro(null); }}>
                Já tenho senha: entrar
              </button>
            )}
          </div>
        </div>
        <div className="mt-4"><Nota>Seu acesso fica registrado (data, hora, IP e navegador) para auditoria do sistema.</Nota></div>
      </main>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="rotulo">{rotulo}</span>
      {children}
    </label>
  );
}
