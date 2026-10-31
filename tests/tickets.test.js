// Testes dos tickets e dos comandos novos do bot (Discord e cofre simulados; nada vai para a internet).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const handler = require("../api/jogo.js");

const par = crypto.generateKeyPairSync("ed25519");
const pubHex = par.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const assinar = (ts, corpo) => crypto.sign(null, Buffer.concat([Buffer.from(ts), Buffer.from(corpo)]), par.privateKey).toString("hex");

const ADMIN = "111111111111111111", MEMBRO = "222222222222222222", OUTRO = "333333333333333333";
const GUILD = "444444444444444444", CAT = "555555555555555555", CANAL = "666666666666666666", CARGO = "777777777777777777", APP = "888888888888888888";
process.env.DISCORD_PUBLIC_KEY = pubHex; process.env.DISCORD_ADMIN_IDS = ADMIN;
process.env.DISCORD_BOT_TOKEN = "token-falso"; process.env.GH_TOKEN = "gh-falso"; process.env.KEY_SECRET = "segredo-de-teste";

// ---- Discord e GitHub (cofre) falsos
let chamadas, canais, cofre, cofreSha;
function reset() {
  chamadas = []; canais = [];
  cofre = { keys: { [crypto.createHash("sha256").update("AAAAABBBBBCCCCCDDDDD").digest("hex")]: { jogo: "backrooms", max: 2, maquinas: ["pc1"] } }, pedidos: { ped1: { jogo: "backrooms", preco: 4.5, criado: "2026-10-29T10:00:00Z", origem: "mercadopago", h: crypto.createHash("sha256").update("AAAAABBBBBCCCCCDDDDD").digest("hex") } }, log: [], contas: {}, reembolsos: {}, cupons: { BACK3: { tipo: "percent", valor: 10, usos: 1 } } };
  cofreSha = 1;
}
global.fetch = async (url, opt = {}) => {
  const u = String(url), m = opt.method || "GET", corpo = opt.body ? JSON.parse(opt.body) : undefined;
  const ok = (j, s = 200) => ({ ok: s < 400, status: s, json: async () => j, text: async () => JSON.stringify(j) });
  if (u.includes("/contents/chaves.json")) {
    if (m === "GET") return ok({ sha: "s" + cofreSha, content: Buffer.from(JSON.stringify(cofre)).toString("base64") });
    cofre = JSON.parse(Buffer.from(corpo.content, "base64").toString("utf8")); cofreSha++; return ok({});
  }
  chamadas.push({ m, u, corpo });
  if (m === "GET" && u.endsWith("/guilds/" + GUILD + "/channels")) return ok(canais);
  if (m === "POST" && u.endsWith("/guilds/" + GUILD + "/channels")) { const c = { id: "9" + String(canais.length + 1).padStart(17, "0"), name: corpo.name, topic: corpo.topic, parent_id: corpo.parent_id, permission_overwrites: corpo.permission_overwrites }; canais.push(c); return ok(c); }
  if (m === "POST" && u.includes("/messages")) return ok({ id: "1" });
  if (m === "GET" && u.includes("/channels/")) return ok(canais.find((c) => u.endsWith("/channels/" + c.id)) || {});
  if (m === "PATCH") { const c = canais.find((x) => u.endsWith("/channels/" + x.id)); Object.assign(c, corpo); return ok(c); }
  return ok({}, 404);
};

function chamar(obj) {
  const corpo = JSON.stringify(obj), ts = "1700000000";
  const req = { method: "POST", query: { discord: "1" }, headers: { "x-signature-ed25519": assinar(ts, corpo), "x-signature-timestamp": ts }, rawBody: Buffer.from(corpo) };
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; }, send(b) { out.body = b; return res; }, end() { return res; }, setHeader() {} };
  return Promise.resolve(handler(req, res)).then(() => out);
}
const cmd = (uid, name, options) => ({ type: 2, guild_id: GUILD, application_id: APP, member: { user: { id: uid, username: "Fulano" } }, data: { name, options } });
const clique = (uid, custom_id, extra = {}) => Object.assign({ type: 3, guild_id: GUILD, application_id: APP, channel_id: "999999999999999999", member: { user: { id: uid, username: "Joao Álvaro" }, roles: [], permissions: "0" }, data: { custom_id } }, extra);
const BOTAO = "tk:abrir:" + CAT + ":" + CARGO;

