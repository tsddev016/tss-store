// Testes da moderacao (Discord simulado; nada vai para a internet).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const handler = require("../api/jogo.js");

const par = crypto.generateKeyPairSync("ed25519");
const pubHex = par.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const assinar = (ts, corpo) => crypto.sign(null, Buffer.concat([Buffer.from(ts), Buffer.from(corpo)]), par.privateKey).toString("hex");
const ADMIN = "111111111111111111", MEMBRO = "222222222222222222", ALVO = "333333333333333333";
const GUILD = "444444444444444444", CANAL = "555555555555555555", APP = "888888888888888888", ALERTAS = "666666666666666666";
const R1 = "100000000000000001", R2 = "100000000000000002", R3 = "100000000000000003", RSTAFF = "100000000000000004", RBOT = "100000000000000005";
process.env.DISCORD_PUBLIC_KEY = pubHex; process.env.DISCORD_ADMIN_IDS = ADMIN; process.env.DISCORD_BOT_TOKEN = "token-falso";

let chamadas, membroRoles, regras, overwrites;
const reset = () => { chamadas = []; membroRoles = []; regras = []; overwrites = []; };
global.fetch = async (url, opt = {}) => {
  const u = String(url).replace("https://discord.com/api/v10", ""), m = opt.method || "GET", corpo = opt.body ? JSON.parse(opt.body) : undefined;
  const ok = (j, s = 200) => ({ ok: s < 400, status: s, text: async () => (j === undefined ? "" : JSON.stringify(j)) });
  chamadas.push({ m, u, corpo, h: opt.headers });
  if (m === "GET" && u === "/guilds/" + GUILD + "/roles") return ok([{ id: GUILD, name: "@everyone" }, { id: R1, name: "⚠️ Aviso 1" }, { id: R2, name: "⚠️ Aviso 2" }, { id: R3, name: "⚠️ Aviso 3" }, { id: RSTAFF, name: "⭐ Staff" }, { id: RBOT, name: "Staff Bot", managed: true }]);
  if (m === "GET" && u === "/guilds/" + GUILD + "/members/" + ALVO) return ok({ roles: membroRoles.slice() });
  if (m === "PUT" && u.includes("/members/" + ALVO + "/roles/")) { membroRoles.push(u.split("/").pop()); return ok(undefined, 204); }
  if (m === "DELETE" && u.includes("/members/" + ALVO + "/roles/")) { const r = u.split("/").pop(); membroRoles = membroRoles.filter((x) => x !== r); return ok(undefined, 204); }
  if (m === "GET" && u.startsWith("/channels/" + CANAL + "/messages")) { const agora = Date.now(); const id = (t) => String((BigInt(t - 1420070400000) << 22n)); return ok([{ id: id(agora - 1000) }, { id: id(agora - 2000) }, { id: id(agora - 20 * 86400000) }, { id: id(agora - 3000), pinned: true }]); }
  if (m === "GET" && u === "/channels/" + CANAL) return ok({ permission_overwrites: overwrites });
  if (m === "GET" && u === "/guilds/" + GUILD + "/auto-moderation/rules") return ok(regras);
  if (m === "POST" && u === "/guilds/" + GUILD + "/auto-moderation/rules") { if (corpo.trigger_type === 3) return ok({ message: "Maximum number of rules of this type exceeded" }, 400); regras.push({ id: "9" + regras.length, name: corpo.name, enabled: true }); return ok({}); }
  return ok({});
};

function chamar(obj) {
  const corpo = JSON.stringify(obj), ts = "1700000000";
  const req = { method: "POST", query: { discord: "1" }, headers: { "x-signature-ed25519": assinar(ts, corpo), "x-signature-timestamp": ts }, rawBody: Buffer.from(corpo) };
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; }, send(b) { out.body = b; return res; }, end() { return res; }, setHeader() {} };
  return Promise.resolve(handler(req, res)).then(() => out);
}
const cmd = (uid, name, options) => chamar({ type: 2, guild_id: GUILD, channel_id: CANAL, application_id: APP, member: { user: { id: uid } }, data: { name, options } }).then((r) => r.body.data.content);
const o = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value }));
const achou = (m, trecho) => chamadas.find((c) => c.m === m && c.u.includes(trecho));

