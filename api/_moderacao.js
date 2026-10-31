// Moderacao do servidor pelo bot (arquivo com _ nao vira rota: nao conta no limite de 12 funcoes).
// Vigia de links/spam = AutoMod do proprio Discord (roda 24h, configurado por /protecao).
// Avisos 1, 2 e 3 = cargos aplicados por /aviso (escada: 1 so cargo, 2 silencio de 10 min, 3 silencio de 1 hora).
const API = "https://discord.com/api/v10";
const ID_OK = /^\d{15,25}$/;
const COR = 0x3ecf8e;
class Erro extends Error {}

async function dc(metodo, caminho, corpo, motivo) {
  const tk = process.env.DISCORD_BOT_TOKEN;
  if (!tk) throw new Erro("O bot ainda não tem DISCORD_BOT_TOKEN configurado na Vercel.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2300);
  const h = { Authorization: "Bot " + tk, "Content-Type": "application/json", "User-Agent": "DiscordBot (tss-store, 1.0)" };
  if (motivo) h["X-Audit-Log-Reason"] = encodeURIComponent(String(motivo).slice(0, 300));
  try {
    const r = await fetch(API + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: ctl.signal });
    const txt = await r.text();
    let j = {};
    try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = {}; }
    if (!r.ok) {
      if (r.status === 403) throw new Erro("O bot não tem permissão para isso. Confira as permissões do bot e se o cargo dele está acima do cargo da pessoa.");
      if (r.status === 404) throw new Erro("Não encontrei o que você pediu (pessoa, canal ou cargo).");
      if (r.status === 429) throw new Erro("O Discord pediu para esperar um pouco. Tente de novo em alguns segundos.");
      throw new Erro("O Discord recusou (" + r.status + (j && j.message ? ": " + String(j.message).slice(0, 140) : "") + ").");
    }
    return j;
  } catch (e) {
    if (e instanceof Erro) throw e;
    throw new Erro("Não consegui falar com o Discord agora. Tente de novo.");
  } finally { clearTimeout(t); }
}

const snowTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
function alvo(it, v) {
  const uid = String(v || "");
  if (!ID_OK.test(uid)) throw new Erro("Escolha uma pessoa.");
  const admins = String(process.env.DISCORD_ADMIN_IDS || "").split(",").map((s) => s.trim());
  const eu = String((it.member && it.member.user && it.member.user.id) || "");
  if (uid === eu) throw new Erro("Você não pode usar isso em você mesmo.");
  if (admins.includes(uid) || uid === String(it.application_id || "")) throw new Erro("Essa pessoa (ou o bot) é protegida e não pode receber essa ação.");
  return uid;
}
const motivoDe = (o, padrao) => String(o.motivo || padrao).slice(0, 200);

async function anunciar(o) {
  const canal = String(o.canal || "");
  if (!ID_OK.test(canal)) throw new Erro("Escolha um canal.");
  const marcar = o.marcar === "everyone" ? "@everyone" : o.marcar === "here" ? "@here" : "";
  await dc("POST", "/channels/" + canal + "/messages", {
    content: marcar || undefined,
    allowed_mentions: { parse: marcar ? [o.marcar] : [] },
    embeds: [{ title: String(o.titulo || "").slice(0, 200), description: String(o.texto || "").replace(/\\n/g, "\n").slice(0, 3500), color: COR, footer: { text: "TSS The Swift Store" } }],
  });
  return "Anúncio enviado em <#" + canal + ">.";
}

async function limpar(o, it) {
  const n = Math.min(100, Math.max(1, Math.floor(Number(o.quantidade)) || 0));
  const msgs = await dc("GET", "/channels/" + it.channel_id + "/messages?limit=" + n);
  const limite = Date.now() - 13.5 * 24 * 3600 * 1000;
  const ids = (Array.isArray(msgs) ? msgs : []).filter((m) => snowTime(m.id) > limite && !m.pinned).map((m) => m.id);
  if (!ids.length) return "Não há mensagens recentes para apagar (o Discord só apaga em massa mensagens com menos de 14 dias).";
  if (ids.length === 1) await dc("DELETE", "/channels/" + it.channel_id + "/messages/" + ids[0]);
  else await dc("POST", "/channels/" + it.channel_id + "/messages/bulk-delete", { messages: ids });
  return ids.length + " mensagem(ns) apagada(s).";
}

