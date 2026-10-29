// Biblioteca compartilhada do TSS Sentinela (arquivos que comecam com _ nao viram rotas na Vercel).
// Guarda tudo em chaves.json no repositorio PRIVADO tss-cofre: { keys:{hash:{...}}, pedidos:{id:{...}}, log:[...] }
const crypto = require("crypto");

const GH = process.env.GH_API || "https://api.github.com";
const COFRE = process.env.COFRE_REPO || "tsddev016/tss-cofre";
const MAX_PADRAO = 2;
const TERMOS_VERSAO = "2026-10-29"; // mude junto com public/legal.js quando alterar os termos
const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 simbolos, sem 0/O/1/I

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Codigo de verificacao COM CHAVE SECRETA (HMAC): sem a chave nao da para descobrir CPF/e-mail testando combinacoes.
const hmacHex = (tag, s) => {
  const seg = process.env.KEY_SECRET;
  if (!seg) throw new Falha(500, "Servidor ainda sem KEY_SECRET configurada.", "config");
  return crypto.createHmac("sha256", seg).update(tag + ":" + s).digest("hex");
};
// Conta minima: o id da conta e so um codigo derivado do ID do login (nada de nome, e-mail ou foto no banco).
const idConta = (prov, id) => String(prov) + "_" + hmacHex("conta", String(prov) + ":" + String(id)).slice(0, 32);
const norm = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agora = () => new Date().toISOString();

class Falha extends Error {
  constructor(status, erro, codigo) { super(erro); this.status = status; this.erro = erro; this.codigo = codigo; }
}

function hdr(extra) {
  return Object.assign({
    Authorization: "Bearer " + process.env.GH_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tss-sentinela",
  }, extra || {});
}

function corpo(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

function seguro(a, b) {
  const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b)));
  return crypto.timingSafeEqual(x, y);
}

async function exigirAdmin(senha) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new Falha(500, "Servidor ainda sem ADMIN_PASSWORD configurada.", "config");
  if (!seguro(senha || "", real)) { await sleep(700); throw new Falha(401, "Senha incorreta.", "senha"); }
}

async function lerChaves() {
  if (!process.env.GH_TOKEN) throw new Falha(500, "Servidor ainda sem GH_TOKEN configurado.", "config");
  const r = await fetch(`${GH}/repos/${COFRE}/contents/chaves.json`, { headers: hdr(), cache: "no-store" });
  if (r.status === 404) return { data: { keys: {}, pedidos: {}, log: [], contas: {}, reembolsos: {} }, sha: null };
  if (!r.ok) throw new Falha(503, "Cofre da TSS indisponivel no momento. Tente de novo.", "cofre");
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  data.keys = data.keys || {}; data.pedidos = data.pedidos || {}; data.log = data.log || [];
  data.contas = data.contas || {}; data.reembolsos = data.reembolsos || {};
  return { data, sha: j.sha };
}

