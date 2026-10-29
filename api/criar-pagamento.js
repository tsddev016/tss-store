// Cria pagamento Pix no Mercado Pago e devolve QR code + codigo copia-e-cola.
// Valido por 30 minutos.
const L = require("./_cofre");
const crypto = require("crypto");

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

    let email = String(b.email || "").trim();
    if (!email.includes("@")) email = "comprador+" + Date.now() + "@tss.store";

    let preco = Number(b.preco);
    if (!Number.isFinite(preco) || preco < 0) preco = 0.01;
    if (preco === 0) preco = 0.01;

    const base = process.env.SITE_URL || "https://tss-store.vercel.app";
    const pedidoId = "pix-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

    const minutos = 30;
    const expira = new Date(Date.now() + minutos * 60 * 1000).toISOString();

    const body = {
      transaction_amount: Number(preco.toFixed(2)),
      description: "TSS - chave de ativacao (" + jogo + ")",
      payment_method_id: "pix",
      external_reference: pedidoId,
      date_of_expiration: expira,
      notification_url: base + "/api/compra",
      // Qualidade da integracao MP
      statement_descriptor: "TSS STORE",
      binary_mode: true,
      metadata: { jogo, email, origem: "tss-store-pix", site: base },
      additional_info: {
        items: [{
          id: jogo,
          title: "Backrooms: Cade a Porta? (TSS)",
          description: "Chave de ativacao digital",
          category_id: "digital_games",
          quantity: 1,
          unit_price: Number(preco.toFixed(2)),
        }],
      },
      payer: {
        email,
        first_name: String(b.nome || "Comprador").slice(0, 40),
      },
    };

    const idem = crypto.createHash("sha256").update(pedidoId + String(Date.now())).digest("hex").slice(0, 32);

    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idem,
      },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && (data.message || data.error || (data.cause && data.cause[0] && data.cause[0].description))) || "Falha ao criar Pix.";
      throw new L.Falha(502, String(msg), "mp");
    }

    const td = (data.point_of_interaction && data.point_of_interaction.transaction_data) || {};
    const qr = td.qr_code || "";
    const qrB64 = td.qr_code_base64 || "";
    if (!qr && !qrB64) throw new L.Falha(502, "Mercado Pago nao devolveu o QR Code Pix.", "mp");

    return res.status(200).json({
      ok: true,
      pedido: pedidoId,
      payment_id: data.id,
      status: data.status,
      preco,
      expira: data.date_of_expiration || expira,
      minutos,
      qr_code: qr,
      qr_code_base64: qrB64,
      ticket_url: td.ticket_url || "",
    });
  } catch (e) {
    return L.responder(res, e);
  }
};
