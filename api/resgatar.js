// Comprador informa numero do pedido + e-mail da compra e recebe a chave.
// O e-mail so existe gravado como codigo HMAC; CPF e nome nao sao guardados.
const L = require("./_cofre");
const A = require("./_auth");

const tentativas = new Map();
function limitar(ip) {
  const agora = Date.now(), lista = (tentativas.get(ip) || []).filter((t) => agora - t < 60000);
  lista.push(agora); tentativas.set(ip, lista);
  if (tentativas.size > 500) tentativas.clear();
  return lista.length <= 8;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");
    const ip = String((req.headers["x-forwarded-for"] || "").split(",")[0] || "x").trim();
    if (!limitar(ip)) throw new L.Falha(429, "Muitas tentativas. Espere um minuto.", "limite");

    const b = L.corpo(req);
    const pid = L.idPedido(b.pedido);
    const email = String(b.email || "").trim();

    const NAO = new L.Falha(404, "Nao encontramos essa compra. Confira o numero do pedido e o e-mail usado na compra. Se o problema continuar, fale com o suporte.", "nao_achei");
    if (!pid) throw NAO;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new L.Falha(400, "Informe o e-mail usado na compra.", "dados");

    const { data } = await L.lerChaves();
    const rec = data.pedidos[pid];
    if (!rec) { await L.sleep(400); throw NAO; }

    // Confere o e-mail (comparado como codigo HMAC). Pedido sem e-mail gravado nao se resgata sozinho: vai pelo suporte.
    const ok = !!rec.email && L.seguro(rec.email, L.hashEmail(email));
    if (!ok) { await L.sleep(400); throw NAO; }

    const k = data.keys[rec.h];
    if (!k) throw NAO;
    if (k.revogada) throw new L.Falha(403, "Esta compra foi cancelada ou estornada.", "revogada");

    // Se o comprador esta logado, guarda a compra na conta dele.
    let salvaNaConta = false;
    try {
      const sess = A.sessao(req);
      if (sess && !rec.conta) {
        salvaNaConta = await L.mutar((d) => {
          const r = d.pedidos[pid];
          if (r && !r.conta && d.contas[sess.uid]) { r.conta = sess.uid; return { salvar: true, resultado: true }; }
          return { salvar: false, resultado: false };
        }, "conta: vincula compra");
      } else if (sess && rec.conta === sess.uid) salvaNaConta = true;
    } catch (e) { /* login nao configurado: segue sem vincular */ }

    return res.status(200).json({
      ok: true,
      chave: L.chaveDoPedido(pid, rec.jogo),
      jogo: rec.jogo,
      salva_na_conta: salvaNaConta,
    });
  } catch (e) { return L.responder(res, e); }
};
