// Confirma no Mercado Pago se o Pix caiu e emite a chave de ativacao.
// Nao depende so do webhook: o front chama isso apos status=approved.
const L = require("./_cofre");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) throw new L.Falha(500, "Mercado Pago nao configurado.", "config");

    const b = L.corpo(req);
    const id = String(b.payment_id || b.id || "").trim();
    if (!/^\d+$/.test(id)) throw new L.Falha(400, "payment_id invalido.", "pedido");

    const r = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + token },
    });
    const pay = await r.json().catch(() => ({}));
    if (!r.ok) throw new L.Falha(502, "Nao consegui consultar o pagamento no Mercado Pago.", "mp");

    const status = String(pay.status || "").toLowerCase();
    if (status !== "approved") {
      return res.status(200).json({
        ok: true,
        aprovado: false,
        status,
        status_detail: pay.status_detail || "",
        pedido: pay.external_reference || "",
      });
    }

    const pedido = String(pay.external_reference || pay.id || id);
    const email = (pay.payer && pay.payer.email) || b.email || "";
    const meta = pay.metadata || {};
    const jogo = String(meta.jogo || process.env.JOGO_PADRAO || "backrooms").toLowerCase();
    const idp = pay.payer && pay.payer.identification;
    const nomePag = pay.payer ? [pay.payer.first_name, pay.payer.last_name].filter(Boolean).join(" ") : "";

    const out = await L.mutar((data) => {
      const x = L.registrarPedido(data, {
        pedido,
        email,
        cpf: idp && idp.number ? idp.number : "",
        nome: nomePag,
        jogo,
        origem: "mercadopago",
        conta: meta.conta || "",
        mp_payment: id,
        preco: pay.transaction_amount,
        aceite: meta.aceite || "",
      });
      data.log.push({
        t: L.agora(),
        ok: true,
        msg: x.novo ? "Pix confirmado: chave criada." : "Pix confirmado: pedido ja conhecido.",
        pedido: L.idPedido(pedido),
        status: "approved",
        evento: "mp.confirm",
        campos: ["payment_id", id],
      });
      data.log = data.log.slice(-20);
      return { salvar: true, resultado: { chave: x.chave, jogo, novo: x.novo, pedido } };
    }, "sentinela: confirma Pix");

    return res.status(200).json({
      ok: true,
      aprovado: true,
      status: "approved",
      chave: out.chave,
      jogo: out.jogo,
      pedido: out.pedido,
      novo: out.novo,
    });
  } catch (e) {
    return L.responder(res, e);
  }
};
