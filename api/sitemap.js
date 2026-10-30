// Sitemap dinamico: paginas fixas + uma pagina por jogo do catalogo.
const R = require("./_release");
module.exports = async (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "tss-store.vercel.app";
  const origin = "https://" + host;
  const urls = ["/", "/termos", "/privacidade", "/reembolso"];
  try {
    const cat = await R.lerCatalogo();
    ((cat && cat.games) || []).forEach((g) => { if (g && g.id) urls.push("/jogo/" + encodeURIComponent(g.id)); });
  } catch (e) { /* so as paginas fixas */ }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "  <url><loc>" + origin + u + "</loc></url>").join("\n") + "\n</urlset>\n";
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).send(xml);
};
