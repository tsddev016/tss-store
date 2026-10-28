// TSS Sentinela - confere a chave de ativacao e libera o download do jogo.
// Roda na Vercel. Variavel obrigatoria: GH_TOKEN (token do GitHub so com acesso ao repositorio "cofre").
const crypto = require("crypto");

const GH = "https://api.github.com";
const COFRE = process.env.COFRE_REPO || "tsddev016/tss-cofre";   // repositorio PRIVADO (jogos + chaves.json)
const SITE = process.env.SITE_REPO || "tsddev016/tss-store";     // repositorio publico (catalog.json)
const MAX_PADRAO = 2;                                            // computadores por chave

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
  const r = await fetch(`${GH}/repos/${COFRE}/contents/chaves.json`, { headers: hdr(), cache: "no-store" });
  if (!r.ok) throw new Falha(503, "Servidor da TSS indisponivel no momento. Tente de novo.", "cofre");
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}

async function gravarChaves(data, shaAtual) {
  const r = await fetch(`${GH}/repos/${COFRE}/contents/chaves.json`, {
    method: "PUT", headers: hdr({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message: "sentinela: ativacao de computador",
      content: Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64"),
      sha: shaAtual,
    }),
  });
  if (r.status === 409 || r.status === 422) return false;      // alguem gravou ao mesmo tempo: tenta de novo
  if (!r.ok) throw new Falha(503, "Servidor da TSS indisponivel no momento. Tente de novo.", "cofre");
  return true;
}

// Confere a chave e registra este computador (ate "max" computadores por chave).
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

// Devolve um link temporario (poucos minutos) do arquivo do jogo no cofre privado.
async function linkDoJogo(jogo) {
  const rc = await fetch(`${GH}/repos/${SITE}/contents/public/catalog.json`, {
    headers: hdr({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
  if (!rc.ok) throw new Falha(503, "Catalogo indisponivel no momento.", "catalogo");
  const cat = await rc.json();
  const g = (cat.games || []).find((x) => x.id === jogo);
  if (!g) throw new Falha(404, "Jogo nao encontrado no catalogo.", "sem_jogo");
  const rr = await fetch(`${GH}/repos/${COFRE}/releases/tags/${encodeURIComponent(jogo + "-v" + g.version)}`, { headers: hdr() });
  if (!rr.ok) throw new Falha(404, "A versao " + g.version + " deste jogo ainda nao foi publicada.", "sem_release");
  const rel = await rr.json();
  const a = (rel.assets || []).find((x) => /\.zip$/i.test(x.name)) || (rel.assets || [])[0];
  if (!a) throw new Falha(404, "Arquivo do jogo nao encontrado.", "sem_arquivo");
  const rd = await fetch(a.url, { headers: hdr({ Accept: "application/octet-stream" }), redirect: "manual" });
  const loc = rd.headers.get("location");
  if (!loc || ![301, 302, 303, 307, 308].includes(rd.status)) throw new Falha(503, "Nao consegui liberar o download. Tente de novo.", "download");
  return { url: loc, sha256: g.sha256 || "", versao: String(g.version) };
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
