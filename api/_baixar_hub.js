// Download do TSS Hub direto do site (sem MediaFire).
// O instalador fica no cofre: uma release com tag que comeca com "hub" (ex.: hub-v2.2)
// com o .exe (ou .zip) anexado, ou o arquivo dentro da pasta hub/ do cofre.
//   GET /baixar/hub            -> baixa o instalador mais novo (302 para link temporario)
//   GET /api/baixar-gratis?hub=1&info=1 -> {ok, nome, versao} (o site usa para ligar o botao)
const R = require("./_release");

const numeros = (s) => {
  const m = String(s || "").match(/(\d+(?:[._]\d+)*)/);
  return m ? m[1].split(/[._]/).map((n) => parseInt(n, 10) || 0) : [];
};
const cmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
};
const prefere = (lista) =>
  lista.find((x) => /\.exe$/i.test(x.name)) ||
  lista.find((x) => /\.msi$/i.test(x.name)) ||
  lista.find((x) => /\.zip$/i.test(x.name)) ||
  null;

async function acharHub() {
  // 1) Releases do cofre com tag "hub..."
  try {
    const rl = await fetch(`${R.GH}/repos/${R.COFRE}/releases?per_page=30`, { headers: R.hdr(), cache: "no-store" });
    if (rl.ok) {
      const lista = (await rl.json()).filter((r) => !r.draft && /^hub/i.test(r.tag_name || ""));
      lista.sort((a, b) => cmp(numeros(b.tag_name), numeros(a.tag_name)));
      for (const rel of lista) {
        const asset = prefere(rel.assets || []);
        if (asset) {
          return { tipo: "release", asset, nome: asset.name, versao: numeros(rel.tag_name).join(".") };
        }
      }
    }
  } catch (e) {
    console.error("baixar-hub releases:", e && e.message);
  }
  // 2) Pasta hub/ do cofre
  try {
    const r = await fetch(`${R.GH}/repos/${R.COFRE}/contents/hub`, { headers: R.hdr(), cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const arqs = (Array.isArray(j) ? j : []).filter((x) => x.type === "file" && /\.(exe|msi|zip)$/i.test(x.name));
      arqs.sort((a, b) => cmp(numeros(b.name), numeros(a.name)));
      const a = prefere(arqs);
      if (a) return { tipo: "pasta", asset: a, nome: a.name, versao: numeros(a.name).join(".") };
    }
  } catch (e) {
    console.error("baixar-hub pasta:", e && e.message);
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).json({ ok: false, erro: "Metodo nao permitido." });
    }
    if (!process.env.GH_TOKEN) {
      return res.status(500).json({ ok: false, erro: "Servidor sem GH_TOKEN." });
    }
    const h = await acharHub();
    const info = req.query && (req.query.info === "1" || req.query.info === "true");

    if (!h) {
      if (info) return res.status(200).json({ ok: false, erro: "Instalador ainda nao publicado." });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).end(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>TSS Hub</title><body style=\"font-family:sans-serif;background:#0d0c07;color:#efe9c8;padding:2rem\">" +
        "<h1>O TSS Hub ainda n\u00e3o foi publicado</h1><p>Volte em instantes ou fale com a gente no Discord.</p>" +
        '<p><a style="color:#e6cf4a" href="/">Voltar \u00e0 loja</a></p></body>'
      );
    }
    if (info) return res.status(200).json({ ok: true, nome: h.nome, versao: h.versao });

    let url = "";
    if (h.tipo === "release") {
      url = (await R.linkTemporario(h.asset)) || "";
    } else {
      url = h.asset.download_url || "";
      if (!url) {
        const rr = await fetch(h.asset.url, { headers: R.hdr(), cache: "no-store" });
        if (rr.ok) url = (await rr.json()).download_url || "";
      }
    }
    if (!url) return res.status(503).json({ ok: false, erro: "Nao consegui liberar o download. Tente de novo." });
    res.setHeader("Location", url);
    return res.status(302).end();
  } catch (e) {
    return res.status(500).json({ ok: false, erro: "Erro interno." });
  }
};
