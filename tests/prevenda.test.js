// Testes da pre-venda (rodar: node --test tests/). Nada vai para a internet: GitHub e simulado.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GH_TOKEN = "token-de-teste";
process.env.KEY_SECRET = "segredo-de-teste";

const L = require("../api/_cofre.js");
const PRE = require("../api/_prevenda.js");
const AD = require("../api/_adminauth.js");
AD.exigirAdmin = async () => ({ id: "teste" }); // o login do admin tem teste proprio
const sentinela = require("../api/sentinela.js");
const admin = require("../api/admin.js");

let catalogo, cofre, puts;
function reset(extra) {
  catalogo = { games: [
    Object.assign({ id: "bigcity", name: "Big City", prevenda: true, lancamento: "2999-11-30T00:00" }, extra || {}),
    { id: "backrooms", name: "Backrooms" },
  ] };
  cofre = { keys: {}, pedidos: {}, log: [] };
  puts = 0;
}
global.fetch = async (url, opt) => {
  url = String(url);
  if (url.includes("/contents/public/catalog.json")) return { ok: true, status: 200, json: async () => catalogo };
  if (url.includes("/contents/chaves.json")) {
    if (opt && opt.method === "PUT") {
      cofre = JSON.parse(Buffer.from(JSON.parse(opt.body).content, "base64").toString("utf8")); puts++;
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ content: Buffer.from(JSON.stringify(cofre)).toString("base64"), sha: "s" + puts }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

function chamar(handler, corpo) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
  return handler({ method: "POST", headers: {}, body: corpo }, res).then(() => out);
}
const pegarCodigo = async () => (await chamar(admin, { acao: "prevenda_codigo", jogo: "bigcity" })).json;

test("lancamentoISO: Brasilia vira UTC; data impossivel e lixo viram vazio", () => {
  assert.equal(PRE.lancamentoISO("2026-11-30T00:00"), "2026-11-30T03:00:00.000Z");
  assert.equal(PRE.lancamentoISO("2026-11-30"), "2026-11-30T03:00:00.000Z");
  assert.equal(PRE.lancamentoISO("2026-12-31T23:30"), "2027-01-01T02:30:00.000Z");
  for (const x of ["amanha", "", "2026-02-31", "2026-13-01", "2026-11-30T25:00", undefined]) assert.equal(PRE.lancamentoISO(x), "", String(x));
});

test("estado: libera sozinho quando a data chega (hora do servidor)", () => {
  const g = { prevenda: true, lancamento: "2026-11-30T00:00" };
  assert.equal(PRE.estado(g, Date.parse("2026-11-30T02:59:59Z")).prevenda, true);
  const dep = PRE.estado(g, Date.parse("2026-11-30T03:00:00Z"));
  assert.equal(dep.prevenda, false);
  assert.equal(dep.liberado_por_data, true);
  assert.equal(PRE.estado({ prevenda: true }, Date.now()).prevenda, true); // sem data: so o codigo libera
  assert.equal(PRE.estado({}, Date.now()).prevenda, false);
});

test("admin: ver codigo e estavel; so o hash vai para o cofre; novo codigo invalida o antigo", async () => {
  reset();
  const a = await pegarCodigo();
  assert.equal(a.ok, true);
  assert.match(a.codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const b = await pegarCodigo();
  assert.equal(b.codigo, a.codigo);
  assert.equal(puts, 1, "ver de novo nao regrava");
  assert.ok(!JSON.stringify(cofre).includes(a.codigo), "o codigo em si nunca fica no cofre");
  const n = (await chamar(admin, { acao: "prevenda_novo_codigo", jogo: "bigcity" })).json;
  assert.notEqual(n.codigo, a.codigo);
  assert.equal((await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: a.codigo })).status, 403);
  assert.equal((await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: n.codigo })).status, 200);
});

test("admin: jogo com id estranho e recusado", async () => {
  reset();
  assert.equal((await chamar(admin, { acao: "prevenda_codigo", jogo: "../x" })).status, 400);
});

test("status: mostra pre-venda, lancamento e hora do servidor, sem expor o codigo", async () => {
  reset();
  const c = await pegarCodigo();
  const r = await chamar(sentinela, { acao: "prevenda_status", jogo: "bigcity" });
  assert.equal(r.status, 200);
  assert.equal(r.json.prevenda, true);
  assert.equal(r.json.lancamento, "2999-11-30T03:00:00.000Z");
  assert.ok(Date.parse(r.json.agora) > 0);
  const txt = JSON.stringify(r.json);
  assert.ok(!txt.includes(c.codigo) && !txt.includes(L.sha(L.norm(c.codigo))));
});

test("codigo certo libera (minusculo, com espaco, sem tracos)", async () => {
  reset();
  const c = (await pegarCodigo()).codigo;
  for (const x of [c, c.toLowerCase(), c.replace(/-/g, " "), c.replace(/-/g, "")]) {
    const r = await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: x });
    assert.equal(r.status, 200, x);
    assert.equal(r.json.liberado, true, x);
  }
});

test("codigo errado, curto, vazio ou de outro jogo nao libera", async () => {
  reset();
  await pegarCodigo();
  for (const x of ["ZZZZ-ZZZZ-ZZZZ", "123", "", undefined, null]) {
    const r = await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: x });
    assert.equal(r.status, 403);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.codigo, "codigo_invalido");
  }
});

test("sem codigo criado pelo admin, ninguem libera", async () => {
  reset();
  const r = await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: "ABCD-EFGH-JKLM" });
  assert.equal(r.status, 403);
  assert.equal(r.json.codigo, "nao_liberado");
});

test("depois da data de lancamento o jogo abre sem codigo; pre-venda desligada tambem", async () => {
  reset({ lancamento: "2020-01-01T00:00" });
  assert.equal((await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity" })).json.liberado, true);
  reset({ prevenda: false });
  const s = await chamar(sentinela, { acao: "prevenda_status", jogo: "bigcity" });
  assert.equal(s.json.prevenda, false);
  assert.equal((await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity" })).json.liberado, true);
});

test("jogo que nao existe, id estranho e metodo errado", async () => {
  reset();
  assert.equal((await chamar(sentinela, { acao: "prevenda_status", jogo: "nao-existe" })).status, 404);
  assert.equal((await chamar(sentinela, { acao: "prevenda_status", jogo: "../x" })).status, 400);
  const out = {}; const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
  await sentinela({ method: "GET", body: {} }, res);
  assert.equal(out.status, 405);
});

test("catalogo fora do ar nao libera ninguem", async () => {
  reset();
  const real = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await chamar(sentinela, { acao: "prevenda_verificar", jogo: "bigcity", codigo: "ABCD-EFGH-JKLM" });
  global.fetch = real;
  assert.notEqual(r.status, 200);
  assert.ok(!(r.json && r.json.liberado));
});

test("acoes antigas da sentinela seguem iguais (pedido invalido continua invalido)", async () => {
  reset();
  assert.equal((await chamar(sentinela, { acao: "ativar", jogo: "bigcity", maquina: "x", chave: "AAAA" })).status, 400);
  assert.equal((await chamar(sentinela, { acao: "qualquer", jogo: "bigcity" })).status, 400);
});

test("cofre antigo (sem o campo prevenda) ganha o campo vazio", async () => {
  reset();
  const { data } = await L.lerChaves();
  assert.deepEqual(data.prevenda, {});
});