test("todos os comandos de moderacao exigem admin e nao chamam o Discord", async () => {
  reset();
  for (const n of ["anunciar", "limpar", "silenciar", "tirar-silencio", "expulsar", "banir", "desbanir", "lentidao", "trancar", "destrancar", "aviso", "remover-aviso", "protecao"]) assert.match(await cmd(MEMBRO, n, o({ usuario: ALVO })), /permiss/, n);
  assert.equal(chamadas.length, 0);
});

test("anunciar: embed no canal escolhido; so marca todos quando pedido", async () => {
  reset();
  assert.match(await cmd(ADMIN, "anunciar", o({ canal: CANAL, titulo: "Novo jogo", texto: "Linha 1\\nLinha 2" })), /Anúncio enviado/);
  let c = achou("POST", "/channels/" + CANAL + "/messages");
  assert.equal(c.corpo.embeds[0].description, "Linha 1\nLinha 2"); assert.deepEqual(c.corpo.allowed_mentions.parse, []);
  reset(); await cmd(ADMIN, "anunciar", o({ canal: CANAL, titulo: "x", texto: "y", marcar: "everyone" }));
  c = achou("POST", "/channels/" + CANAL + "/messages"); assert.equal(c.corpo.content, "@everyone"); assert.deepEqual(c.corpo.allowed_mentions.parse, ["everyone"]);
});

test("limpar: apaga so recentes e nao fixadas (bulk-delete)", async () => {
  reset();
  assert.match(await cmd(ADMIN, "limpar", o({ quantidade: 50 })), /2 mensagem/);
  assert.equal(achou("POST", "/messages/bulk-delete").corpo.messages.length, 2);
});

test("silenciar / tirar-silencio / expulsar / banir / desbanir / lentidao", async () => {
  reset();
  assert.match(await cmd(ADMIN, "silenciar", o({ usuario: ALVO, minutos: 30, motivo: "spam" })), /30 minuto/);
  const s = achou("PATCH", "/members/" + ALVO); const dif = Date.parse(s.corpo.communication_disabled_until) - Date.now();
  assert.ok(dif > 29 * 60000 && dif < 31 * 60000); assert.equal(s.h["X-Audit-Log-Reason"], "spam");
  await cmd(ADMIN, "tirar-silencio", o({ usuario: ALVO })); assert.equal(chamadas.filter((c) => c.m === "PATCH").pop().corpo.communication_disabled_until, null);
  assert.match(await cmd(ADMIN, "expulsar", o({ usuario: ALVO })), /expulso/); assert.ok(achou("DELETE", "/guilds/" + GUILD + "/members/" + ALVO));
  assert.match(await cmd(ADMIN, "banir", o({ usuario: ALVO, apagar_dias: 1 })), /banido/); assert.equal(achou("PUT", "/bans/" + ALVO).corpo.delete_message_seconds, 86400);
  assert.match(await cmd(ADMIN, "desbanir", o({ id: ALVO })), /removido/); assert.match(await cmd(ADMIN, "desbanir", o({ id: "abc" })), /ID numérico/);
  assert.match(await cmd(ADMIN, "lentidao", o({ segundos: 10 })), /10 segundo/); assert.equal(achou("PATCH", "/channels/" + CANAL).corpo.rate_limit_per_user, 10);
});

test("protecoes: nao age em admin, em si mesmo nem no bot", async () => {
  reset();
  for (const u of [ADMIN, APP]) assert.match(await cmd(ADMIN, "banir", o({ usuario: u })), /protegida|mesmo/);
  assert.equal(chamadas.length, 0);
});

test("trancar e destrancar mexem so no envio de mensagens do @everyone e preservam o resto", async () => {
  reset(); overwrites = [{ id: GUILD, type: 0, allow: "64", deny: "0" }];
  await cmd(ADMIN, "trancar", []); let p = achou("PUT", "/permissions/" + GUILD); assert.equal(p.corpo.deny, "2048"); assert.equal(p.corpo.allow, "64");
  overwrites = [{ id: GUILD, type: 0, allow: "0", deny: "2112" }];
  await cmd(ADMIN, "destrancar", []); p = chamadas.filter((c) => c.m === "PUT").pop(); assert.equal(p.corpo.deny, "64");
});

