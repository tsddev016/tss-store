// Alerta de novo login: avisa a pessoa no Discord (DM do bot) e, se configurado, por e-mail.
// Nao e rota (comeca com _). NADA daqui e gravado: IP, provedor e e-mail so passam pela memoria
// durante o login, so para montar a mensagem. Falha aqui NUNCA derruba o login (tudo com timeout e try/catch).
const A = require("./_auth");

const DISCORD = "https://discord.com/api/v10";
const base = () => String(process.env.SITE_URL || "https://tss-store.vercel.app").replace(/\/+$/, "");
const lim = (s, n) => String(s == null || s === "" ? "nao identificado" : s).slice(0, n);

function decodificar(v) { try { return decodeURIComponent(String(v || "")); } catch (e) { return String(v || ""); } }

function ipDoPedido(req) {
  const h = (req && req.headers) || {};
  const xf = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(h["x-real-ip"] || "").trim() || "";
}

// Regiao pelos cabecalhos da Vercel (sem custo) + nome do provedor de internet por consulta ao IP.
async function infoDeOnde(req, fetchFn) {
  const h = (req && req.headers) || {};
  const ip = ipDoPedido(req);
  const info = {
    ip,
    pais: decodificar(h["x-vercel-ip-country"]),
    regiao: decodificar(h["x-vercel-ip-country-region"]),
    cidade: decodificar(h["x-vercel-ip-city"]),
    provedor: "",
  };
  const f = fetchFn || fetch;
  if (ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip)) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    try {
      const r = await f("https://ipwho.is/" + encodeURIComponent(ip) + "?fields=success,country,region,city,connection", { signal: ctl.signal, headers: { "User-Agent": "tss-store" } });
      const j = await r.json().catch(() => ({}));
      if (j && j.success !== false) {
        const c = j.connection || {};
        info.provedor = c.isp || c.org || "";
        if (!info.cidade) info.cidade = j.city || "";
        if (!info.regiao) info.regiao = j.region || "";
        if (!info.pais) info.pais = j.country || "";
      }
    } catch (e) { /* sem provedor: a mensagem diz "nao identificado" */ } finally { clearTimeout(t); }
  }
  return info;
}

function onde(info) {
  const partes = [info.cidade, info.regiao, info.pais].filter(Boolean);
  return partes.length ? partes.join(", ") : "nao identificada";
}

function quando() {
  try { return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }) + " (Brasilia)"; }
  catch (e) { return new Date().toISOString(); }
}

function montarTexto({ titulo, info, linkRedefinir }) {
  const linhas = [
    "\uD83D\uDEA8 **" + titulo + "**",
    "",
    "**Quando:** " + quando(),
    "**Regiao:** " + lim(onde(info), 120),
    "**Provedor de internet:** " + lim(info.provedor, 120),
    "**Endereco IP:** " + lim(info.ip, 60),
    "",
    "Se foi voce, pode ignorar esta mensagem.",
  ];
  if (linkRedefinir) {
    linhas.push("Se **nao** foi voce, redefina a senha do seu login do TSS Hub agora (o link vale por 30 minutos e so funciona uma vez):", linkRedefinir);
  } else {
    linhas.push("Se **nao** foi voce, troque a senha da sua conta do Discord e fale com a equipe da TSS.");
  }
  return linhas.join("\n");
}

async function enviarDM(userId, texto, fetchFn) {
  const bot = process.env.DISCORD_BOT_TOKEN;
  if (!bot || !/^\d{15,25}$/.test(String(userId))) return false;
  const f = fetchFn || fetch;
  const cab = { Authorization: "Bot " + bot, "Content-Type": "application/json", "User-Agent": "DiscordBot (tss-store, 1.0)" };
  const c = await f(DISCORD + "/users/@me/channels", { method: "POST", headers: cab, body: JSON.stringify({ recipient_id: String(userId) }) });
  if (!c.ok) return false;
  const canal = await c.json();
  const m = await f(DISCORD + "/channels/" + canal.id + "/messages", { method: "POST", headers: cab, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: texto.slice(0, 1900) }) });
  return m.ok;
}

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Precisa de RESEND_API_KEY e ALERTA_EMAIL_DE (ex.: "TSS <aviso@seudominio.com>", dominio verificado no Resend).
async function enviarEmail(para, assunto, texto, fetchFn) {
  const chave = process.env.RESEND_API_KEY, de = process.env.ALERTA_EMAIL_DE;
  if (!chave || !de || !para || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return false;
  const f = fetchFn || fetch;
  const limpo = texto.replace(/\*\*/g, "");
  const html = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5\">" +
    escHtml(limpo).replace(/(https:\/\/[^\s<]+)/g, "<a href=\"$1\">$1</a>").replace(/\n/g, "<br>") + "</div>";
  const r = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
    body: JSON.stringify({ from: de, to: [para], subject: assunto, text: limpo, html }),
  });
  return r.ok;
}

// Avisa por todos os canais disponiveis. Espera no maximo ~5 s e nunca lanca erro.
async function avisarLogin({ req, discordId, email, titulo, linkRedefinir, fetchFn }) {
  try {
    const info = await infoDeOnde(req, fetchFn);
    const texto = montarTexto({ titulo, info, linkRedefinir });
    const tarefas = [
      enviarDM(discordId, texto, fetchFn).catch(() => false),
      enviarEmail(email, "TSS: novo login detectado na sua conta", texto, fetchFn).catch(() => false),
    ];
    const teto = new Promise((ok) => setTimeout(() => ok([false, false]), 5000));
    const [dm, mail] = await Promise.race([Promise.all(tarefas), teto]);
    return { dm: !!dm, email: !!mail, info };
  } catch (e) { return { dm: false, email: false, info: null }; }
}

// Link de redefinicao: assinado, vale 30 min e so uma vez (a assinatura amarra na senha atual: ao trocar a senha, o link morre).
const impressao = (hubHash) => A.hmacSessao("rst|" + String(hubHash || ""));
function linkDeRedefinicao(uid, hubHash) {
  const tok = A.assinar({ tipo: "reset", uid, f: impressao(hubHash), exp: Date.now() + 30 * 60000 });
  return base() + "/redefinir#t=" + tok;
}

module.exports = { avisarLogin, linkDeRedefinicao, impressao, infoDeOnde, montarTexto, enviarDM, enviarEmail, ipDoPedido };