async function silenciar(o, it) {
  const uid = alvo(it, o.usuario), min = Math.min(40320, Math.max(1, Math.floor(Number(o.minutos)) || 10));
  await dc("PATCH", "/guilds/" + it.guild_id + "/members/" + uid, { communication_disabled_until: new Date(Date.now() + min * 60000).toISOString() }, motivoDe(o, "Silenciado pelo bot da TSS"));
  return "<@" + uid + "> silenciado por " + min + " minuto(s).";
}
async function tirarSilencio(o, it) {
  const uid = alvo(it, o.usuario);
  await dc("PATCH", "/guilds/" + it.guild_id + "/members/" + uid, { communication_disabled_until: null }, "Silêncio removido pelo bot da TSS");
  return "Silêncio de <@" + uid + "> removido.";
}
async function expulsar(o, it) {
  const uid = alvo(it, o.usuario);
  await dc("DELETE", "/guilds/" + it.guild_id + "/members/" + uid, undefined, motivoDe(o, "Expulso pelo bot da TSS"));
  return "<@" + uid + "> foi expulso.";
}
async function banir(o, it) {
  const uid = alvo(it, o.usuario), dias = Math.min(7, Math.max(0, Math.floor(Number(o.apagar_dias)) || 0));
  await dc("PUT", "/guilds/" + it.guild_id + "/bans/" + uid, { delete_message_seconds: dias * 86400 }, motivoDe(o, "Banido pelo bot da TSS"));
  return "<@" + uid + "> foi banido" + (dias ? " (mensagens dos últimos " + dias + " dia(s) apagadas)" : "") + ".";
}
async function desbanir(o, it) {
  const uid = String(o.id || "").trim();
  if (!ID_OK.test(uid)) throw new Erro("Informe o ID numérico da pessoa banida.");
  await dc("DELETE", "/guilds/" + it.guild_id + "/bans/" + uid, undefined, "Desbanido pelo bot da TSS");
  return "Banimento removido (ID " + uid + ").";
}
async function lentidao(o, it) {
  const s = Math.min(21600, Math.max(0, Math.floor(Number(o.segundos)) || 0));
  await dc("PATCH", "/channels/" + it.channel_id, { rate_limit_per_user: s });
  return s ? "Modo lento: " + s + " segundo(s) entre mensagens." : "Modo lento desligado.";
}
async function trava(it, trancar) {
  const c = await dc("GET", "/channels/" + it.channel_id);
  const ow = (c.permission_overwrites || []).find((x) => x.id === it.guild_id && x.type === 0) || { allow: "0", deny: "0" };
  let allow = BigInt(ow.allow || "0"), deny = BigInt(ow.deny || "0");
  const SEND = 2048n;
  if (trancar) { allow &= ~SEND; deny |= SEND; } else { deny &= ~SEND; }
  await dc("PUT", "/channels/" + it.channel_id + "/permissions/" + it.guild_id, { type: 0, allow: String(allow), deny: String(deny) });
  return trancar ? "🔒 Canal trancado: só a equipe escreve aqui." : "🔓 Canal liberado: todos podem escrever de novo.";
}

