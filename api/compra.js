// Webhook de compra: Game Market (Standard Webhooks) ou Mercado Pago (IPN).
const L = require("./_cofre");
const crypto = require("crypto");

const NOMES = {
  pedido: ["orderCode", "order_code", "order_id", "orderid", "order_number", "ordernumber", "pedido", "pedido_id", "id_pedido", "numero_pedido",
    "transaction_id", "transacao", "sale_id", "venda", "purchase_id", "compra", "external_reference"],
  email: ["email", "buyer_email", "customer_email", "comprador_email", "e-mail", "buyerEmail"],
  cpf: ["cpf", "document", "documento", "buyer_cpf", "buyerCpf", "tax_id", "taxId", "doc"],
  nome: ["full_name", "fullName", "buyer_name", "buyerName", "customer_name", "nome", "name", "payer_name"],
  status: ["status", "payment_status", "situacao", "state"],
  evento: ["event", "evento", "type", "tipo", "topic", "action"],
  produto: ["productTitle", "product_title", "product_id", "produto_id", "sku", "product_name", "produto", "product", "item", "title", "titulo"],
};
const ESTORNO = /(refund|cancel|chargeback|estorn|reembols|disput|revers|expir|fail|refus|recus|negad)/i;
const PAGO = /^(paid|approved|complete|completed|confirmed|success|succeeded|pago|aprovad[oa]|conclu[ií]d[oa]|finalizad[oa]|captured|settled)$/i;
const EVENTO_PAGO = /(sale\.processing|sale\.completed|order\.paid|paid|approv|complet|confirm|success|pago|aprov|conclu|finaliz|captur)/i;

const simples = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "";

function porCaminho(obj, caminho) {
  let x = obj;
  for (const p of String(caminho).split(".")) { if (x == null || typeof x !== "object") return undefined; x = x[p]; }
  return x;
}
function achar(obj, nome) {
  let fila = [obj];
  for (let nivel = 0; nivel < 5 && fila.length; nivel++) {
    const prox = [];
    for (const o of fila) {
      if (!o || typeof o !== "object") continue;
      for (const [k, v] of Object.entries(o)) {
        if (k.toLowerCase() === nome.toLowerCase() && simples(v)) return String(v).trim();
        if (v && typeof v === "object") prox.push(v);
      }
    }
    fila = prox;
  }
  return undefined;
}
function campo(b, tipo) {
  const env = process.env["WEBHOOK_CAMPO_" + tipo.toUpperCase()];
  if (env) { const v = porCaminho(b, env); if (simples(v)) return String(v).trim(); }
  for (const n of NOMES[tipo] || []) { const v = achar(b, n); if (v !== undefined) return v; }
  if (tipo === "pedido") {
    const data = b && b.data;
    if (data && simples(data.orderCode)) return String(data.orderCode);
    if (data && simples(data.id)) return String(data.id);
    if (b && simples(b.id)) return String(b.id);
  }
  return undefined;
}
function nomesDosCampos(b) {
  const out = [];
  for (const [k, v] of Object.entries(b || {})) {
    out.push(k);
    if (v && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v)) out.push(k + "." + k2);
  }
  return out.slice(0, 60);
}
function jogoDoProduto(produto) {
  let mapa = {};
  try { mapa = JSON.parse(process.env.PRODUTOS || "{}"); } catch (e) {}
  const p = String(produto || "").toLowerCase();
  for (const [trecho, jogo] of Object.entries(mapa)) if (p && p.includes(String(trecho).toLowerCase())) return jogo;
  return (process.env.JOGO_PADRAO || "backrooms").toLowerCase();
}
function segredoRecebido(req) {
  const h = req.headers || {};
  const a = String(h.authorization || "").replace(/^Bearer\s+/i, "");
  const q = (req.query && (req.query.segredo || req.query.secret || req.query.token)) || "";
  return String(h["x-webhook-secret"] || h["x-tss-secret"] || a || q || "");
}