test("/gerar-ticket: so admin; envia o painel com botao e config no custom_id", async () => {
  reset();
  const opts = [{ name: "canal", value: CANAL }, { name: "categoria", value: CAT }, { name: "cargo1", value: CARGO }];
  const neg = await chamar(cmd(MEMBRO, "gerar-ticket", opts));
  assert.match(neg.body.data.content, /permiss/); assert.equal(chamadas.length, 0);
  const r = await chamar(cmd(ADMIN, "gerar-ticket", opts));
  assert.match(r.body.data.content, /Painel de tickets enviado/);
  const msg = chamadas.find((c) => c.u.endsWith("/channels/" + CANAL + "/messages"));
  assert.equal(msg.corpo.components[0].components[0].custom_id, BOTAO);
  assert.match(msg.corpo.embeds[0].description, /Reembolso[\s\S]*Recuperação de conta[\s\S]*Ajuda[\s\S]*Informação/);
});

test("botao Criar ticket: qualquer membro ve o menu com os 4 motivos (efemero)", async () => {
  reset();
  const r = await chamar(clique(MEMBRO, BOTAO));
  assert.equal(r.body.type, 4); assert.equal(r.body.data.flags, 64);
  const o = r.body.data.components[0].components[0].options;
  assert.deepEqual(o.map((x) => x.value), ["reembolso", "recuperacao", "ajuda", "informacao"]);
});

