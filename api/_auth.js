// Sessao por cookie assinado (HMAC) + provedores de login (Google, Discord, GitHub).
// Arquivos que comecam com _ nao viram rotas na Vercel.
const crypto = require("crypto");
const L = require("./_cofre");

const SESSAO = "tss_sess";
const OAUTH = "tss_oauth";
const DIAS_SESSAO = 30;

const base = () => String(process.env.SITE_URL || "https://tss-store.vercel.app").replace(/\/+$/, "");
const redirectUri = (prov) => base() + "/auth/retorno/" + prov;

const PROVEDORES = {
  google: {
    nome: "Google",
    id: () => process.env.GOOGLE_CLIENT_ID, segredo: () => process.env.GOOGLE_CLIENT_SECRET,
    auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
    escopo: "openid email profile",
  },
  discord: {
    nome: "Discord",
    id: () => process.env.DISCORD_CLIENT_ID, segredo: () => process.env.DISCORD_CLIENT_SECRET,
    auth: "https://discord.com/oauth2/authorize", token: "https://discord.com/api/oauth2/token",
    escopo: "identify email",
  },
  github: {
    nome: "GitHub",
    id: () => process.env.GITHUB_CLIENT_ID, segredo: () => process.env.GITHUB_CLIENT_SECRET,
    auth: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token",
    escopo: "read:user user:email",
  },
};
const configurado = (p) => !!(PROVEDORES[p] && PROVEDORES[p].id() && PROVEDORES[p].segredo());

function segredoSessao() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new L.Falha(500, "Servidor ainda sem SESSION_SECRET configurada.", "config");
  return s;
}
function assinar(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", segredoSessao()).update(p).digest("base64url");
  return p + "." + mac;
}
function verificar(tok) {
  try {
    const [p, mac] = String(tok || "").split(".");
    if (!p || !mac) return null;
    const esp = crypto.createHmac("sha256", segredoSessao()).update(p).digest("base64url");
    const a = Buffer.from(mac), b = Buffer.from(esp);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const d = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!d || !d.exp || d.exp < Date.now()) return null;
    return d;
  } catch (e) { return null; }
}

function cookies(req) {
  const out = {};
  String((req.headers && req.headers.cookie) || "").split(";").forEach((par) => {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, nome, valor, segundos) {
  const c = `${nome}=${encodeURIComponent(valor)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${segundos}`;
  const antes = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [].concat(antes || [], c));
}
const limparCookie = (res, nome) => setCookie(res, nome, "", 0);

function sessao(req) {
  const s = verificar(cookies(req)[SESSAO]);
  return s && s.tipo === "sess" ? s : null;
}
function exigirSessao(req) {
  const s = sessao(req);
  if (!s) throw new L.Falha(401, "Entre na sua conta para continuar.", "login");
  return s;
}
function iniciarSessao(res, c) {
  setCookie(res, SESSAO, assinar({ tipo: "sess", uid: c.uid, nome: c.nome, avatar: c.avatar || "", prov: c.prov, exp: Date.now() + DIAS_SESSAO * 86400000 }), DIAS_SESSAO * 86400);
}

const volta = (v) => { v = String(v || ""); return v.startsWith("/") && !v.startsWith("//") && v.length < 300 ? v : "/conta"; };

async function trocarCodigo(prov, code) {
  const P = PROVEDORES[prov];
  const form = new URLSearchParams({ client_id: P.id(), client_secret: P.segredo(), code, redirect_uri: redirectUri(prov) });
  if (prov !== "github") form.set("grant_type", "authorization_code");
  const r = await fetch(P.token, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "tss-store" }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new L.Falha(502, "Nao consegui concluir o login com " + P.nome + ".", "oauth");
  return j.access_token;
}

async function perfil(prov, token) {
  const h = { Authorization: "Bearer " + token, Accept: "application/json", "User-Agent": "tss-store" };
  if (prov === "google") {
    const j = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: h })).json();
    if (!j.sub) throw new L.Falha(502, "Perfil do Google indisponivel.", "oauth");
    return { id: String(j.sub), nome: j.name || "", email: j.email_verified ? j.email || "" : "", avatar: j.picture || "" };
  }
  if (prov === "discord") {
    const j = await (await fetch("https://discord.com/api/users/@me", { headers: h })).json();
    if (!j.id) throw new L.Falha(502, "Perfil do Discord indisponivel.", "oauth");
    return { id: String(j.id), nome: j.global_name || j.username || "", email: j.verified ? j.email || "" : "",
      avatar: j.avatar ? `https://cdn.discordapp.com/avatars/${j.id}/${j.avatar}.png?size=128` : "" };
  }
  const j = await (await fetch("https://api.github.com/user", { headers: h })).json();
  if (!j.id) throw new L.Falha(502, "Perfil do GitHub indisponivel.", "oauth");
  let email = j.email || "";
  if (!email) {
    try {
      const em = await (await fetch("https://api.github.com/user/emails", { headers: h })).json();
      const p = Array.isArray(em) && (em.find((x) => x.primary && x.verified) || em.find((x) => x.verified));
      email = p ? p.email : "";
    } catch (e) { /* sem e-mail */ }
  }
  return { id: String(j.id), nome: j.name || j.login || "", email, avatar: j.avatar_url || "" };
}

module.exports = { SESSAO, OAUTH, PROVEDORES, configurado, redirectUri, assinar, verificar, cookies, setCookie, limparCookie,
  sessao, exigirSessao, iniciarSessao, volta, trocarCodigo, perfil };