function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  try { return JSON.stringify(req.body || {}); } catch (e) { return ""; }
}

function verificarAssinaturaGM(req) {
  const secretEnv = process.env.GM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || "";
  if (!secretEnv) return { ok: false, motivo: "sem_segredo" };

  const h = req.headers || {};
  const id = h["webhook-id"] || h["Webhook-Id"] || "";
  const timestamp = String(h["webhook-timestamp"] || h["Webhook-Timestamp"] || h["x-gamemarket-timestamp"] || "");
  const signatures = String(h["webhook-signature"] || h["Webhook-Signature"] || h["x-gamemarket-signature"] || "");

  if (!id && !signatures) {
    if (L.seguro(segredoRecebido(req), secretEnv)) return { ok: true, legado: true };
    return { ok: false, motivo: "segredo_invalido" };
  }

  if (!id || !/^[0-9]+$/.test(timestamp)) return { ok: false, motivo: "headers_invalidos" };
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return { ok: false, motivo: "timestamp_expirado" };

  let key;
  try {
    const cleaned = secretEnv.replace(/^whsec_/, "");
    key = Buffer.from(cleaned, "base64");
    if (!key.length) key = Buffer.from(secretEnv, "utf8");
  } catch (e) {
    key = Buffer.from(secretEnv, "utf8");
  }

  const body = rawBody(req);
  const expected = crypto
    .createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(String(id) + "." + timestamp + ".", "utf8"), Buffer.from(body, "utf8")]))
    .digest();

  const ok = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    try {
      const received = Buffer.from(value, "base64");
      return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    } catch (e) { return false; }
  });

  return ok ? { ok: true } : { ok: false, motivo: "assinatura_invalida" };
}

function isGameMarket(req) {
  const h = req.headers || {};
  return !!(h["webhook-id"] || h["x-gamemarket-event"] || h["X-GameMarket-Event"] ||
    (L.corpo(req).event && String(L.corpo(req).event).startsWith("sale.")));
}

