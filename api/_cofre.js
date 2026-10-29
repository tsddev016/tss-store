// Biblioteca compartilhada do TSS Sentinela (arquivos que comecam com _ nao viram rotas na Vercel).
// Guarda tudo em chaves.json no repositorio PRIVADO tss-cofre: { keys:{hash:{...}}, pedidos:{id:{...}}, log:[...] }
const crypto = require("crypto");

const GH = process.env.GH_API || "https://api.github.com";
const COFRE = process.env.COFRE_REPO || "tsddev016/tss-cofre";
const MAX_PADRAO = 2;
const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 simbolos, sem 0/O/1/I

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
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
  if (r.status === 404) return { data: { keys: {}, pedidos: {}, log: [] }, sha: null };
  if (!r.ok) throw new Falha(503, "Cofre da TSS indisponivel no momento. Tente de novo.", "cofre");
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  data.keys = data.keys || {}; data.pedidos = data.pedidos || {}; data.log = data.log || [];
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
const hashEmail = (e) => sha(String(e || "").trim().toLowerCase());

// CPF: so digitos, 11 caracteres
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
function normalizarCpf(c) {
  const d = soDigitos(c);
  return d.length === 11 ? d : "";
}
function hashCpf(c) {
  const d = normalizarCpf(c);
  return d ? sha("cpf:" + d) : "";
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
function registrarPedido(data, { pedido, email, cpf, nome, jogo, origem }) {
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
      nome: nome ? String(nome).trim().slice(0, 80) : "",
      h,
      criado: agora(),
      origem: origem || "webhook",
    };
  } else {
    // completa dados se chegar depois
    if (email && !ja.email) ja.email = hashEmail(email);
    if (cpf && !ja.cpf) ja.cpf = hashCpf(cpf);
    if (nome && !ja.nome) ja.nome = String(nome).trim().slice(0, 80);
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
  chaveAleatoria, chaveDoPedido, idPedido, hashEmail, hashCpf, normalizarCpf, cpfValido, soDigitos,
  registrarPedido, responder, MAX_PADRAO };
