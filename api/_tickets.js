// Tickets de suporte do bot do Discord (arquivo com _ nao vira rota: nao conta no limite de 12 funcoes).
// Sem banco: a configuracao do painel viaja dentro do custom_id dos botoes e o dono do ticket fica no topico do canal.
const API = "https://discord.com/api/v10";
const ID_OK = /^\d{15,25}$/;
// Ver canal, enviar mensagens, anexar arquivos, inserir links e ler historico.
const PERM = "117760";
const VER = "1024";
const COR = 0x3ecf8e;

const MOTIVOS = [
  { value: "reembolso", label: "Reembolso", description: "Pedir a devolução de uma compra", emoji: { name: "💸" }, dica: "Informe o **número do pedido** e conte o motivo do pedido de reembolso." },
  { value: "recuperacao", label: "Recuperação de conta", description: "Não consigo entrar na minha conta", emoji: { name: "🔑" }, dica: "Conte o que aconteceu e com qual login você comprou. Nunca envie senhas." },
  { value: "ajuda", label: "Ajuda", description: "Dúvida ou problema com um jogo ou chave", emoji: { name: "🛠️" }, dica: "Explique o problema e, se puder, mande um print." },
  { value: "informacao", label: "Informação", description: "Perguntas sobre jogos, preços e a loja", emoji: { name: "ℹ️" }, dica: "Pode perguntar o que quiser sobre a loja e os jogos." },
];

class ErroTicket extends Error {}

async function api(metodo, caminho, corpo) {
  const tk = process.env.DISCORD_BOT_TOKEN;
  if (!tk) throw new ErroTicket("O bot ainda não tem DISCORD_BOT_TOKEN configurado na Vercel.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2300);
  try {
    const r = await fetch(API + caminho, {
      method: metodo,
      headers: { Authorization: "Bot " + tk, "Content-Type": "application/json", "User-Agent": "DiscordBot (tss-store, 1.0)" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = {};
    try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = {}; }
    if (!r.ok) {
      if (r.status === 403) throw new ErroTicket("O bot não tem permissão para fazer isso (veja Gerenciar Canais e o acesso à categoria/canal).");
      if (r.status === 404) throw new ErroTicket("Canal ou categoria não encontrado.");
      throw new ErroTicket("O Discord recusou o pedido (" + r.status + (j && j.message ? ": " + String(j.message).slice(0, 120) : "") + ").");
    }
    return j;
  } catch (e) {
    if (e instanceof ErroTicket) throw e;
    throw new ErroTicket("Não consegui falar com o Discord agora. Tente de novo.");
  } finally { clearTimeout(t); }
}

const cfg = (cat, roles) => cat + ":" + roles.join(",");
function lerCfg(parts) {
  const cat = parts[2] || "", roles = String(parts[3] || "").split(",").filter(Boolean);
  if (!ID_OK.test(cat) || !roles.length || !roles.every((r) => ID_OK.test(r))) throw new ErroTicket("Este painel está com a configuração inválida. Peça para a equipe gerar o painel de novo.");
  return { cat, roles };
}
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "usuario";
const efemera = (data) => ({ type: 4, data: Object.assign({ flags: 64, allowed_mentions: { parse: [] } }, data) });

// /gerar-ticket (so quem esta em DISCORD_ADMIN_IDS): envia o painel com o botao "Criar ticket".
async function gerarPainel(it, o) {
  if (!it.guild_id) return "Use este comando dentro do servidor.";
  const canal = String(o.canal || ""), cat = String(o.categoria || "");
  const roles = [...new Set([o.cargo1, o.cargo2, o.cargo3].filter(Boolean).map(String))];
  if (!ID_OK.test(canal) || !ID_OK.test(cat) || !roles.length || !roles.every((r) => ID_OK.test(r))) return "Escolha o canal, a categoria e pelo menos um cargo.";
  await api("POST", "/channels/" + canal + "/messages", {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Suporte – TSS The Swift Store",
      description: "Precisa de ajuda? Clique em **Criar ticket**, escolha o motivo e abriremos um canal privado só para você e para a nossa equipe.\n\n" +
        MOTIVOS.map((m, i) => (i + 1) + ". **" + m.label + "** – " + m.description).join("\n") +
        "\n\nNunca envie senhas ou dados de cartão.",
      color: COR,
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Criar ticket", emoji: { name: "🎫" }, custom_id: "tk:abrir:" + cfg(cat, roles) }] }],
  });
  return "Painel de tickets enviado em <#" + canal + ">. Os tickets serão criados na categoria <#" + cat + "> e ficam visíveis para " + roles.map((r) => "<@&" + r + ">").join(", ") + " e para quem abriu.";
}

function menuMotivos(parts) {
  const { cat, roles } = lerCfg(parts);
  return efemera({
    content: "Qual é o motivo do ticket?",
    components: [{ type: 1, components: [{
      type: 3, custom_id: "tk:motivo:" + cfg(cat, roles), placeholder: "Escolha o motivo",
      options: MOTIVOS.map((m) => ({ label: m.label, value: m.value, description: m.description, emoji: m.emoji })),
    }] }],
  });
}

async function criarTicket(it, parts, motivoId) {
  if (!it.guild_id) throw new ErroTicket("Use dentro do servidor.");
  const { cat, roles } = lerCfg(parts);
  const m = MOTIVOS.find((x) => x.value === motivoId);
  if (!m) throw new ErroTicket("Motivo inválido.");
  const user = (it.member && it.member.user) || {};
  const uid = String(user.id || "");
  if (!ID_OK.test(uid)) throw new ErroTicket("Não consegui identificar você.");
  const canais = await api("GET", "/guilds/" + it.guild_id + "/channels");
  const ja = (Array.isArray(canais) ? canais : []).find((c) => c.parent_id === cat && String(c.topic || "").startsWith("tss-ticket:" + uid + ":"));
  if (ja) return efemera({ content: "Você já tem um ticket aberto: <#" + ja.id + ">. Use ele ou peça para a equipe fechar antes de abrir outro." });
  const dono = { type: 1, allow: PERM, deny: "0" };
  const overwrites = [
    { id: it.guild_id, type: 0, allow: "0", deny: VER },
    Object.assign({ id: uid }, dono),
    ...roles.map((r) => ({ id: r, type: 0, allow: PERM, deny: "0" })),
  ];
  if (ID_OK.test(String(it.application_id || ""))) overwrites.push(Object.assign({ id: String(it.application_id) }, dono));
  const canal = await api("POST", "/guilds/" + it.guild_id + "/channels", {
    name: m.value + "-" + slug(user.username || user.global_name),
    type: 0, parent_id: cat,
    topic: ("tss-ticket:" + uid + ":" + roles.join(",") + ":" + m.value).slice(0, 1000),
    permission_overwrites: overwrites,
  });
  try {
    await api("POST", "/channels/" + canal.id + "/messages", {
      content: "<@" + uid + "> " + roles.map((r) => "<@&" + r + ">").join(" "),
      allowed_mentions: { users: [uid], roles },
      embeds: [{ title: "Ticket: " + m.label, description: "Olá! " + m.dica + "\n\nA equipe responde por aqui assim que puder. Nunca envie senhas ou dados de cartão.", color: COR }],
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "Fechar ticket", emoji: { name: "🔒" }, custom_id: "tk:fechar" }] }],
    });
  } catch (e) { /* o canal ja existe; a equipe ve o ticket mesmo sem a mensagem de boas-vindas */ }
  return efemera({ content: "Ticket criado: <#" + canal.id + ">" });
}

