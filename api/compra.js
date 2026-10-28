// Webhook de compra: o Game Market (ou qualquer loja) avisa aqui quando uma compra e paga/estornada.
// Autenticacao: segredo WEBHOOK_SECRET no cabecalho "x-webhook-secret", "Authorization: Bearer ..." ou na URL (?segredo=...).
const L = require("./_cofre");

const NOMES = {
  pedido: ["order_id", "orderid", "order_number", "ordernumber", "pedido", "pedido_id", "id_pedido", "numero_pedido",
    "transaction_id", "transacao", "sale_id", "venda", "purchase_id", "compra"],
  email: ["email", "buyer_email", "customer_email", "comprador_email", "e-mail"],
  status: ["status", "payment_status", "situacao", "state"],
  evento: ["event", "evento", "type", "tipo", "topic"],
  produto: ["product_id", "produto_id", "sku", "product_name", "produto", "product", "item", "title", "titulo", "name"],
};
const ESTORNO = /(refund|cancel|chargeback|estorn|reembols|disput|revers|expir|fail|refus|recus|negad)/i;
const PAGO = /^(paid|approved|complete|completed|confirmed|success|succeeded|pago|aprovad[oa]|conclu[ií]d[oa]|finalizad[oa]|captured|settled)$/i;
const EVENTO_PAGO = /(sale\.processing|paid|approv|complet|confirm|success|pago|aprov|conclu|finaliz|captur)/i;

const simples = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "";

function porCaminho(obj, caminho) {
  let x = obj;
  for (const p of String(caminho).split(".")) { if (x == null || typeof x !== "object") return undefined; x = x[p]; }
  return x;
}
// Procura um campo pelo nome em qualquer nivel (ate 4), do mais raso para o mais fundo.
function achar(obj, nome) {
  let fila = [obj];
  for (let nivel = 0; nivel < 5 && fila.length; nivel++) {
    const prox = [];
    for (const o of fila) {
      if (!o || typeof o !== "object") continue;
      for (const [k, v] of Object.entries(o)) {
        if (k.toLowerCase() === nome && simples(v)) return String(v).trim();
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
  for (const n of NOMES[tipo]) { const v = achar(b, n); if (v !== undefined) return v; }
  if (tipo === "pedido") {
    const donos = ["order", "pedido", "sale", "venda", "purchase", "compra"];
    let fila = [b];
    for (let nivel = 0; nivel < 4 && fila.length; nivel++) {
      const prox = [];
      for (const o of fila) {
        if (!o || typeof o !== "object") continue;
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") {
            if (donos.includes(k.toLowerCase()) && simples(v.id)) return String(v.id);
            prox.push(v);
          }
        }
      }
      fila = prox;
    }
    if (b && simples(b.id)) return String(b.id);
    if (b && b.data && simples(b.data.id)) return String(b.data.id);
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");
    const real = process.env.WEBHOOK_SECRET;
    if (!real) throw new L.Falha(500, "Servidor ainda sem WEBHOOK_SECRET configurado.", "config");
    if (!L.seguro(segredoRecebido(req), real)) { await L.sleep(500); throw new L.Falha(401, "Nao autorizado.", "segredo"); }

    const b = L.corpo(req);
    const pedido = campo(b, "pedido"), email = campo(b, "email");
    const status = campo(b, "status") || "", evento = campo(b, "evento") || "";
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
      if (acao === "ignorar") { return { salvar: false, resultado: { ignorado: true } }; }
      if (!pedido) { reg(false, "Nao achei o numero do pedido no aviso. Veja os campos e configure WEBHOOK_CAMPO_PEDIDO."); return { salvar: true, resultado: { erro: "sem_pedido" } }; }
      if (acao === "ignorar") { reg(true, "Aviso ignorado (pagamento ainda nao confirmado)."); return { salvar: true, resultado: { ignorado: true } }; }
      if (acao === "revogar") {
        const rec = data.pedidos[L.idPedido(pedido)];
        if (rec && data.keys[rec.h]) { data.keys[rec.h].revogada = true; reg(true, "Chave revogada (estorno/cancelamento)."); return { salvar: true, resultado: { revogada: true } }; }
        reg(true, "Estorno de pedido desconhecido (nada a revogar)."); return { salvar: true, resultado: { revogada: false } };
      }
      const x = L.registrarPedido(data, { pedido, email, jogo, origem: "webhook" });
      reg(true, x.novo ? "Chave criada." : "Pedido ja conhecido (mesma chave).");
      return { salvar: true, resultado: { chave: x.chave, jogo, novo: x.novo } };
    }, "sentinela: aviso de compra");

    if (r.erro) return res.status(422).json({ ok: false, erro: "Nao achei o numero do pedido no aviso.", codigo: "sem_pedido" });
    return res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) { return L.responder(res, e); }
};
