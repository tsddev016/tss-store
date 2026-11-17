// Login do TSS Hub: usuario + senha criados no site (depois do login com o Discord).
// Nao e rota (comeca com _); e chamado por /api/auth?acao=hub.
//   GET  (com sessao do site)            -> { tem_login, usuario }
//   POST { acao:"criar", usuario, senha } (com sessao do site) -> cria ou troca o login do Hub
//   POST { acao:"entrar", usuario, senha }                      -> { token, usuario, jogos }
//   POST { acao:"eu", token }                                   -> { usuario, jogos }
const crypto = require("crypto");
const L = require("./_cofre");
const A = require("./_auth");
const R = require("./_release");

const DIAS_HUB = 30;
const scrypt = (senha, salt) => new Promise((ok, no) => crypto.scrypt(String(senha), salt, 32, (e, k) => (e ? no(e) : ok(k))));

async function gerarHash(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "s1$" + salt + "$" + (await scrypt(senha, salt)).toString("hex");
}
async function conferir(senha, guardado) {
  const [v, salt, h] = String(guardado || "s1$00$00").split("$");
  if (v !== "s1" || !salt || !h) return false;
  const a = await scrypt(senha, salt), b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const tentativas = new Map();
function limitar(chave, max, janelaMs) {
  const agora = Date.now(), lista = (tentativas.get(chave) || []).filter((t) => agora - t < janelaMs);
  lista.push(agora); tentativas.set(chave, lista);
  if (tentativas.size > 2000) tentativas.clear();
  return lista.length <= max;
}

const usuarioOk = (u) => /^[a-z0-9_.-]{3,20}$/.test(u);
const normUsuario = (u) => String(u || "").trim().toLowerCase();

async function nomesDeJogos() {
  try { const cat = await R.lerCatalogo(); const m = {}; ((cat && cat.games) || []).forEach((g) => { m[g.id] = g.name; }); return m; } catch (e) { return {}; }
}
function jogosDaConta(data, uid, nomes) {
  return Object.entries(data.pedidos).filter(([, r]) => r.conta === uid).map(([p, r]) => {
    const k = data.keys[r.h];
    const rb = data.reembolsos[p];
    const ativa = !(rb && rb.estado === "reembolsado") && !(k && k.revogada);
    return ativa ? { jogo: r.jogo, nome: nomes[r.jogo] || r.jogo, pedido: p, chave: L.chaveDoPedido(p, r.jogo) } : null;
  }).filter(Boolean);
}

function tokenDoPedido(req, b) {
  const h = String((req.headers && req.headers.authorization) || "");
  const t = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : String(b.token || "");
  const d = A.verificar(t);
  return d && d.tipo === "hub" ? d : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const ip = String((req.headers["x-forwarded-for"] || "").split(",")[0] || "x").trim();

  if (req.method === "GET") {
    const s = A.exigirSessao(req);
    const { data } = await L.lerChaves();
    const c = data.contas[s.uid];
    if (!c) throw new L.Falha(401, "Conta nao encontrada. Entre de novo.", "login");
    return res.status(200).json({ ok: true, tem_login: !!c.hub_hash, usuario: c.hub_user || "" });
  }
  if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");

  const b = L.corpo(req);
  const acao = String(b.acao || "");

  if (acao === "criar") {
    const s = A.exigirSessao(req);
    if (!limitar("criar:" + ip, 10, 60000)) throw new L.Falha(429, "Muitas tentativas. Espere um minuto.", "limite");
    const usuario = normUsuario(b.usuario);
    const senha = String(b.senha || "");
    if (!usuarioOk(usuario)) throw new L.Falha(400, "O usuario precisa ter de 3 a 20 caracteres: letras, numeros, _ . ou -", "usuario");
    if (senha.length < 8 || senha.length > 72) throw new L.Falha(400, "A senha precisa ter de 8 a 72 caracteres.", "senha");
    const hash = await gerarHash(senha);
    await L.mutar((data) => {
      const c = data.contas[s.uid];
      if (!c) throw new L.Falha(401, "Conta nao encontrada. Entre de novo.", "login");
      for (const [id, x] of Object.entries(data.contas)) {
        if (id !== s.uid && x.hub_user === usuario) throw new L.Falha(409, "Esse nome de usuario ja existe. Escolha outro.", "usuario");
      }
      c.hub_user = usuario; c.hub_hash = hash; c.hub_atualizado = L.agora();
      return { salvar: true, resultado: true };
    }, "conta: login do hub");
    return res.status(200).json({ ok: true, usuario });
  }

  if (acao === "entrar") {
    const usuario = normUsuario(b.usuario);
    const senha = String(b.senha || "");
    if (!limitar("ip:" + ip, 12, 60000) || !limitar("u:" + usuario, 8, 600000)) throw new L.Falha(429, "Muitas tentativas. Espere alguns minutos.", "limite");
    const { data } = await L.lerChaves();
    const achada = usuarioOk(usuario) ? Object.entries(data.contas).find(([, c]) => c.hub_user === usuario) : null;
    const ok = await conferir(senha, achada ? achada[1].hub_hash : null);
    if (!achada || !ok || senha.length < 1) throw new L.Falha(401, "Usuario ou senha incorretos.", "login_hub");
    const uid = achada[0];
    const token = A.assinar({ tipo: "hub", uid, usuario, exp: Date.now() + DIAS_HUB * 86400000 });
    return res.status(200).json({ ok: true, token, usuario, jogos: jogosDaConta(data, uid, await nomesDeJogos()) });
  }

  if (acao === "eu") {
    const d = tokenDoPedido(req, b);
    if (!d) throw new L.Falha(401, "Sessao do Hub expirada. Entre de novo.", "login_hub");
    const { data } = await L.lerChaves();
    const c = data.contas[d.uid];
    if (!c || c.hub_user !== d.usuario) throw new L.Falha(401, "Login do Hub nao vale mais. Entre de novo.", "login_hub");
    return res.status(200).json({ ok: true, usuario: d.usuario, jogos: jogosDaConta(data, d.uid, await nomesDeJogos()) });
  }

  throw new L.Falha(400, "Acao desconhecida.", "pedido");
};
