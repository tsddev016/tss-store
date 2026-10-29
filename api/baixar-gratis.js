// Download gratuito: link temporario do .zip no cofre (sem chave).
// Qualquer jogo com protegido=false no catalogo.
const R = require("./_release");

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

    let d;
    try {
      d = await R.resolverDownload(jogo);
    } catch (e) {
      return res.status(e.status || 503).json({ ok: false, erro: e.message || "Falha.", codigo: e.codigo });
    }

    if (d.g.protegido) {
      return res.status(403).json({ ok: false, erro: "Este jogo e protegido. Use a chave de ativacao." });
    }

    const aceitaJson = String(req.headers.accept || "").includes("application/json") ||
      (req.query && req.query.format === "json") || req.method === "POST";
    if (aceitaJson) {
      return res.status(200).json({
        ok: true,
        url: d.url,
        sha256: d.sha256 || "",
        versao: d.versao,
        nome: d.nome,
        tag: d.tag,
      });
    }

    res.setHeader("Location", d.url);
    return res.status(302).end();
  } catch (e) {
    return res.status(500).json({ ok: false, erro: "Erro interno." });
  }
};