test("escolher o motivo cria canal privado na categoria; dono + cargo veem, @everyone nao", async () => {
  reset();
  const r = await chamar(clique(MEMBRO, "tk:motivo:" + CAT + ":" + CARGO, { data: { custom_id: "tk:motivo:" + CAT + ":" + CARGO, values: ["reembolso"] } }));
  assert.match(r.body.data.content, /Ticket criado: <#9/);
  const c = canais[0];
  assert.equal(c.parent_id, CAT); assert.equal(c.name, "reembolso-joao-alvaro");
  assert.match(c.topic, new RegExp("^tss-ticket:" + MEMBRO + ":" + CARGO + ":reembolso"));
  const por = (id) => c.permission_overwrites.find((x) => x.id === id);
  assert.equal(por(GUILD).deny, "1024"); assert.equal(por(MEMBRO).allow, "117760"); assert.equal(por(CARGO).allow, "117760"); assert.equal(por(APP).allow, "117760");
  const boas = chamadas.find((x) => x.u.endsWith("/channels/" + c.id + "/messages"));
  assert.equal(boas.corpo.components[0].components[0].custom_id, "tk:fechar");
});

test("segundo ticket do mesmo membro e barrado; motivo invalido e config invalida dao erro amigavel", async () => {
  reset();
  const id = "tk:motivo:" + CAT + ":" + CARGO, abrir = (u, v, cid = id) => chamar(clique(u, cid, { data: { custom_id: cid, values: [v] } }));
  await abrir(MEMBRO, "ajuda");
  const dup = await abrir(MEMBRO, "ajuda"); assert.match(dup.body.data.content, /já tem um ticket aberto/); assert.equal(canais.length, 1);
  assert.match((await abrir(OUTRO, "hack")).body.data.content, /Motivo inválido/);
  assert.match((await abrir(OUTRO, "ajuda", "tk:motivo:abc:def")).body.data.content, /configuração inválida/);
  assert.equal(canais.length, 1);
});

test("fechar ticket: estranho e negado; dono fecha e perde acesso; equipe (cargo) tambem fecha", async () => {
  reset();
  const id = "tk:motivo:" + CAT + ":" + CARGO;
  await chamar(clique(MEMBRO, id, { data: { custom_id: id, values: [ "ajuda" ] } }));
  const c = canais[0], fechar = (u, mem = {}) => chamar(clique(u, "tk:fechar", { channel_id: c.id, member: Object.assign({ user: { id: u }, roles: [], permissions: "0" }, mem) }));
  assert.match((await fechar(OUTRO)).body.data.content, /Só quem abriu/);
  assert.ok(!c.name.startsWith("fechado-"));
  const ok = await fechar(MEMBRO);
  assert.equal(ok.body.type, 7); assert.match(ok.body.data.content, /Ticket fechado/);
  assert.ok(c.name.startsWith("fechado-"));
  assert.equal(c.permission_overwrites.find((x) => x.id === MEMBRO).deny, "1024");
  assert.equal(c.permission_overwrites.find((x) => x.id === CARGO).allow, "117760");
  assert.equal((await fechar(OUTRO, { roles: [CARGO] })).body.type, 7);
});

test("canal comum (sem topico de ticket) nao pode ser 'fechado' pelo botao", async () => {
  reset(); canais.push({ id: "123456789012345678", name: "geral", topic: "", permission_overwrites: [] });
  const r = await chamar(clique(ADMIN, "tk:fechar", { channel_id: "123456789012345678" }));
  assert.match(r.body.data.content, /não é um ticket/);
});

test("comandos novos: revogar/reativar/liberar por chave completa ou ID curto, pedido, cupons, cupom-apagar", async () => {
  reset();
  const h = Object.keys(cofre.keys)[0], op = (name, options) => chamar(cmd(ADMIN, name, options)).then((r) => r.body.data.content);
  assert.match(await op("revogar", [{ name: "chave", value: "AAAAA-BBBBB-CCCCC-DDDDD" }]), /revogada/); assert.equal(cofre.keys[h].revogada, true);
  assert.match(await op("reativar", [{ name: "chave", value: h.slice(0, 12) }]), /reativada/); assert.equal(cofre.keys[h].revogada, undefined);
  assert.match(await op("liberar", [{ name: "chave", value: "aaaaabbbbbcccccddddd" }]), /liberados/); assert.deepEqual(cofre.keys[h].maquinas, []);
  assert.match(await op("revogar", [{ name: "chave", value: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" }]), /nao encontrada/);
  const ped = await op("pedido", [{ name: "id", value: "PED1" }]); assert.match(ped, /backrooms/); assert.match(ped, /R\$ 4,50/); assert.match(ped, /ativa/);
  assert.match(await op("pedido", [{ name: "id", value: "nao-existe" }]), /nao encontrado/);
  assert.match(await op("cupons"), /BACK3/);
  assert.match(await op("cupom-apagar", [{ name: "codigo", value: "back3" }]), /apagado/); assert.equal(cofre.cupons.BACK3, undefined);
  assert.match(await op("cupom-apagar", [{ name: "codigo", value: "back3" }]), /nao existe/);
});

test("os comandos novos continuam bloqueados para quem nao e admin", async () => {
  reset();
  for (const n of ["revogar", "reativar", "liberar", "pedido", "cupons", "cupom-apagar"]) assert.match((await chamar(cmd(MEMBRO, n, []))).body.data.content, /permiss/);
  assert.equal(cofre.keys[Object.keys(cofre.keys)[0]].revogada, undefined);
});

test("COMANDOS: nomes validos, sem repeticao, opcoes obrigatorias antes das opcionais, limite do Discord", () => {
  const { COMANDOS } = require("../api/_discord.js");
  const nomes = COMANDOS.map((c) => c.name);
  assert.equal(new Set(nomes).size, nomes.length); assert.ok(nomes.length <= 100);
  for (const c of COMANDOS) {
    assert.match(c.name, /^[a-z0-9_-]{1,32}$/); assert.ok(c.description.length >= 1 && c.description.length <= 100);
    let viuOpcional = false;
    for (const o of c.options || []) { assert.ok(o.description.length <= 100); if (!o.required) viuOpcional = true; else assert.equal(viuOpcional, false, c.name + ": obrigatoria depois de opcional"); }
  }
  assert.ok(("tk:abrir:" + CAT + ":" + [CARGO, CARGO, CARGO].join(",")).length <= 100);
});