// Fechar: tira o acesso de quem abriu e renomeia o canal (a equipe apaga o canal depois, se quiser).
async function fecharTicket(it) {
  const canal = await api("GET", "/channels/" + it.channel_id);
  const t = String(canal.topic || "").split(":");
  if (t[0] !== "tss-ticket" || !ID_OK.test(t[1] || "")) return efemera({ content: "Este canal não é um ticket." });
  const dono = t[1], roles = String(t[2] || "").split(",").filter(Boolean);
  const m = it.member || {}, quem = String((m.user && m.user.id) || "");
  const admins = String(process.env.DISCORD_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let gerencia = false;
  try { const p = BigInt(m.permissions || "0"); gerencia = (p & 8n) === 8n || (p & 16n) === 16n; } catch (e) { gerencia = false; }
  const pode = quem === dono || admins.includes(quem) || gerencia || (m.roles || []).some((r) => roles.includes(String(r)));
  if (!pode) return efemera({ content: "Só quem abriu o ticket ou a equipe pode fechar." });
  const ow = (canal.permission_overwrites || []).map((x) => (x.id === dono ? { id: x.id, type: x.type, allow: "0", deny: VER } : { id: x.id, type: x.type, allow: x.allow, deny: x.deny }));
  await api("PATCH", "/channels/" + it.channel_id, { name: ("fechado-" + String(canal.name || "ticket").replace(/^fechado-/, "")).slice(0, 100), permission_overwrites: ow });
  return { type: 7, data: { content: "🔒 Ticket fechado por <@" + quem + ">. A equipe pode apagar este canal quando quiser.", components: [], allowed_mentions: { parse: [] } } };
}

// Cliques em botoes e menus (type 3). Qualquer membro pode clicar; so o painel (/gerar-ticket) e restrito.
async function componente(it) {
  const id = String((it.data && it.data.custom_id) || "");
  const parts = id.split(":");
  if (parts[0] !== "tk") return efemera({ content: "Botão desconhecido." });
  try {
    if (parts[1] === "abrir") return menuMotivos(parts);
    if (parts[1] === "motivo") return await criarTicket(it, parts, String(((it.data && it.data.values) || [])[0] || ""));
    if (parts[1] === "fechar") return await fecharTicket(it);
  } catch (e) {
    if (e instanceof ErroTicket) return efemera({ content: e.message });
    throw e;
  }
  return efemera({ content: "Botão desconhecido." });
}

module.exports = { gerarPainel, componente, MOTIVOS, ErroTicket };