// ---- Avisos 1, 2 e 3
const nivelDe = (nome) => { const m = /aviso\s*([123])\b/i.exec(String(nome || "")); return m ? Number(m[1]) : 0; };
async function avisos(it, uid, delta, motivo) {
  const g = it.guild_id;
  const cargos = await dc("GET", "/guilds/" + g + "/roles");
  const porNivel = {};
  (Array.isArray(cargos) ? cargos : []).forEach((r) => { const n = nivelDe(r.name); if (n && !r.managed) porNivel[n] = r.id; });
  if (!porNivel[1] || !porNivel[2] || !porNivel[3]) throw new Erro("Faltam os cargos Aviso 1, Aviso 2 e Aviso 3 no servidor.");
  const m = await dc("GET", "/guilds/" + g + "/members/" + uid);
  const atual = Math.max(0, ...(m.roles || []).map((r) => Number(Object.keys(porNivel).find((n) => porNivel[n] === r)) || 0));
  const novo = atual + delta;
  if (delta > 0 && atual >= 3) return "<@" + uid + "> já está no **Aviso 3**. O próximo passo é com você: `/expulsar` ou `/banir`.";
  if (delta < 0 && atual <= 0) return "<@" + uid + "> não tem nenhum aviso.";
  if (novo > 0) await dc("PUT", "/guilds/" + g + "/members/" + uid + "/roles/" + porNivel[novo], undefined, motivo);
  if (atual > 0) await dc("DELETE", "/guilds/" + g + "/members/" + uid + "/roles/" + porNivel[atual], undefined, motivo);
  let extra = "";
  if (delta > 0 && novo >= 2) {
    const min = novo === 2 ? 10 : 60;
    await dc("PATCH", "/guilds/" + g + "/members/" + uid, { communication_disabled_until: new Date(Date.now() + min * 60000).toISOString() }, motivo);
    extra = " e silenciado por " + (min === 60 ? "1 hora" : min + " minutos");
  }
  if (delta > 0) {
    try {
      await dc("POST", "/channels/" + it.channel_id + "/messages", { content: "⚠️ <@" + uid + "> recebeu o **Aviso " + novo + "** (" + motivo + ").", allowed_mentions: { users: [uid] } });
    } catch (e) { /* o aviso ja foi aplicado */ }
    return "Aviso " + novo + " aplicado em <@" + uid + ">" + extra + ".";
  }
  return novo > 0 ? "<@" + uid + "> voltou para o **Aviso " + novo + "**." : "Todos os avisos de <@" + uid + "> foram removidos.";
}

