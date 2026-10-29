// Catalogo ao vivo para a loja: le o catalogo e confere no cofre (pasta jogos/<id>/) se cada jogo tem arquivo publicado.
// A loja chama a cada 5 s; o cache da Vercel (5 s) evita gastar a cota do GitHub.
const R = require("./_release");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const cat = await R.lerCatalogo();
    if (!cat) return res.status(503).json({ ok: false, erro: "Catalogo indisponivel." });

    const games = await Promise.all((cat.games || []).map(async (g) => {
      const out = Object.assign({}, g);
      const naPasta = await R.listarPasta(g.id);
      const ok = naPasta.length > 0; // so existe na loja quem tem arquivo em jogos/<id>/ do cofre
      out.disponivel = ok;
      return out;
    }));
    return res.status(200).json(Object.assign({}, cat, { games }));
  } catch (e) {
    console.error("catalogo:", e && e.message);
    return res.status(500).json({ ok: false, erro: "Falha ao ler o catalogo." });
  }
};
