// Testes do alerta de login e da redefinicao de senha do Hub (rodar: node --test tests/)
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SESSION_SECRET = "segredo-de-teste";
process.env.DISCORD_BOT_TOKEN = "bot-teste";
process.env.RESEND_API_KEY = "re_teste";
process.env.ALERTA_EMAIL_DE = "TSS <aviso@exemplo.com>";
process.env.SITE_URL = "https://exemplo.test";

const L = require("../api/_cofre.js");
const A = require("../api/_auth.js");
const AL = require("../api/_alerta.js");
const hub = require("../api/_hub.js");

const req = { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-vercel-ip-country": "BR", "x-vercel-ip-country-region": "BA", "x-vercel-ip-city": "Salvador" } };

function fetchFalso(registro, { falhaTudo = false } = {}) {
  return async (url, opts) => {
    registro.push({ url: String(url), opts });
    if (falhaTudo) throw new Error("rede caiu");
    if (String(url).startsWith("https://ipwho.is/")) return { ok: true, json: async () => ({ success: true, connection: { isp: "Provedor Teste Telecom" } }) };
    if (String(url).endsWith("/users/@me/channels")) return { ok: true, json: async () => ({ id: "canal1" }) };
    return { ok: true, json: async () => ({}) };
  };
}

function chamar(corpo) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
  return hub({ method: "POST", headers: {}, body: corpo }, res).then(() => out).catch((e) => ({ status: e.status, json: { erro: e.erro } }));
}

test("info de onde: regiao da Vercel + provedor + IP", async () => {
  const i = await AL.infoDeOnde(req, fetchFalso([]));
  assert.equal(i.ip, "203.0.113.9");
  assert.equal(i.cidade, "Salvador");
  assert.equal(i.regiao, "BA");
  assert.equal(i.provedor, "Provedor Teste Telecom");
});

test("aviso vai por DM e por e-mail com regiao, provedor, IP e link", async () => {
  const reg = [];
  const link = AL.linkDeRedefinicao("conta1", "s1$aa$bb");
  const r = await AL.avisarLogin({ req, discordId: "123456789012345678", email: "pessoa@exemplo.com", titulo: "Novo login", linkRedefinir: link, fetchFn: fetchFalso(reg) });
  assert.equal(r.dm, true); assert.equal(r.email, true); assert.equal(r.info.provedor, "Provedor Teste Telecom");
  const msg = reg.find((x) => x.url.endsWith("/channels/canal1/messages"));
  const corpo = JSON.parse(msg.opts.body).content;
  for (const t of ["Salvador", "Provedor Teste Telecom", "203.0.113.9", "https://exemplo.test/redefinir#t="]) assert.ok(corpo.includes(t), "faltou: " + t);
  const mail = reg.find((x) => x.url === "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(mail.opts.body).to, ["pessoa@exemplo.com"]);
});

test("sem e-mail so a DM sai; falha de rede nao lanca erro", async () => {
  const r = await AL.avisarLogin({ req, discordId: "123456789012345678", email: "", titulo: "x", fetchFn: fetchFalso([]) });
  assert.equal(r.dm, true); assert.equal(r.email, false);
  const r2 = await AL.avisarLogin({ req, discordId: "123456789012345678", email: "a@b.co", titulo: "x", fetchFn: fetchFalso([], { falhaTudo: true }) });
  assert.equal(r2.dm, false); assert.equal(r2.email, false);
});

test("redefinir: troca a senha uma vez so, e o link velho morre", async () => {
  const data = { contas: { u1: { hub_user: "ze", hub_hash: "s1$aa$bb" } }, pedidos: {}, keys: {}, reembolsos: {} };
  L.lerChaves = async () => ({ data, sha: "x" });
  L.mutar = async (fn) => { const o = await fn(data); return o.resultado; };
  const tok = AL.linkDeRedefinicao("u1", "s1$aa$bb").split("#t=")[1];
  assert.equal((await chamar({ acao: "redefinir", token: tok, senha: "senhaNova123" })).status, 200);
  assert.notEqual(data.contas.u1.hub_hash, "s1$aa$bb");
  assert.ok(data.contas.u1.hub_revogado);
  assert.equal((await chamar({ acao: "redefinir", token: tok, senha: "outraSenha456" })).status, 400);
  const novoTok = AL.linkDeRedefinicao("u1", data.contas.u1.hub_hash).split("#t=")[1];
  assert.equal((await chamar({ acao: "redefinir", token: novoTok, senha: "123" })).status, 400);
  assert.equal((await chamar({ acao: "redefinir", token: A.assinar({ tipo: "hub", uid: "u1", exp: Date.now() + 99999 }), senha: "senhaNova123" })).status, 400);
});

test("token do Hub emitido antes da redefinicao deixa de valer", async () => {
  const data = { contas: { u1: { hub_user: "ze", hub_hash: "s1$aa$bb", hub_revogado: new Date().toISOString() } }, pedidos: {}, keys: {}, reembolsos: {} };
  L.lerChaves = async () => ({ data, sha: "x" });
  const velho = A.assinar({ tipo: "hub", uid: "u1", usuario: "ze", iat: Date.now() - 60000, exp: Date.now() + 99999 });
  assert.equal((await chamar({ acao: "eu", token: velho })).status, 401);
});

test("botao de teste: precisa de sessao, manda DM e limita repeticoes", async () => {
  const authH = require("../api/auth.js");
  const origFetch = global.fetch;
  const reg = [];
  global.fetch = fetchFalso(reg);
  L.lerChaves = async () => ({ data: { contas: { u9: { hub_hash: "s1$aa$bb" } } }, sha: "x" });
  const cookie = (obj) => "tss_sess=" + encodeURIComponent(A.assinar(Object.assign({ tipo: "sess", exp: Date.now() + 99999 }, obj)));
  const chamarTeste = async (cabecalhos) => {
    const out = {};
    const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
    await authH({ method: "POST", query: { acao: "testar_alerta" }, headers: Object.assign({ "x-forwarded-for": "203.0.113.9" }, cabecalhos), body: {} }, res);
    return out;
  };
  try {
    assert.equal((await chamarTeste({})).status, 401);
    assert.equal((await chamarTeste({ cookie: cookie({ uid: "u9", nome: "Ze", prov: "discord" }) })).status, 409);
    const ok = await chamarTeste({ cookie: cookie({ uid: "u9", nome: "Ze", prov: "discord", did: "123456789012345678" }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.dm, true);
    assert.ok(reg.some((x) => x.url.endsWith("/channels/canal1/messages")));
    for (let i = 0; i < 4; i++) await chamarTeste({ cookie: cookie({ uid: "u9", nome: "Ze", prov: "discord", did: "123456789012345678" }) });
    assert.equal((await chamarTeste({ cookie: cookie({ uid: "u9", nome: "Ze", prov: "discord", did: "123456789012345678" }) })).status, 429);
  } finally { global.fetch = origFetch; }
});
