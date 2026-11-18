// Login do painel de administrador: Discord + codigo de 12 caracteres enviado no privado pelo bot.
// Nao e rota (comeca com _); e chamado por api/admin.js.
// Quem e admin: o DONO do servidor Discord da TSS, os ids em ADMIN_DISCORD_IDS (Vercel) e os ids
// adicionados na aba "Admins" do painel (guardados no cofre em data.admins).
const crypto = require("crypto");
const L = require("./_cofre");
const A = require("./_auth");

const COOKIE_ADM = "tss_adm";    // admin verificado (8 horas)
const COOKIE_COD = "tss_admc";   // codigo enviado, esperando digitar (5 minutos)
const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0/I/1 para nao confundir
const HORAS = 8;
const DISCORD = "https://discord.com/api/v10";

const guilda = () => process.env.DISCORD_GUILD_ID || "1485508117159481367";
const cab = () => ({ Authorization: "Bot " + process.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json", "User-Agent": "DiscordBot (tss-store, 1.0)" });

let donoCache = { id: "", ate: 0 };
async function donoDoServidor() {
  if (donoCache.id && donoCache.ate > Date.now()) return donoCache.id;
  if (!process.env.DISCORD_BOT_TOKEN) return "";
  try {
    const r = await fetch(DISCORD + "/guilds/" + guilda(), { headers: cab() });
    if (!r.ok) return "";
    const j = await r.json();
    donoCache = { id: String(j.owner_id || ""), ate: Date.now() + 10 * 60000 };
    return donoCache.id;
  } catch (e) { return ""; }
}
const idsEnv = () => String(process.env.ADMIN_DISCORD_IDS || "").split(/[\s,;]+/).filter((x) => /^\d{15,25}$/.test(x));

// Lista de admins: [{id, fonte, nome}]
async function listaAdmins(data) {
  const out = new Map();
  const dono = await donoDoServidor();
  if (dono) out.set(dono, { id: dono, fonte: "dono do servidor", nome: "" });
  idsEnv().forEach((id) => { if (!out.has(id)) out.set(id, { id, fonte: "Vercel", nome: "" }); });
  (data.admins || []).forEach((a) => { if (a && /^\d{15,25}$/.test(String(a.id)) && !out.has(String(a.id))) out.set(String(a.id), { id: String(a.id), fonte: "painel", nome: String(a.nome || "") }); });
  return [...out.values()];
}
// Devolve o ID do Discord (cru) se a conta da sessao for admin; senao "".
async function idDoAdmin(data, uid) {
  const l = await listaAdmins(data);
  const x = l.find((a) => L.idConta("discord", a.id) === uid);
  return x ? x.id : "";
}

function gerarCodigo() {
  let c = "";
  for (let i = 0; i < 12; i++) c += ALFA[crypto.randomInt(ALFA.length)];
  return c;
}
const agrupar = (c) => c.match(/.{4}/g).join("-");
const hashCodigo = (uid, codigo) => A.hmacSessao("admc|" + uid + "|" + codigo);

async function enviarPorDM(userId, codigo) {
  if (!process.env.DISCORD_BOT_TOKEN) throw new L.Falha(500, "O bot do Discord ainda nao esta configurado no servidor.", "config");
  const c = await fetch(DISCORD + "/users/@me/channels", { method: "POST", headers: cab(), body: JSON.stringify({ recipient_id: userId }) });
  if (!c.ok) throw new L.Falha(502, "O bot nao conseguiu abrir uma conversa privada com voce no Discord.", "dm");
  const canal = await c.json();
  const m = await fetch(DISCORD + "/channels/" + canal.id + "/messages", {
    method: "POST", headers: cab(),
    body: JSON.stringify({ allowed_mentions: { parse: [] }, content: "\uD83D\uDD10 **Codigo de verificacao do painel TSS**\n```" + agrupar(codigo) + "```\nVale por 5 minutos. Se nao foi voce, ignore esta mensagem e troque suas senhas." }),
  });
  if (!m.ok) {
    const j = await m.json().catch(() => ({}));
    if (j && j.code === 50007) throw new L.Falha(502, "Seu Discord esta bloqueando mensagens privadas de membros do servidor. Ative em: clique no nome do servidor > Configuracoes de privacidade > Mensagens diretas. Depois tente de novo.", "dm");
    throw new L.Falha(502, "O bot nao conseguiu te mandar a mensagem privada.", "dm");
  }
}

const tentativas = new Map();
function limitar(chave, max, janelaMs) {
  const agora = Date.now(), lista = (tentativas.get(chave) || []).filter((t) => agora - t < janelaMs);
  lista.push(agora); tentativas.set(chave, lista);
  if (tentativas.size > 500) tentativas.clear();
  return lista.length <= max;
}

// Passos antes de entrar: status, enviar_codigo, verificar_codigo, sair
async function etapas(req, res, acao, b) {
  res.setHeader("Cache-Control", "no-store");
  if (acao === "sair") {
    A.limparCookie(res, COOKIE_ADM); A.limparCookie(res, COOKIE_COD);
    return res.status(200).json({ ok: true });
  }
  const s = A.sessao(req);
  if (!s) return res.status(200).json({ ok: true, logado: false });
  const { data } = await L.lerChaves();
  const rawId = await idDoAdmin(data, s.uid);
  const ck = A.cookies(req);
  const adm = A.verificar(ck[COOKIE_ADM]);
  const verificado = !!(rawId && adm && adm.tipo === "adm" && adm.uid === s.uid);
  if (acao === "status") return res.status(200).json({ ok: true, logado: true, nome: s.nome || "", admin: !!rawId, verificado });
  if (!rawId) throw new L.Falha(403, "Esta conta do Discord nao e administradora.", "admin");

  if (acao === "enviar_codigo") {
    if (!limitar("env:" + s.uid, 4, 10 * 60000)) throw new L.Falha(429, "Muitos codigos pedidos. Espere alguns minutos.", "limite");
    const codigo = gerarCodigo();
    await enviarPorDM(rawId, codigo);
    A.setCookie(res, COOKIE_COD, A.assinar({ tipo: "admc", uid: s.uid, h: hashCodigo(s.uid, codigo), exp: Date.now() + 5 * 60000 }), 300);
    return res.status(200).json({ ok: true });
  }
  if (acao === "verificar_codigo") {
    const c = A.verificar(ck[COOKIE_COD]);
    if (!c || c.tipo !== "admc" || c.uid !== s.uid) throw new L.Falha(400, "O codigo venceu ou ainda nao foi enviado. Peca um novo.", "codigo");
    if (!limitar("ver:" + s.uid, 6, 10 * 60000)) throw new L.Falha(429, "Muitas tentativas. Peca um codigo novo daqui a pouco.", "limite");
    const digitado = L.norm(b.codigo);
    if (digitado.length !== 12 || !L.seguro(hashCodigo(s.uid, digitado), c.h)) { await L.sleep(700); throw new L.Falha(401, "Codigo incorreto.", "codigo"); }
    A.limparCookie(res, COOKIE_COD);
    A.setCookie(res, COOKIE_ADM, A.assinar({ tipo: "adm", uid: s.uid, exp: Date.now() + HORAS * 3600000 }), HORAS * 3600);
    return res.status(200).json({ ok: true });
  }
  throw new L.Falha(400, "Acao desconhecida.", "pedido");
}

// Toda acao do painel passa por aqui: Discord + codigo ja verificado.
async function exigirAdmin(req) {
  const s = A.sessao(req);
  if (!s) throw new L.Falha(401, "Entre com o Discord para abrir o painel.", "login");
  const adm = A.verificar(A.cookies(req)[COOKIE_ADM]);
  if (!adm || adm.tipo !== "adm" || adm.uid !== s.uid) throw new L.Falha(401, "Confirme o codigo enviado no seu Discord.", "login");
  const { data } = await L.lerChaves();
  if (!(await idDoAdmin(data, s.uid))) throw new L.Falha(403, "Esta conta nao e mais administradora.", "admin");
  return s;
}

async function listar() {
  const { data } = await L.lerChaves();
  return listaAdmins(data);
}
async function adicionar(b) {
  const id = String(b.id || "").trim();
  if (!/^\d{15,25}$/.test(id)) throw new L.Falha(400, "O ID do Discord tem so numeros (17 a 20). Ative o Modo desenvolvedor no Discord, clique com o botao direito na pessoa e escolha Copiar ID.", "pedido");
  const nome = String(b.nome || "").trim().slice(0, 40);
  await L.mutar((data) => {
    data.admins = Array.isArray(data.admins) ? data.admins : [];
    if (data.admins.some((a) => String(a.id) === id)) return { salvar: false, resultado: true };
    data.admins.push({ id, nome, em: L.agora() });
    return { salvar: true, resultado: true };
  }, "admin adicionado");
}
async function remover(s, b) {
  const id = String(b.id || "").trim();
  if (L.idConta("discord", id) === s.uid) throw new L.Falha(400, "Voce nao pode remover a si mesmo.", "pedido");
  const dono = await donoDoServidor();
  if (id === dono || idsEnv().includes(id)) throw new L.Falha(400, "Esse admin vem do servidor/Vercel e nao sai por aqui.", "pedido");
  await L.mutar((data) => {
    const antes = (data.admins || []).length;
    data.admins = (data.admins || []).filter((a) => String(a.id) !== id);
    return { salvar: data.admins.length !== antes, resultado: true };
  }, "admin removido");
}

module.exports = { etapas, exigirAdmin, listar, adicionar, remover };
