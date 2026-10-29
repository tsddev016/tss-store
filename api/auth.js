// Login social. Rotas (via rewrite no vercel.json):
//   /auth/entrar/<google|discord|github>?volta=/caminho   -> manda para o provedor
//   /auth/retorno/<provedor>                              -> volta do provedor, cria a conta e a sessao
//   /auth/sair                                            -> encerra a sessao
//   /api/auth?acao=eu | provedores                        -> JSON
const crypto = require("crypto");
const L = require("./_cofre");
const A = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  const acao = String(q.acao || "");
  const prov = String(q.provedor || "").toLowerCase();
  const irPara = (url) => { res.statusCode = 302; res.setHeader("Location", url); res.end(); };
  const erroNaConta = (msg) => irPara("/conta?erro=" + encodeURIComponent(msg));

  try {
    if (acao === "provedores") {
      return res.status(200).json({ ok: true, provedores: Object.keys(A.PROVEDORES).filter(A.configurado).map((p) => ({ id: p, nome: A.PROVEDORES[p].nome })) });
    }
    if (acao === "eu") {
      const s = A.sessao(req);
      return res.status(200).json({ ok: true, logado: !!s, nome: s ? s.nome : "", avatar: s ? s.avatar : "", provedor: s ? s.prov : "" });
    }
    if (acao === "sair") { A.limparCookie(res, A.SESSAO); return irPara("/"); }

    if (acao === "entrar") {
      if (!A.configurado(prov)) return erroNaConta("Login com esse provedor ainda nao esta configurado.");
      const estado = crypto.randomBytes(16).toString("hex");
      A.setCookie(res, A.OAUTH, A.assinar({ tipo: "oauth", estado, prov, volta: A.volta(q.volta), exp: Date.now() + 600000 }), 600);
      const P = A.PROVEDORES[prov];
      const u = new URLSearchParams({ client_id: P.id(), redirect_uri: A.redirectUri(prov), response_type: "code", scope: P.escopo, state: estado });
      if (prov === "google") u.set("prompt", "select_account");
      return irPara(P.auth + "?" + u.toString());
    }

    if (acao === "retorno") {
      if (!A.configurado(prov)) return erroNaConta("Login com esse provedor ainda nao esta configurado.");
      const o = A.verificar(A.cookies(req)[A.OAUTH]);
      A.limparCookie(res, A.OAUTH);
      if (q.error) return erroNaConta("Login cancelado.");
      if (!o || o.tipo !== "oauth" || o.prov !== prov || !q.state || q.state !== o.estado || !q.code) return erroNaConta("Login expirou. Tente de novo.");

      const token = await A.trocarCodigo(prov, String(q.code));
      const p = await A.perfil(prov, token);
      const uid = L.idConta(prov, p.id);
      await L.mutar((data) => {
        const c = data.contas[uid] || (data.contas[uid] = { provedor: prov, criada: L.agora(), aceites: [] });
        // Conta minima: so o codigo do login. Nome, e-mail e foto nao ficam gravados (so no cookie do navegador).
        delete c.nome; delete c.email_login; delete c.avatar;
        c.ultimo_login = L.agora();
        return { salvar: true, resultado: true };
      }, "conta: login");
      A.iniciarSessao(res, { uid, nome: p.nome, avatar: p.avatar, prov });
      return irPara(o.volta || "/conta");
    }

    return res.status(400).json({ ok: false, erro: "Acao desconhecida." });
  } catch (e) {
    if (acao === "entrar" || acao === "retorno") return erroNaConta(e.erro || "Falha no login.");
    return L.responder(res, e);
  }
};
