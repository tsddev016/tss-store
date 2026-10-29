// TSS Sentinela - confere a chave de ativacao e libera o download do jogo.
const crypto = require("crypto");
const R = require("./_release");

const COFRE = process.env.COFRE_REPO || "tsddev016/tss-cofre";
const MAX_PADRAO = 2;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const norm = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function hdr(extra) {
  return Object.assign({
    Authorization: "Bearer " + process.env.GH_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tss-sentinela",
  }, extra || {});
}

class Falha extends Error {
  constructor(status, erro, codigo) { super(erro); this.status = status; this.erro = erro; this.codigo = codigo; }
}

async function lerChaves() {
  const r = await fetch(`${R.GH}/repos/${COFRE}/contents/chaves.json`, { headers: hdr(), cache: "no-store" });
  if (!r.ok) throw new Falha(503, "Servidor da TSS indisponivel no momento. Tente de novo.", "cofre");
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}

async function gravarChaves(data, shaAtual) {
  const r = await fetch(`${R.GH}/repos/${COFRE}/contents/chaves.json`, {
    method: "PUT", headers: hdr({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message: "sentinela: ativacao de computador",
      content: Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64"),
      sha: shaAtual,
    }),
  });
  if (r.status === 409 || r.status === 422) return false;
  if (!r.ok) throw new Falha(503, "Servidor da TSS indisponivel no momento. Tente de novo.", "cofre");
  return true;
}

async function validar(chave, jogo, maquina) {
  for (let t = 0; t < 4; t++) {
    const { data, sha: fsha } = await lerChaves();
    const reg = data.keys && data.keys[sha(chave)];
    if (!reg) throw new Falha(403, "Chave invalida. Confira se digitou certo.", "chave_invalida");
    if (reg.revogada) throw new Falha(403, "Esta chave foi desativada.", "revogada");
    if (reg.jogo && reg.jogo !== jogo) throw new Falha(403, "Esta chave nao e deste jogo.", "outro_jogo");
    const maqs = Array.isArray(reg.maquinas) ? reg.maquinas : [];
    if (maqs.includes(maquina)) return;
    if (maqs.length >= (reg.max || MAX_PADRAO)) {
      throw new Falha(403, "Esta chave ja esta em uso no limite de computadores. Fale com o suporte da TSS.", "limite");
    }
    reg.maquinas = maqs.concat(maquina);
    reg.ativada = reg.ativada || new Date().toISOString();
    if (await gravarChaves(data, fsha)) return;
  }
  throw new Falha(503, "Muitos acessos ao mesmo tempo. Tente de novo em alguns segundos.", "ocupado");
}

async function linkDoJogo(jogo) {
  try {
    const d = await R.resolverDownload(jogo);
    return { url: d.url, sha256: d.sha256 || "", versao: d.versao };
  } catch (e) {
    throw new Falha(e.status || 503, e.message || "Falha no download.", e.codigo || "download");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new Falha(405, "Metodo nao permitido.", "metodo");
    if (!process.env.GH_TOKEN) throw new Falha(500, "Servidor da TSS ainda nao configurado.", "config");
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    const acao = String(b.acao || "");
    const jogo = String(b.jogo || "").toLowerCase();
    const maquina = String(b.maquina || "").toLowerCase();
    const chave = norm(b.chave);
    if (!["ativar", "baixar"].includes(acao)) throw new Falha(400, "Pedido invalido.", "pedido");
    if (!/^[a-z0-9_-]{1,40}$/.test(jogo) || !/^[0-9a-f]{64}$/.test(maquina)) throw new Falha(400, "Pedido invalido.", "pedido");
    if (chave.length < 16 || chave.length > 40) throw new Falha(403, "Chave invalida. Confira se digitou certo.", "chave_invalida");
    await validar(chave, jogo, maquina);
    if (acao === "ativar") return res.status(200).json({ ok: true });
    return res.status(200).json(Object.assign({ ok: true }, await linkDoJogo(jogo)));
  } catch (e) {
    if (e instanceof Falha) return res.status(e.status).json({ ok: false, erro: e.erro, codigo: e.codigo });
    return res.status(500).json({ ok: false, erro: "Erro interno no servidor da TSS.", codigo: "interno" });
  }
};
