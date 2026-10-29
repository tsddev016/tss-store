// Comprador informa a CHAVE DE RECUPERACAO (REC-XXXXX-...) e recebe de volta a chave de ativacao.
// Sem e-mail, sem nome, sem CPF: so a chave de recuperacao (no cofre fica apenas o hash dela).
const L = require("./_cofre");

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
    const codigo = String(b.recuperacao || "").trim();
    const n = L.norm(codigo);
    if (codigo.length > 60 || (n.length !== 20 && n.length !== 23)) {
      throw new L.Falha(400, "Informe a chave de recuperacao completa (REC-XXXXX-XXXXX-XXXXX-XXXXX).", "dados");
    }

    const NAO = new L.Falha(404, "Nao encontramos essa compra. Confira a chave de recuperacao. Se o problema continuar, fale com o suporte no Discord.", "nao_achei");
    const { data } = await L.lerChaves();
    const achou = L.acharPorRecuperacao(data, codigo);
    if (!achou) { await L.sleep(400); throw NAO; }

    const k = data.keys[achou.rec.h];
    if (!k) throw NAO;
    if (k.revogada) throw new L.Falha(403, "Esta compra foi cancelada ou estornada.", "revogada");

    return res.status(200).json({
      ok: true,
      chave: L.chaveDoPedido(achou.pid, achou.rec.jogo),
      jogo: achou.rec.jogo,
      pedido: achou.pid,
    });
  } catch (e) { return L.responder(res, e); }
};
