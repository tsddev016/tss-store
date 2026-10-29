// Acha release + asset .zip no cofre por id do jogo, versão e nome do arquivo.
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

function variantesId(jogo) {
  const j = String(jogo || "").toLowerCase();
  const und = j.replace(/-/g, "_");
  const hif = j.replace(/_/g, "-");
  return [...new Set([j, und, hif].filter(Boolean))];
}

function tagsCandidatas(jogo, versao) {
  const v = String(versao || "");
  const out = [];
  for (const id of variantesId(jogo)) {
    out.push(id + "-v" + v);
    out.push(id + "-v" + v.replace(/\./g, "_"));
    out.push(id + "_v" + v);
    out.push(id + "-" + v);
    out.push("v" + v + "-" + id);
  }
  return [...new Set(out)];
}

function scoreTag(tag, jogo, versao) {
  const t = String(tag || "").toLowerCase();
  const ids = variantesId(jogo);
  const v = String(versao || "").toLowerCase();
  let s = 0;
  for (const id of ids) {
    if (t === id + "-v" + v) s += 100;
    if (t.startsWith(id + "-v") || t.startsWith(id + "_v") || t.startsWith(id + "-")) s += 40;
    if (t.includes(id)) s += 15;
  }
  if (v && t.includes(v)) s += 20;
  return s;
}

function scoreAsset(name, jogo) {
  const n = String(name || "").toLowerCase();
  if (!/\.zip$/i.test(n)) return -1;
  let s = 10;
  for (const id of variantesId(jogo)) {
    const partes = id.split(/[-_]/).filter(Boolean);
    if (n.includes(id)) s += 50;
    for (const p of partes) if (p.length > 2 && n.includes(p)) s += 8;
  }
  if (/demo/i.test(n) && /demo/i.test(jogo)) s += 25;
  if (/demo/i.test(n) && !/demo/i.test(jogo)) s -= 30;
  return s;
}

async function lerCatalogo() {
  const r = await fetch(`${GH}/repos/${SITE}/contents/public/catalog.json`, {
    headers: hdr({ Accept: "application/vnd.github.raw+json" }),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return r.json();
}

async function acharRelease(jogo, versao) {
  // 1) tags exatas
  for (const tag of tagsCandidatas(jogo, versao)) {
    const r = await fetch(`${GH}/repos/${COFRE}/releases/tags/${encodeURIComponent(tag)}`, { headers: hdr() });
    if (r.ok) return await r.json();
  }

  // 2) lista releases e pontua
  const rl = await fetch(`${GH}/repos/${COFRE}/releases?per_page=50`, { headers: hdr() });
  if (!rl.ok) return null;
  const lista = await rl.json();
  if (!Array.isArray(lista) || !lista.length) return null;

  let melhor = null, melhorScore = 0;
  for (const rel of lista) {
    if (rel.draft) continue;
    const sc = scoreTag(rel.tag_name, jogo, versao);
    if (sc > melhorScore) {
      melhorScore = sc;
      melhor = rel;
    }
  }
  return melhorScore >= 15 ? melhor : null;
}

function acharAsset(rel, jogo) {
  const assets = (rel && rel.assets) || [];
  if (!assets.length) return null;
  let melhor = null, melhorScore = -1;
  for (const a of assets) {
    const sc = scoreAsset(a.name, jogo);
    if (sc > melhorScore) {
      melhorScore = sc;
      melhor = a;
    }
  }
  // fallback: qualquer zip
  if (!melhor || melhorScore < 0) {
    melhor = assets.find((x) => /\.zip$/i.test(x.name)) || assets[0];
  }
  return melhor || null;
}

async function linkTemporario(asset) {
  const rd = await fetch(asset.url, {
    headers: hdr({ Accept: "application/octet-stream" }),
    redirect: "manual",
  });
  const loc = rd.headers.get("location");
  if (!loc || ![301, 302, 303, 307, 308].includes(rd.status)) return null;
  return loc;
}

/**
 * Resolve jogo no catalogo + release no cofre + asset .zip + URL temporaria.
 * @returns {{ g, rel, asset, url, sha256, versao }}
 */
async function resolverDownload(jogo) {
  const cat = await lerCatalogo();
  if (!cat) throw Object.assign(new Error("Catalogo indisponivel."), { codigo: "catalogo", status: 503 });
  const g = (cat.games || []).find((x) => x.id === jogo);
  if (!g) throw Object.assign(new Error("Jogo nao encontrado no catalogo."), { codigo: "sem_jogo", status: 404 });

  const rel = await acharRelease(jogo, g.version);
  if (!rel) {
    throw Object.assign(
      new Error("A versao " + g.version + " deste jogo ainda nao foi publicada no cofre."),
      { codigo: "sem_release", status: 404 }
    );
  }

  const asset = acharAsset(rel, jogo);
  if (!asset) throw Object.assign(new Error("Arquivo do jogo nao encontrado."), { codigo: "sem_arquivo", status: 404 });

  const url = await linkTemporario(asset);
  if (!url) throw Object.assign(new Error("Nao consegui liberar o download. Tente de novo."), { codigo: "download", status: 503 });

  // Prefer digest do GitHub se existir (sha256:...)
  let sha256 = g.sha256 || "";
  const dig = String(asset.digest || "");
  if (dig.startsWith("sha256:")) sha256 = dig.slice(7);

  return {
    g,
    rel,
    asset,
    url,
    sha256,
    versao: String(g.version),
    tag: rel.tag_name,
    nome: asset.name,
  };
}

module.exports = {
  hdr, GH, COFRE, SITE,
  variantesId, tagsCandidatas, acharRelease, acharAsset, linkTemporario,
  lerCatalogo, resolverDownload,
};
