// Comprador informa numero do pedido + CPF e recebe a chave.
// E-mail continua aceito como fallback (compras antigas / site).
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
    const pid = L.idPedido(b.pedido);
    const cpf = L.normalizarCpf(b.cpf);
    const email = String(b.email || "").trim();
    const nome = String(b.nome || "").trim();

    const NAO = new L.Falha(404, "Nao encontramos essa compra. Confira o numero do pedido e o CPF.", "nao_achei");
    if (!pid) throw NAO;
    if (!cpf && !email.includes("@")) throw new L.Falha(400, "Informe o CPF usado na compra (ou o e-mail, se comprou no site).", "dados");

    const { data } = await L.lerChaves();
    const rec = data.pedidos[pid];
    if (!rec) { await L.sleep(400); throw NAO; }

    // Preferencia: CPF. Fallback: e-mail (pedidos antigos).
    let ok = false;
    if (cpf && rec.cpf) {
      ok = rec.cpf === L.hashCpf(cpf);
    } else if (cpf && !rec.cpf && !rec.email) {
      // pedido sem dado de comprador (webhook sem CPF) — libera com CPF valido
      ok = L.cpfValido(cpf);
    } else if (email.includes("@") && rec.email) {
      ok = rec.email === L.hashEmail(email);
    } else if (!rec.cpf && !rec.email) {
      // sem vinculo: exige CPF valido
      ok = cpf && L.cpfValido(cpf);
    }

    if (!ok) { await L.sleep(400); throw NAO; }

    const k = data.keys[rec.h];
    if (!k) throw NAO;
    if (k.revogada) throw new L.Falha(403, "Esta compra foi cancelada ou estornada.", "revogada");

    // Se o pedido nao tinha CPF e o comprador informou, grava o hash
    if (cpf && !rec.cpf) {
      await L.mutar((d) => {
        if (d.pedidos[pid] && !d.pedidos[pid].cpf) {
          d.pedidos[pid].cpf = L.hashCpf(cpf);
          if (nome) d.pedidos[pid].nome = nome.slice(0, 80);
          return { salvar: true, resultado: true };
        }
        return { salvar: false, resultado: false };
      }, "sentinela: vincula CPF ao pedido");
    }

    return res.status(200).json({
      ok: true,
      chave: L.chaveDoPedido(pid, rec.jogo),
      jogo: rec.jogo,
    });
  } catch (e) { return L.responder(res, e); }
};
