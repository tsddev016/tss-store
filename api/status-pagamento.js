// Consulta status de um pagamento Mercado Pago (polling do QR Pix).
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, erro: "Metodo nao permitido." });
    }
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ ok: false, erro: "MP nao configurado." });

    const q = req.query || {};
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    const id = String(q.id || b.id || q.payment_id || b.payment_id || "").trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, erro: "payment_id invalido." });

    const r = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status === 404 ? 404 : 502).json({ ok: false, erro: "Pagamento nao encontrado." });
    }

    return res.status(200).json({
      ok: true,
      payment_id: data.id,
      status: data.status,
      status_detail: data.status_detail,
      pedido: data.external_reference || "",
      expira: data.date_of_expiration || "",
      aprovado: data.status === "approved",
      expirado: data.status === "cancelled" || data.status === "expired",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: "Erro interno." });
  }
};
