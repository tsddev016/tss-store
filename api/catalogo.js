// Catalogo ao vivo para a loja: le o catalogo e confere no cofre (pasta jogos/<id>/, releases como reserva) se cada jogo tem arquivo publicado.
// A loja chama a cada 5 s; o cache da Vercel (5 s) evita gastar a cota do GitHub.
const R = require("./_release");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const cat = await R.lerCatalogo();
    if (!cat) return res.status(503).json({ ok: false, erro: "Catalogo indisponivel." });

    let rels = null;
    try {
      if (process.env.GH_TOKEN) {
        const r = await fetch(`${R.GH}/repos/${R.COFRE}/releases?per_page=100`, { headers: R.hdr(), cache: "no-store" });
        if (r.ok) rels = await r.json();
        else console.error("catalogo: releases do cofre responderam " + r.status);
      }
    } catch (e) {
      console.error("catalogo: erro lendo releases:", e && e.message);
    }

    const games = await Promise.all((cat.games || []).map(async (g) => {
      const out = Object.assign({}, g);
      const naPasta = await R.listarPasta(g.id);
      let ok = naPasta.length > 0;
      if (!ok && Array.isArray(rels)) {
        const tags = R.tagsCandidatas(g.id, g.version).map((t) => String(t).toLowerCase());
        const rel = rels.find((x) => !x.draft && tags.includes(String(x.tag_name || "").toLowerCase()));
        ok = !!(rel && (rel.assets || []).some((a) => /\.zip$/i.test(a.name)));
      }
      out.disponivel = ok;
      return out;
    }));
    return res.status(200).json(Object.assign({}, cat, { games }));
  } catch (e) {
    console.error("catalogo:", e && e.message);
    return res.status(500).json({ ok: false, erro: "Falha ao ler o catalogo." });
  }
};
