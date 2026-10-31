// Serve /jogo/<id> com meta tags (titulo, descricao e imagem) do proprio jogo, para o link ficar bonito no Discord/WhatsApp/Google.
const R = require("./_release");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async (req, res) => {
  // /sitemap.xml tambem passa por aqui (o plano gratis da Vercel limita a 12 funcoes).
  if (req.query && req.query.sitemap) {
    const h = req.headers["x-forwarded-host"] || req.headers.host || "tss-store.vercel.app";
    const urls = ["/", "/sobre", "/suporte", "/termos", "/privacidade", "/reembolso"];
    try {
      const cat = await R.lerCatalogo();
      ((cat && cat.games) || []).forEach((g) => { if (g && g.id) urls.push("/jogo/" + encodeURIComponent(g.id)); });
    } catch (e) { /* so as paginas fixas */ }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => "  <url><loc>https://" + h + u + "</loc></url>").join("\n") + "\n</urlset>\n";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(xml);
  }
  const id = String((req.query && req.query.id) || "").slice(0, 80);
  const host = req.headers["x-forwarded-host"] || req.headers.host || "tss-store.vercel.app";
  const origin = "https://" + host;
  let html;
  try {
    const r = await fetch(origin + "/jogo");
    if (!r.ok) throw new Error("base");
    html = await r.text();
  } catch (e) {
    res.statusCode = 302;
    res.setHeader("Location", "/jogo?id=" + encodeURIComponent(id));
    return res.end();
  }
  let g = null;
  try {
    const cat = await R.lerCatalogo();
    g = ((cat && cat.games) || []).find((x) => x.id === id) || null;
  } catch (e) { /* sem catalogo: serve a pagina base */ }
  if (g) {
    const title = g.name + " – TSS The Swift Store";
    const desc = String(g.description || "").replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim().slice(0, 160) || ("Jogue " + g.name + " na TSS The Swift Store.");
    const u = g.banner_url || g.capsule_url || "";
    const img = /^https:\/\//i.test(u) ? u : origin + (u.charAt(0) === "/" ? "" : "/") + u;
    const url = origin + "/jogo/" + encodeURIComponent(g.id);
    const meta =
      '<meta name="description" content="' + esc(desc) + '">\n' +
      '<link rel="canonical" href="' + esc(url) + '">\n' +
      '<meta property="og:type" content="website">\n<meta property="og:site_name" content="TSS The Swift Store">\n<meta property="og:locale" content="pt_BR">\n' +
      '<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n' +
      '<meta property="og:url" content="' + esc(url) + '">\n<meta property="og:image" content="' + esc(img) + '">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(title) + '">\n' +
      '<meta name="twitter:description" content="' + esc(desc) + '">\n<meta name="twitter:image" content="' + esc(img) + '">\n';
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => "<title>" + esc(title) + "</title>").replace("</head>", () => meta + "</head>");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(g ? 200 : 404).send(html);
};
