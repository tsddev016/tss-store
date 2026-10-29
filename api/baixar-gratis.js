// Download gratuito: devolve um link temporario do .zip no cofre (sem chave).
// Usado por jogos com protegido=false (ex.: demo).
const crypto = require("crypto");

const GH = process.env.GH_API || "https://api.github.com";
const COFRE = process.env.COFRE_REPO || "tsddev016/tss-cofre";
const SITE = process.env.SITE_REPO || "tsddev016/tss-store";

function hdr(extra) {
  return Object.assign({
    Authorization: "Bearer " + process.env.GH_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tss-sentinela",
  }, extra || {});
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, erro: "Metodo nao permitido." });
    }
    if (!process.env.GH_TOKEN) {
      return res.status(500).json({ ok: false, erro: "Servidor sem GH_TOKEN." });
    }

    const jogo = String((req.query && req.query.jogo) || (req.body && req.body.jogo) || "").toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(jogo)) {
      return res.status(400).json({ ok: false, erro: "Jogo invalido." });
    }

    // Le catalogo publico
    const rc = await fetch(`${GH}/repos/${SITE}/contents/public/catalog.json`, {
      headers: hdr({ Accept: "application/vnd.github.raw+json" }),
      cache: "no-store",
    });
    if (!rc.ok) return res.status(503).json({ ok: false, erro: "Catalogo indisponivel." });
    const cat = await rc.json();
    const g = (cat.games || []).find((x) => x.id === jogo);
    if (!g) return res.status(404).json({ ok: false, erro: "Jogo nao encontrado." });
    if (g.protegido) {
      return res.status(403).json({ ok: false, erro: "Este jogo e protegido. Use a chave de ativacao." });
    }

    // Tags possíveis: id-vVERSAO ou id com underscore
    const tags = [
      jogo + "-v" + g.version,
      jogo.replace(/-/g, "_") + "-v" + g.version,
      jogo + "-v" + String(g.version).replace(/\./g, "_"),
    ];

    let rel = null;
    for (const tag of tags) {
      const rr = await fetch(`${GH}/repos/${COFRE}/releases/tags/${encodeURIComponent(tag)}`, { headers: hdr() });
      if (rr.ok) { rel = await rr.json(); break; }
    }
    if (!rel) {
      // tenta listar releases e achar por prefixo
      const rl = await fetch(`${GH}/repos/${COFRE}/releases?per_page=30`, { headers: hdr() });
      if (rl.ok) {
        const lista = await rl.json();
        const pref = jogo.replace(/-/g, "_");
        rel = lista.find((r) => {
          const t = String(r.tag_name || "").toLowerCase();
          return t.startsWith(jogo + "-") || t.startsWith(pref + "-") || t.includes(jogo);
        }) || null;
      }
    }
    if (!rel) {
      return res.status(404).json({ ok: false, erro: "Versao ainda nao publicada no cofre." });
    }

    const a = (rel.assets || []).find((x) => /\.zip$/i.test(x.name)) || (rel.assets || [])[0];
    if (!a) return res.status(404).json({ ok: false, erro: "Arquivo do jogo nao encontrado." });

    const rd = await fetch(a.url, {
      headers: hdr({ Accept: "application/octet-stream" }),
      redirect: "manual",
    });
    const loc = rd.headers.get("location");
    if (!loc || ![301, 302, 303, 307, 308].includes(rd.status)) {
      return res.status(503).json({ ok: false, erro: "Nao consegui liberar o download." });
    }

    // Se o cliente pediu JSON (Hub moderno), devolve url + sha
    const aceitaJson = String(req.headers.accept || "").includes("application/json") ||
      (req.query && req.query.format === "json") || req.method === "POST";
    if (aceitaJson) {
      return res.status(200).json({
        ok: true,
        url: loc,
        sha256: g.sha256 || "",
        versao: String(g.version),
        nome: a.name,
      });
    }

    // Redirect direto pro ZIP (navegador / download_url no catalogo)
    res.setHeader("Location", loc);
    return res.status(302).end();
  } catch (e) {
    return res.status(500).json({ ok: false, erro: "Erro interno." });
  }
};