test("avisos: 1 so cargo; 2 silencia 10 min; 3 silencia 1 h; depois recusa; remover-aviso desce", async () => {
  reset();
  assert.match(await cmd(ADMIN, "aviso", o({ usuario: ALVO, motivo: "link" })), /Aviso 1 aplicado/);
  assert.deepEqual(membroRoles, [R1]); assert.ok(!chamadas.find((c) => c.m === "PATCH"));
  assert.match(await cmd(ADMIN, "aviso", o({ usuario: ALVO, motivo: "link" })), /Aviso 2 aplicado.*10 minutos/);
  assert.deepEqual(membroRoles, [R2]);
  assert.match(await cmd(ADMIN, "aviso", o({ usuario: ALVO, motivo: "link" })), /Aviso 3 aplicado.*1 hora/);
  assert.deepEqual(membroRoles, [R3]);
  assert.match(await cmd(ADMIN, "aviso", o({ usuario: ALVO, motivo: "link" })), /já está no \*\*Aviso 3/);
  assert.match(await cmd(ADMIN, "remover-aviso", o({ usuario: ALVO })), /Aviso 2/); assert.deepEqual(membroRoles, [R2]);
  await cmd(ADMIN, "remover-aviso", o({ usuario: ALVO })); await cmd(ADMIN, "remover-aviso", o({ usuario: ALVO }));
  assert.deepEqual(membroRoles, []); assert.match(await cmd(ADMIN, "remover-aviso", o({ usuario: ALVO })), /nenhum aviso/);
  const pub = chamadas.find((c) => c.m === "POST" && c.u === "/channels/" + CANAL + "/messages"); assert.match(pub.corpo.content, /Aviso 1/); assert.deepEqual(pub.corpo.allowed_mentions.users, [ALVO]);
});

test("protecao ativar: 3 regras, links liberados so da loja/YouTube/Twitch, equipe isenta, alertas; falha de uma regra nao derruba as outras", async () => {
  reset();
  const r = await cmd(ADMIN, "protecao", o({ acao: "ativar", canal_alertas: ALERTAS }));
  assert.match(r, /Proteção ativada/); assert.match(r, /✅ TSS - Links externos/); assert.match(r, /⚠️ TSS - Spam/); assert.match(r, /✅ TSS - Excesso de menções/);
  const posts = chamadas.filter((c) => c.m === "POST" && c.u.endsWith("/auto-moderation/rules"));
  const links = posts.find((p) => p.corpo.name === "TSS - Links externos").corpo;
  assert.equal(links.trigger_metadata.allow_list.length, 8);
  assert.ok(links.trigger_metadata.regex_patterns.length <= 10 && links.trigger_metadata.regex_patterns.every((x) => x.length <= 260));
  assert.deepEqual(links.exempt_roles, [RSTAFF]);
  assert.ok(links.actions.some((a) => a.type === 1) && links.actions.some((a) => a.type === 2 && a.metadata.channel_id === ALERTAS));
  const rx = links.trigger_metadata.regex_patterns.map((x) => new RegExp(x.replace("(?i)", ""), "i"));
  for (const t of ["entra aqui https://site-golpe.com/x", "discord.gg/abc123", "www.golpe.com.br", "golpe.xyz"]) assert.ok(rx.some((e) => e.test(t)), t);
  for (const t of ["oi, tudo bem?", "quero comprar o jogo", "alguém tem a chave?"]) assert.ok(!rx.some((e) => e.test(t)), t);
});

test("protecao status e desativar; segunda ativacao atualiza (PATCH) em vez de duplicar", async () => {
  reset(); regras = [{ id: "r1", name: "TSS - Links externos", enabled: true }, { id: "r2", name: "Regra de outro bot", enabled: true }];
  assert.match(await cmd(ADMIN, "protecao", o({ acao: "status" })), /TSS - Links externos: ligada/);
  await cmd(ADMIN, "protecao", o({ acao: "ativar" })); const pa = achou("PATCH", "/auto-moderation/rules/r1"); assert.ok(pa && !("trigger_type" in pa.corpo));
  chamadas = []; assert.match(await cmd(ADMIN, "protecao", o({ acao: "desativar" })), /desligada/);
  const alvos = chamadas.filter((c) => c.m === "PATCH").map((c) => c.u.split("/").pop()); assert.ok(alvos.includes("r1")); assert.ok(!alvos.includes("r2")); assert.ok(chamadas.filter((c) => c.m === "PATCH").every((c) => c.corpo.enabled === false));
});