// ---- AutoMod (vigia de links e spam)
const REGEX_LINKS = [
  "(?i)https?://[^\\s]+",
  "(?i)www\\.[^\\s]+\\.[a-z]{2,}",
  "(?i)discord(app)?\\.com/invite/[^\\s]+",
  "(?i)discord\\.gg/[^\\s]+",
  "(?i)\\b[a-z0-9-]{2,}\\.(com|net|org|gg|io|xyz|ru|tk|ml|ly|me|cc|link|click|top|site|online|shop|app|dev|tv)\\b",
];
const LINKS_OK = ["tss-store.vercel.app", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv", "clips.twitch.tv"];
const MSG_LINK = "Links externos não são permitidos aqui. Só links da loja, do YouTube e da Twitch.";
const EQUIPE = /(administrador|gerente de comunidade|moderador|moderação|staff|dev)/i;

async function protecao(o, it) {
  const g = it.guild_id;
  if (!g) throw new Erro("Use dentro do servidor.");
  const acao = String(o.acao || "status");
  const regras = await dc("GET", "/guilds/" + g + "/auto-moderation/rules");
  const minhas = (Array.isArray(regras) ? regras : []).filter((r) => String(r.name).startsWith("TSS - "));
  if (acao === "status") {
    return minhas.length ? "**Proteção do servidor**\n" + minhas.map((r) => "- " + r.name + ": " + (r.enabled ? "ligada" : "desligada")).join("\n") : "A proteção ainda não foi ativada. Use `/protecao acao:ativar`.";
  }
  if (acao === "desativar") {
    for (const r of minhas) await dc("PATCH", "/guilds/" + g + "/auto-moderation/rules/" + r.id, { enabled: false });
    return minhas.length ? "Proteção desligada (" + minhas.length + " regra(s))." : "Não havia proteção ativada.";
  }
  const canal = ID_OK.test(String(o.canal_alertas || "")) ? String(o.canal_alertas) : "";
  let isentos = [o.cargo_isento1, o.cargo_isento2].filter((x) => ID_OK.test(String(x || ""))).map(String);
  if (!isentos.length) {
    const cargos = await dc("GET", "/guilds/" + g + "/roles");
    isentos = (Array.isArray(cargos) ? cargos : []).filter((r) => !r.managed && r.id !== g && EQUIPE.test(r.name)).map((r) => r.id).slice(0, 20);
  }
  const alerta = canal ? [{ type: 2, metadata: { channel_id: canal } }] : [];
  const defs = [
    { name: "TSS - Links externos", event_type: 1, trigger_type: 1, trigger_metadata: { regex_patterns: REGEX_LINKS, allow_list: LINKS_OK }, actions: [{ type: 1, metadata: { custom_message: MSG_LINK } }, ...alerta] },
    { name: "TSS - Spam", event_type: 1, trigger_type: 3, trigger_metadata: {}, actions: [{ type: 1, metadata: { custom_message: "Mensagem bloqueada: parece spam." } }, ...alerta] },
    { name: "TSS - Excesso de menções", event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 5 }, actions: [{ type: 1, metadata: { custom_message: "Muitas menções numa mensagem só não é permitido." } }, { type: 3, metadata: { duration_seconds: 300 } }, ...alerta] },
  ];
  const linhas = [];
  for (const d of defs) {
    try {
      const corpo = Object.assign({ enabled: true, exempt_roles: isentos }, d);
      const ex = minhas.find((r) => r.name === d.name);
      if (ex) { delete corpo.trigger_type; await dc("PATCH", "/guilds/" + g + "/auto-moderation/rules/" + ex.id, corpo); }
      else await dc("POST", "/guilds/" + g + "/auto-moderation/rules", corpo);
      linhas.push("✅ " + d.name);
    } catch (e) { linhas.push("⚠️ " + d.name + ": " + (e instanceof Erro ? e.message : "erro")); }
  }
  return "**Proteção ativada**\n" + linhas.join("\n") + "\nAlertas para a equipe: " + (canal ? "<#" + canal + ">" : "desligados (escolha `canal_alertas`)") + "\nCargos que podem mandar link: " + (isentos.length ? isentos.map((r) => "<@&" + r + ">").join(" ") : "só quem é administrador") + "\nLinks liberados: site da loja, YouTube e Twitch.";
}

const NOMES = ["anunciar", "limpar", "silenciar", "tirar-silencio", "expulsar", "banir", "desbanir", "lentidao", "trancar", "destrancar", "aviso", "remover-aviso", "protecao"];
async function executar(nome, o, it) {
  try {
    if (nome === "anunciar") return await anunciar(o);
    if (nome === "limpar") return await limpar(o, it);
    if (nome === "silenciar") return await silenciar(o, it);
    if (nome === "tirar-silencio") return await tirarSilencio(o, it);
    if (nome === "expulsar") return await expulsar(o, it);
    if (nome === "banir") return await banir(o, it);
    if (nome === "desbanir") return await desbanir(o, it);
    if (nome === "lentidao") return await lentidao(o, it);
    if (nome === "trancar") return await trava(it, true);
    if (nome === "destrancar") return await trava(it, false);
    if (nome === "aviso") return await avisos(it, alvo(it, o.usuario), 1, motivoDe(o, "Sem motivo informado"));
    if (nome === "remover-aviso") return await avisos(it, alvo(it, o.usuario), -1, "Aviso removido pelo bot da TSS");
    if (nome === "protecao") return await protecao(o, it);
  } catch (e) { if (e instanceof Erro) return e.message; throw e; }
  return "Comando desconhecido.";
}
module.exports = { executar, NOMES, REGEX_LINKS, LINKS_OK };
