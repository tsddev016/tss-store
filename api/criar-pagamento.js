// Cria pagamento Pix no Mercado Pago e devolve QR code + codigo copia-e-cola.
// Valido por 30 minutos.
const L = require("./_cofre");
const crypto = require("crypto");
const A = require("./_auth");
const R = require("./_release");

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

    // Com login configurado a compra exige conta; sem login configurado (transicao) segue como visitante.
    const loginAtivo = Object.keys(A.PROVEDORES).some(A.configurado);
    const sess = loginAtivo ? A.exigirSessao(req) : null;
    const b = L.corpo(req);
    const jogo = String(b.jogo || "").toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(jogo)) throw new L.Falha(400, "Jogo invalido.", "pedido");

    // Preco e nome vem do catalogo no servidor (nunca do navegador).
    const cat = await R.lerCatalogo();
    const g = cat && (cat.games || []).find((x) => x.id === jogo);
    if (!g) throw new L.Falha(404, "Jogo nao encontrado.", "sem_jogo");
    if (!g.protegido) throw new L.Falha(400, "Este jogo e gratuito, nao precisa de pagamento.", "gratis");
    const preco = Number(g.preco);
    if (!Number.isFinite(preco) || preco < 1) throw new L.Falha(400, "Este jogo ainda nao tem preco definido. Tente de novo mais tarde.", "sem_preco");

    // Aceite dos termos (prova de consentimento) + maioridade
    if (String(b.aceite_termos) !== L.TERMOS_VERSAO || b.maior_18 !== true) {
      throw new L.Falha(400, "Aceite os Termos de Uso, a Politica de Privacidade e a Politica de Reembolso para continuar.", "aceite");
    }

    // Dados do comprador: usa o que veio no formulario; se vier vazio, usa o que ja esta salvo na conta.
    let conta = null, salvo = {};
    if (sess) {
      const { data: dados } = await L.lerChaves();
      conta = dados.contas[sess.uid];
      if (!conta) throw new L.Falha(401, "Conta nao encontrada. Entre de novo.", "login");
      salvo = conta.pii ? L.decifrar(conta.pii) : {};
    }
    const nome = (String(b.nome || "").trim().replace(/\s+/g, " ") || salvo.nome || "");
    const cpf = L.normalizarCpf(b.cpf) || salvo.cpf || "";
    const email = (String(b.email || "").trim().toLowerCase() || salvo.email || (conta && conta.email_login) || "");
    if (nome.length < 5 || nome.length > 80 || !nome.includes(" ")) throw new L.Falha(400, "Informe seu nome completo.", "dados");
    if (!L.cpfValido(cpf)) throw new L.Falha(400, "CPF invalido.", "dados");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new L.Falha(400, "E-mail invalido.", "dados");

    const ip = L.ipDe(req), ua = String(req.headers["user-agent"] || "").slice(0, 160);
    if (sess) await L.mutar((data) => {
      const c = data.contas[sess.uid]; if (!c) throw new L.Falha(401, "Conta nao encontrada.", "login");
      c.pii = L.cifrar({ nome, cpf, email, atualizado: L.agora() });
      c.aceites = c.aceites || [];
      if (!c.aceites.some((a) => a.versao === L.TERMOS_VERSAO)) c.aceites.push({ versao: L.TERMOS_VERSAO, em: L.agora(), ev: L.cifrar({ ip, ua, onde: "checkout" }) });
      return { salvar: true, resultado: true };
    }, "conta: dados do comprador e aceite");

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
      metadata: { jogo, email, origem: "tss-store-pix", site: base, conta: sess ? sess.uid : "", aceite: L.TERMOS_VERSAO },
      additional_info: {
        items: [{
          id: jogo,
          title: String(g.name || jogo).slice(0, 120),
          description: "Chave de ativacao digital",
          category_id: "digital_games",
          quantity: 1,
          unit_price: Number(preco.toFixed(2)),
        }],
      },
      payer: {
        email,
        first_name: nome.split(" ")[0].slice(0, 40),
        last_name: nome.split(" ").slice(1).join(" ").slice(0, 60),
        identification: { type: "CPF", number: cpf },
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
