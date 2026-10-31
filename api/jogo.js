// Serve /jogo/<id> com meta tags (titulo, descricao e imagem) do proprio jogo, para o link ficar bonito no Discord/WhatsApp/Google.
const R = require("./_release");
const crypto = require("crypto");
const L = require("./_cofre");
const D = require("./_discord");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Bot do Discord (slash commands) em /api/discord ----------
function lerRaw(req) {
  return new Promise((ok) => {
    if (Buffer.isBuffer(req.rawBody)) return ok(req.rawBody);
    const c = [];
    const t = setTimeout(() => ok(Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}))), 2500);
    req.on("data", (x) => c.push(Buffer.from(x)));
    req.on("end", () => { clearTimeout(t); ok(Buffer.concat(c)); });
    req.on("error", () => { clearTimeout(t); ok(Buffer.alloc(0)); });
  });
}
function assinaturaOk(raw, sig, ts, pub) {
  try {
    if (!sig || !ts || !pub) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "hex")]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.concat([Buffer.from(String(ts)), raw]), key, Buffer.from(sig, "hex"));
  } catch (e) { return false; }
}
const reais = (v) => "R$ " + (Number(v) || 0).toFixed(2).replace(".", ",");
function resumoVendas(data) {
  const ped = Object.entries(data.pedidos || {}).filter(([p, r]) => Number(r.preco) > 0);
  const pagos = ped.filter(([p, r]) => !(data.keys[r.h] && data.keys[r.h].revogada) && ((data.reembolsos || {})[p] || {}).estado !== "reembolsado");
  const total = pagos.reduce((s, [, r]) => s + Number(r.preco), 0);
  const emUso = Object.values(data.keys || {}).filter((k) => !k.revogada && Array.isArray(k.maquinas) && k.maquinas.length).length;
  const pedidosReemb = Object.values(data.reembolsos || {}).filter((x) => x.estado === "pedido").length;
  const ultimas = ped.sort((a, b) => String(b[1].criado).localeCompare(String(a[1].criado))).slice(0, 5)
    .map(([p, r]) => "- " + (r.jogo || "?") + " · " + reais(r.preco) + " · " + String(r.criado || "").slice(0, 10)).join("\n") || "- nenhuma ainda";
  return "**Vendas:** " + pagos.length + " paga(s), total " + reais(total) + "\n**Chaves em uso:** " + emUso + "\n**Pedidos de reembolso abertos:** " + pedidosReemb + "\n**Ultimas compras:**\n" + ultimas;
}
async function comando(d) {
  const o = {};
  (d.options || []).forEach((x) => { o[x.name] = x.value; });
  const JOGO_OK = /^[a-z0-9_-]{1,40}$/;
  if (d.name === "vendas") { const { data } = await L.lerChaves(); return resumoVendas(data); }
  if (d.name === "chave") {
    const jogo = String(o.jogo || "").toLowerCase(), qtd = Math.min(5, Math.max(1, Math.floor(Number(o.qtd)) || 1));
    if (!JOGO_OK.test(jogo)) return "Jogo invalido.";
    const novas = await L.mutar((data) => {
      const out = [];
      for (let i = 0; i < qtd; i++) { const c = L.chaveAleatoria(); data.keys[L.sha(L.norm(c))] = { jogo, max: L.MAX_PADRAO, maquinas: [], criada: L.agora(), origem: "discord", nota: "" }; out.push(c); }
      return { salvar: true, resultado: out };
    }, "discord: " + qtd + " chave(s) geradas (" + jogo + ")");
    return "Chave(s) de **" + jogo + "** (so voce ve esta mensagem):\n" + novas.map((c) => "`" + c + "`").join("\n");
  }
  if (d.name === "cupom") {
    const cod = L.norm(o.codigo), tipo = o.tipo === "fixo" ? "fixo" : "percent", valor = Number(o.valor), jogo = String(o.jogo || "").toLowerCase(), ate = String(o.ate || ""), max = Math.floor(Number(o.max_usos)) || 0;
    if (cod.length < 3 || cod.length > 24) return "O codigo deve ter de 3 a 24 letras/numeros.";
    if (tipo === "percent" && !(valor >= 1 && valor <= 90)) return "Desconto em % deve ser de 1 a 90.";
    if (tipo === "fixo" && !(valor > 0 && valor <= 500)) return "Desconto em R$ deve ser de 0,01 a 500.";
    if (jogo && !JOGO_OK.test(jogo)) return "Jogo invalido.";
    if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return "Validade deve ser AAAA-MM-DD.";
    if (max < 0 || max > 100000) return "Limite de usos invalido.";
    await L.mutar((data) => {
      const ant = data.cupons[cod] || {};
      data.cupons[cod] = { tipo, valor: Math.round(valor * 100) / 100, jogo, ate, max_usos: max, usos: Number(ant.usos) || 0, ativo: true, criado: ant.criado || L.agora() };
      return { salvar: true, resultado: true };
    }, "cupom salvo (discord): " + cod);
    return "Cupom **" + cod + "** salvo: " + (tipo === "fixo" ? reais(valor) : valor + "%") + " de desconto" + (jogo ? " em " + jogo : " em todos os jogos") + (ate ? ", ate " + ate : "") + (max ? ", limite " + max + " usos" : "") + ".";
  }
  return "Comando desconhecido.";
}
const resp = (res, txt) => res.status(200).json({ type: 4, data: { content: String(txt).slice(0, 1900), flags: 64, allowed_mentions: { parse: [] } } });
async function discordBot(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const raw = await lerRaw(req);
  if (!assinaturaOk(raw, req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"], process.env.DISCORD_PUBLIC_KEY)) return res.status(401).send("assinatura invalida");
  let it;
  try { it = JSON.parse(raw.toString("utf8")); } catch (e) { return res.status(400).end(); }
  if (it.type === 1) return res.status(200).json({ type: 1 });
  if (it.type !== 2) return res.status(400).end();
  const uid = String((it.member && it.member.user && it.member.user.id) || (it.user && it.user.id) || "");
  const permitidos = String(process.env.DISCORD_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!uid || !permitidos.includes(uid)) return resp(res, "Voce nao tem permissao para usar este bot.");
  try { return resp(res, await comando(it.data || {})); }
  catch (e) { return resp(res, "Erro: " + String(e.erro || e.message || e).slice(0, 300)); }
}

module.exports = async (req, res) => {
  // /sitemap.xml tambem passa por aqui (o plano gratis da Vercel limita a 12 funcoes).
  if (req.query && req.query.discord) return discordBot(req, res);
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
module.exports.config = { api: { bodyParser: false } };
module.exports.resumoVendas = resumoVendas;
module.exports.assinaturaOk = assinaturaOk;
