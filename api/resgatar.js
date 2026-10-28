// Pagina de validacao de compra: o comprador informa numero do pedido + e-mail e recebe a chave.
const L = require("./_cofre");

const tentativas = new Map(); // limite simples por IP (por instancia)
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
    const pid = L.idPedido(b.pedido), email = String(b.email || "").trim();
    const NAO = new L.Falha(404, "Nao encontramos essa compra. Confira o numero do pedido e o e-mail usado na compra.", "nao_achei");
    if (!pid || !email.includes("@")) throw NAO;
    const { data } = await L.lerChaves();
    const rec = data.pedidos[pid];
    if (!rec) { await L.sleep(400); throw NAO; }
    if (rec.email && rec.email !== L.hashEmail(email)) { await L.sleep(400); throw NAO; }
    const k = data.keys[rec.h];
    if (!k) throw NAO;
    if (k.revogada) throw new L.Falha(403, "Esta compra foi cancelada ou estornada.", "revogada");
    return res.status(200).json({ ok: true, chave: L.chaveDoPedido(pid, rec.jogo), jogo: rec.jogo });
  } catch (e) { return L.responder(res, e); }
};