async function processarMercadoPago(req) {
  const q = req.query || {};
  const b = L.corpo(req);
  const topic = String(q.topic || q.type || b.type || b.topic || "").toLowerCase();
  const id = String(q.id || q["data.id"] || (b.data && b.data.id) || b.id || "").trim();

  if (!id) return { ok: true, ignorado: true, motivo: "sem_id" };
  if (topic && topic !== "payment" && !topic.includes("payment")) {
    return { ok: true, ignorado: true, motivo: "topic_" + topic };
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new L.Falha(500, "MP_ACCESS_TOKEN nao configurado.", "config");

  const r = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(id), {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) {
    if (r.status === 404) return { ok: true, ignorado: true, motivo: "pagamento_nao_encontrado" };
    throw new L.Falha(502, "Nao consegui consultar o pagamento no Mercado Pago.", "mp");
  }
  const pay = await r.json();
  const status = String(pay.status || "").toLowerCase();
  const pedido = String(pay.external_reference || pay.id || id);
  const email = (pay.payer && pay.payer.email) || "";
  const meta = pay.metadata || {};
  const jogo = String(meta.jogo || process.env.JOGO_PADRAO || "backrooms").toLowerCase();

  let acao = "ignorar";
  if (status === "approved") acao = "ativar";
  else if (["refunded", "charged_back", "cancelled"].includes(status)) acao = "revogar";

  const out = await L.mutar((data) => {
    const reg = (ok, msg) => {
      data.log.push({ t: L.agora(), ok, msg, pedido: L.idPedido(pedido), status, evento: "mp.payment", campos: ["mp", status] });
      data.log = data.log.slice(-20);
    };
    if (acao === "ignorar") {
      reg(true, "MP: status " + status + " (aguardando).");
      return { salvar: true, resultado: { ignorado: true, status } };
    }
    if (acao === "revogar") {
      const rec = data.pedidos[L.idPedido(pedido)];
      if (rec && data.keys[rec.h]) {
        data.keys[rec.h].revogada = true;
        reg(true, "MP: chave revogada (" + status + ").");
        return { salvar: true, resultado: { revogada: true } };
      }
      reg(true, "MP: estorno sem pedido local.");
      return { salvar: true, resultado: { revogada: false } };
    }
    const x = L.registrarPedido(data, { pedido, email, jogo, origem: "mercadopago" });
    reg(true, x.novo ? "MP: chave criada." : "MP: pedido ja conhecido.");
    return { salvar: true, resultado: { chave: x.chave, jogo, novo: x.novo, pedido } };
  }, "sentinela: pagamento Mercado Pago");

  return Object.assign({ ok: true }, out);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const q = req.query || {};
    const temMp = q.topic || q.type || (req.method === "GET" && q.id) ||
      (L.corpo(req).action && String(L.corpo(req).action).includes("payment"));
    if ((temMp || (req.method === "GET" && (q.id || q.topic))) && !isGameMarket(req)) {
      const r = await processarMercadoPago(req);
      return res.status(200).json(r);
    }

    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");

    const ver = verificarAssinaturaGM(req);
    if (!ver.ok) {
      await L.sleep(400);
      throw new L.Falha(401, "Nao autorizado (" + (ver.motivo || "assinatura") + ").", "segredo");
    }

    const b = L.corpo(req);
    const pedido = campo(b, "pedido");
    const email = campo(b, "email");
    const cpf = campo(b, "cpf");
    const nome = campo(b, "nome");
    const status = campo(b, "status") || "";
    const evento = campo(b, "evento") || String((req.headers && (req.headers["x-gamemarket-event"] || req.headers["X-GameMarket-Event"])) || "");
    const jogo = jogoDoProduto(campo(b, "produto"));
    const campos = nomesDosCampos(b);

    let acao = "ativar";
    if (/^(product|balance|funds|withdrawal|mediation|review)\./i.test(evento)) acao = "ignorar";
    else if (ESTORNO.test(status + " " + evento)) acao = "revogar";
    else if (process.env.WEBHOOK_ACEITAR_TUDO === "1") acao = "ativar";
    else if (status) acao = PAGO.test(status) ? "ativar" : "ignorar";
    else if (evento) acao = EVENTO_PAGO.test(evento) ? "ativar" : "ignorar";

    const r = await L.mutar((data) => {
      const reg = (ok, msg) => {
        data.log.push({ t: L.agora(), ok, msg, pedido: L.idPedido(pedido), status, evento, campos });
        data.log = data.log.slice(-20);
      };
      if (acao === "ignorar") { return { salvar: false, resultado: { ignorado: true, evento } }; }
      if (!pedido) { reg(false, "Nao achei o numero do pedido no aviso."); return { salvar: true, resultado: { erro: "sem_pedido" } }; }
      if (acao === "revogar") {
        const rec = data.pedidos[L.idPedido(pedido)];
        if (rec && data.keys[rec.h]) { data.keys[rec.h].revogada = true; reg(true, "Chave revogada (estorno/cancelamento)."); return { salvar: true, resultado: { revogada: true } }; }
        reg(true, "Estorno de pedido desconhecido (nada a revogar)."); return { salvar: true, resultado: { revogada: false } };
      }
      const x = L.registrarPedido(data, { pedido, email, cpf, nome, jogo, origem: "gamemarket" });
      reg(true, x.novo ? "Chave criada (GameMarket)." : "Pedido ja conhecido (mesma chave).");
      return { salvar: true, resultado: { chave: x.chave, jogo, novo: x.novo, pedido } };
    }, "sentinela: aviso GameMarket");

    if (r.erro) return res.status(422).json({ ok: false, erro: "Nao achei o numero do pedido no aviso.", codigo: "sem_pedido" });
    return res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) { return L.responder(res, e); }
};