async function gravar(data, shaAtual, msg) {
  const body = {
    message: msg || "sentinela: atualizacao",
    content: Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64"),
  };
  if (shaAtual) body.sha = shaAtual;
  const r = await fetch(`${GH}/repos/${COFRE}/contents/chaves.json`, {
    method: "PUT", headers: hdr({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return false;
  if (!r.ok) throw new Falha(503, "Cofre da TSS indisponivel no momento. Tente de novo.", "cofre");
  return true;
}

async function mutar(fn, msg) {
  for (let t = 0; t < 5; t++) {
    const { data, sha: s } = await lerChaves();
    const out = await fn(data);
    if (!out.salvar) return out.resultado;
    if (await gravar(data, s, msg)) return out.resultado;
    await sleep(150 * (t + 1));
  }
  throw new Falha(503, "Muitos acessos ao mesmo tempo. Tente de novo em alguns segundos.", "ocupado");
}

// Dados pessoais (nome, CPF, e-mail) ficam cifrados (AES-256-GCM) com DADOS_KEY antes de ir para o cofre.
function chaveDados() {
  const s = process.env.DADOS_KEY;
  if (!s) throw new Falha(500, "Servidor ainda sem DADOS_KEY configurada.", "config");
  return crypto.createHash("sha256").update("tss-dados:" + s).digest();
}
function cifrar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chaveDados(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return "v1." + iv.toString("base64") + "." + c.getAuthTag().toString("base64") + "." + enc.toString("base64");
}
function decifrar(txt) {
  const [v, iv, tag, enc] = String(txt || "").split(".");
  if (v !== "v1" || !enc) return {};
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", chaveDados(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8"));
  } catch (e) { return {}; }
}
const ipDe = (req) => String(((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0] || "").trim().slice(0, 60);

const formatar = (k) => k.match(/.{1,5}/g).join("-");
function chaveAleatoria() {
  let k = ""; for (let i = 0; i < 20; i++) k += ALFA[crypto.randomInt(32)];
  return formatar(k);
}
function chaveDoPedido(pedido, jogo) {
  const seg = process.env.KEY_SECRET;
  if (!seg) throw new Falha(500, "Servidor ainda sem KEY_SECRET configurada.", "config");
  const d = crypto.createHmac("sha256", seg).update(`pedido:${pedido}:${jogo}`).digest();
  let k = ""; for (let i = 0; i < 20; i++) k += ALFA[d[i] % 32];
  return formatar(k);
}

const idPedido = (p) => String(p == null ? "" : p).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 64);
const hashEmail = (e) => hmacHex("email", String(e || "").trim().toLowerCase());

// CPF: so digitos, 11 caracteres
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
function normalizarCpf(c) {
  const d = soDigitos(c);
  return d.length === 11 ? d : "";
}
function hashCpf(c) {
  const d = normalizarCpf(c);
  return d ? hmacHex("cpf", d) : "";
}
function cpfValido(c) {
  const d = normalizarCpf(c);
  if (!d || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0; if (r !== Number(d[9])) return false;
  s = 0; for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0; return r === Number(d[10]);
}

// Cria (ou devolve) a chave de um pedido. Idempotente.
function registrarPedido(data, { pedido, email, cpf, nome, jogo, origem, conta, mp_payment, preco, aceite }) {
  const pid = idPedido(pedido);
  if (!pid) throw new Falha(400, "Pedido sem identificacao.", "pedido");
  const chave = chaveDoPedido(pid, jogo);
  const h = sha(norm(chave));
  const ja = data.pedidos[pid];
  if (!ja) {
    data.pedidos[pid] = {
      jogo,
      email: email ? hashEmail(email) : "",
      cpf: cpf ? hashCpf(cpf) : "",
      h,
      criado: agora(),
      origem: origem || "webhook",
    };
    if (conta) data.pedidos[pid].conta = conta;
    if (mp_payment) data.pedidos[pid].mp_payment = String(mp_payment);
    if (preco) data.pedidos[pid].preco = Number(preco);
    if (aceite) data.pedidos[pid].aceite = aceite;
  } else {
    if (conta && !ja.conta) ja.conta = conta;
    if (mp_payment && !ja.mp_payment) ja.mp_payment = String(mp_payment);
    if (preco && !ja.preco) ja.preco = Number(preco);
    if (aceite && !ja.aceite) ja.aceite = aceite;
    // completa dados se chegar depois
    if (email && !ja.email) ja.email = hashEmail(email);
    if (cpf && !ja.cpf) ja.cpf = hashCpf(cpf);
  }
  if (!data.keys[h]) {
    data.keys[h] = { jogo, max: MAX_PADRAO, maquinas: [], criada: agora(), origem: origem || "webhook", pedido: pid };
  }
  return { chave, h, novo: !ja };
}

function responder(res, e) {
  if (e instanceof Falha) return res.status(e.status).json({ ok: false, erro: e.erro, codigo: e.codigo });
  return res.status(500).json({ ok: false, erro: "Erro interno no servidor da TSS.", codigo: "interno" });
}

module.exports = { Falha, sha, norm, sleep, agora, corpo, seguro, exigirAdmin, lerChaves, gravar, mutar,
  chaveAleatoria, chaveDoPedido, idPedido, cifrar, decifrar, ipDe, TERMOS_VERSAO, hashEmail, hashCpf, normalizarCpf, cpfValido, soDigitos,
  registrarPedido, responder, MAX_PADRAO, idConta };
