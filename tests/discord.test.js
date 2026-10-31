// Testes da verificacao de assinatura Ed25519 e do endpoint do bot (rodar: node --test tests/)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const handler = require("../api/jogo.js");

const par = crypto.generateKeyPairSync("ed25519");
const pubHex = par.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const assinar = (ts, corpo) => crypto.sign(null, Buffer.concat([Buffer.from(ts), Buffer.from(corpo)]), par.privateKey).toString("hex");

// Chama o handler principal exatamente como a Vercel: POST /api/discord vira /api/jogo?discord=1
function chamar(corpo, { ts = "1700000000", sig, metodo = "POST" } = {}) {
  const req = { method: metodo, query: { discord: "1" }, url: "/api/jogo?discord=1", headers: { "x-signature-ed25519": sig === undefined ? assinar(ts, corpo) : sig, "x-signature-timestamp": ts }, rawBody: Buffer.from(corpo) };
  const out = { status: 0, body: undefined };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; }, send(b) { out.body = b; return res; }, end() { return res; }, setHeader() {} };
  return Promise.resolve(handler(req, res)).then(() => out);
}

test("assinatura valida passa; corpo adulterado, timestamp errado e chave errada falham", () => {
  const corpo = '{"type":1}', ts = "1700000000", sig = assinar(ts, corpo);
  assert.equal(handler.assinaturaOk(Buffer.from(corpo), sig, ts, pubHex), true);
  assert.equal(handler.assinaturaOk(Buffer.from('{"type":2}'), sig, ts, pubHex), false);
  assert.equal(handler.assinaturaOk(Buffer.from(corpo), sig, "1700000001", pubHex), false);
  const outra = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  assert.equal(handler.assinaturaOk(Buffer.from(corpo), sig, ts, outra), false);
});

test("entradas vazias ou lixo nao quebram (retornam false)", () => {
  assert.equal(handler.assinaturaOk(Buffer.from("x"), "", "1", pubHex), false);
  assert.equal(handler.assinaturaOk(Buffer.from("x"), "zz", "1", pubHex), false);
  assert.equal(handler.assinaturaOk(Buffer.from("x"), "00", "1", ""), false);
  assert.equal(handler.assinaturaOk(Buffer.from("x"), "00", "1", "nao-e-hex"), false);
});

test("endpoint: PING assinado responde type 1; assinatura ruim ou ausente responde 401", async () => {
  process.env.DISCORD_PUBLIC_KEY = pubHex;
  const ok = await chamar('{"type":1}');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { type: 1 });
  assert.equal((await chamar('{"type":1}', { sig: "00".repeat(64) })).status, 401);
  assert.equal((await chamar('{"type":1}', { sig: "" })).status, 401);
});

test("endpoint: sem DISCORD_PUBLIC_KEY configurada recusa tudo", async () => {
  const antes = process.env.DISCORD_PUBLIC_KEY; delete process.env.DISCORD_PUBLIC_KEY;
  const r = await chamar('{"type":1}');
  process.env.DISCORD_PUBLIC_KEY = antes;
  assert.equal(r.status, 401);
});

test("endpoint: usuario fora de DISCORD_ADMIN_IDS recebe negacao efemera", async () => {
  process.env.DISCORD_PUBLIC_KEY = pubHex; process.env.DISCORD_ADMIN_IDS = "111, 222";
  const corpo = JSON.stringify({ type: 2, member: { user: { id: "999" } }, data: { name: "vendas" } });
  const r = await chamar(corpo);
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 4);
  assert.equal(r.body.data.flags, 64);
  assert.match(r.body.data.content, /permiss/);
});

test("endpoint: GET nao e aceito (405)", async () => {
  process.env.DISCORD_PUBLIC_KEY = pubHex;
  const r = await chamar("{}", { metodo: "GET" });
  assert.equal(r.status, 405);
});
