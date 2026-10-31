// Testes da logica de cupons (rodar: node --test tests/)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../api/_cofre.js");

const hoje = new Date();
const dia = (n) => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10);
const dados = (cupons) => ({ cupons });
const base = { tipo: "percent", valor: 10, jogo: "", ate: "", max_usos: 0, usos: 0, ativo: true };

test("percentual: 10% de R$ 4,50", () => {
  const r = L.calcularCupom(dados({ OFF10: { ...base } }), "off10", "backrooms", 4.5);
  assert.equal(r.codigo, "OFF10");
  assert.equal(r.preco_final, 4.05);
  assert.equal(r.desconto, 0.45);
});

test("fixo: R$ 1,50 a menos", () => {
  const r = L.calcularCupom(dados({ MENOS: { ...base, tipo: "fixo", valor: 1.5 } }), "MENOS", "backrooms", 4.5);
  assert.equal(r.preco_final, 3);
});

test("expirado: rejeita; valido ate hoje: aceita", () => {
  assert.throws(() => L.calcularCupom(dados({ VELHO: { ...base, ate: dia(-2) } }), "VELHO", "backrooms", 4.5), /expirou/);
  assert.ok(L.calcularCupom(dados({ HOJE: { ...base, ate: dia(0) } }), "HOJE", "backrooms", 4.5));
});

test("desligado: rejeita", () => {
  assert.throws(() => L.calcularCupom(dados({ OFF: { ...base, ativo: false } }), "OFF", "backrooms", 4.5), /invalido/);
});

test("esgotado: usos >= max_usos rejeita; com vaga aceita", () => {
  assert.throws(() => L.calcularCupom(dados({ UM: { ...base, max_usos: 1, usos: 1 } }), "UM", "backrooms", 4.5), /limite/);
  assert.ok(L.calcularCupom(dados({ DOIS: { ...base, max_usos: 2, usos: 1 } }), "DOIS", "backrooms", 4.5));
});

test("cupom de outro jogo: rejeita; do mesmo jogo: aceita", () => {
  assert.throws(() => L.calcularCupom(dados({ ASH: { ...base, jogo: "ashfall" } }), "ASH", "backrooms", 4.5), /nao vale/);
  assert.ok(L.calcularCupom(dados({ ASH: { ...base, jogo: "ashfall" } }), "ASH", "ashfall", 1.25));
});

test("preco minimo R$ 1,00", () => {
  const r = L.calcularCupom(dados({ GRANDE: { ...base, tipo: "fixo", valor: 100 } }), "GRANDE", "backrooms", 4.5);
  assert.equal(r.preco_final, 1);
  const p = L.calcularCupom(dados({ TOTAL: { ...base, valor: 99 } }), "TOTAL", "backrooms", 4.5);
  assert.equal(p.preco_final, 1);
});

test("sem desconto real (jogo ja custa R$ 1,00): rejeita", () => {
  assert.throws(() => L.calcularCupom(dados({ OFF10: { ...base } }), "OFF10", "x", 1), /nao gera desconto/);
});

test("codigo inexistente rejeita; vazio devolve null", () => {
  assert.throws(() => L.calcularCupom(dados({}), "NAO", "backrooms", 4.5), /invalido/);
  assert.equal(L.calcularCupom(dados({}), "", "backrooms", 4.5), null);
});

test("precoEsperado: usa o preco gravado pelo servidor quando ha cupom", () => {
  assert.equal(L.precoEsperado({ metadata: { cupom: "OFF10", preco_final: 4.05 } }, 4.5), 4.05);
});

test("precoEsperado: metadado forjado ou incoerente volta ao preco do catalogo", () => {
  assert.equal(L.precoEsperado({ metadata: { preco_final: 1 } }, 4.5), 4.5, "sem cupom nao vale");
  assert.equal(L.precoEsperado({ metadata: { cupom: "X", preco_final: 0.01 } }, 4.5), 4.5, "abaixo de R$ 1,00");
  assert.equal(L.precoEsperado({ metadata: { cupom: "X", preco_final: 9 } }, 4.5), 4.5, "maior que o preco");
  assert.equal(L.precoEsperado({ metadata: { cupom: "X", preco_final: "abc" } }, 4.5), 4.5, "nao numerico");
  assert.equal(L.precoEsperado({}, 4.5), 4.5);
  assert.equal(L.precoEsperado(null, 4.5), 4.5);
});

test("confirmacao: quem pagou menos que o esperado e recusado, quem pagou com cupom e aceito", () => {
  const ok = (pay, preco, pago) => pago + 0.005 >= L.precoEsperado(pay, preco); // mesma regra de compra.js e confirmar-pagamento.js
  const comCupom = { metadata: { cupom: "OFF10", preco_final: 4.05 } };
  assert.equal(ok(comCupom, 4.5, 4.05), true);
  assert.equal(ok(comCupom, 4.5, 4.04), false);
  assert.equal(ok({ metadata: {} }, 4.5, 4.05), false);
  assert.equal(ok({ metadata: {} }, 4.5, 4.5), true);
});
