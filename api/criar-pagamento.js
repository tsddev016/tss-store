// Cria preferência de pagamento no Mercado Pago (Checkout Pro) e devolve o link.
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
    if (!token) throw new L.Falha(500, "Mercado Pago ainda nao configurado no servidor.", "config");

    const b = L.corpo(req);
    const jogo = String(b.jogo || "backrooms").toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(jogo)) throw new L.Falha(400, "Jogo invalido.", "pedido");

    const email = String(b.email || "").trim();
    const nome = String(b.nome || "").trim();

    // Preço em centavos de real. 0 = grátis de teste → usa R$ 0,01 (MP não aceita 0).
    let preco = Number(b.preco);
    if (!Number.isFinite(preco) || preco < 0) preco = 0.01;
    if (preco === 0) preco = 0.01;

    const base = process.env.SITE_URL || "https://tss-store.vercel.app";
    const pedidoId = "mp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

    const body = {
      items: [{
        id: jogo,
        title: "Backrooms: Cade a Porta? (TSS)",
        description: "Chave de ativacao do jogo completo",
        category_id: "digital_games",
        quantity: 1,
        currency_id: "BRL",
        unit_price: preco,
      }],
      external_reference: pedidoId,
      metadata: { jogo, email, origem: "tss-store" },
      notification_url: base + "/api/compra",
      back_urls: {
        success: base + "/resgatar?pago=1&pedido=" + encodeURIComponent(pedidoId),
        pending: base + "/resgatar?pendente=1&pedido=" + encodeURIComponent(pedidoId),
        failure: base + "/?erro=pagamento",
      },
      auto_return: "approved",
      statement_descriptor: "TSS STORE",
    };

    if (email.includes("@")) {
      body.payer = { email };
      if (nome) body.payer.name = nome;
    }

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && (data.message || data.error)) || "Falha ao criar pagamento.";
      throw new L.Falha(502, String(msg), "mp");
    }

    const init = data.init_point || data.sandbox_init_point;
    if (!init) throw new L.Falha(502, "Mercado Pago nao devolveu o link de pagamento.", "mp");

    return res.status(200).json({
      ok: true,
      pedido: pedidoId,
      init_point: init,
      preference_id: data.id,
    });
  } catch (e) {
    return L.responder(res, e);
  }
};
