// Auditoria de 14/11/2026: sessão válida sem perfil ativo confirmado não abre o painel.
// Perfis abaixo são fictícios (FIXTURE), só para teste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { situacaoDoPerfil, type Perfil } from "../src/dados/situacao";

const base: Perfil = {
  user_id: "f1000000-0000-4000-8000-000000000001", email: "FIXTURE_natal@vigigen.invalid", nome: "FIXTURE",
  administrador: false, ativo: true, vinculos: [{ papel: "leitura", organizacao: "FIXTURE_SMS Natal", tipo: "municipio" }],
};

test("perfil ativo com vínculo abre", () => assert.equal(situacaoDoPerfil(base, false), "ok"));
test("administrador sem vínculo abre", () =>
  assert.equal(situacaoDoPerfil({ ...base, administrador: true, vinculos: [] }, false), "ok"));
test("falha na consulta não abre, mesmo com perfil em memória", () => assert.equal(situacaoDoPerfil(base, true), "erro"));
test("perfil nulo não abre", () => assert.equal(situacaoDoPerfil(null, false), "sem_perfil"));
test("perfil sem user_id não abre", () =>
  assert.equal(situacaoDoPerfil({ ...base, user_id: "" }, false), "sem_perfil"));
test("conta desativada não abre", () => assert.equal(situacaoDoPerfil({ ...base, ativo: false }, false), "desativado"));
test("ativo ausente conta como desativado", () =>
  assert.equal(situacaoDoPerfil({ ...base, ativo: undefined as unknown as boolean }, false), "desativado"));
test("não administrador sem organização não abre", () =>
  assert.equal(situacaoDoPerfil({ ...base, vinculos: [] }, false), "sem_vinculo"));
