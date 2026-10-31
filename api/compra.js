// Webhook do Mercado Pago (Pix).
// 1) confere a assinatura (x-signature) quando MP_WEBHOOK_SECRET esta configurada;
// 2) consulta o pagamento na API do Mercado Pago (fonte da verdade: o corpo do aviso nunca decide nada);
// 3) cria a chave (e o hash da chave de recuperacao) ou revoga em caso de estorno.
const L = require("./_cofre");
const R = require("./_release");
const D = require("./_discord");
const crypto = require("crypto");

const idDaUrl = (q) => String((q && (q["data.id"] || (q.data && q.data.id))) || "");

// Validacao da origem, conforme a documentacao do Mercado Pago:
// manifesto "id:[data.id da URL];request-id:[x-request-id];ts:[ts do x-signature];" -> HMAC SHA256 (hex) com a chave secreta.
function verificarAssinatura(req) {
  const segredo = process.env.MP_WEBHOOK_SECRET || "";
  if (!segredo) return { ok: true, semSegredo: true };
  const h = req.headers || {};
  const requestId = String(h["x-request-id"] || "");
  let ts = "", v1 = "";
  for (const parte of String(h["x-signature"] || "").split(",")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    const k = parte.slice(0, i).trim(), v = parte.slice(i + 1).trim();
    if (k === "ts") ts = v; else if (k === "v1") v1 = v;
  }
  if (!ts || !v1 || !requestId) return { ok: false, motivo: "sem_assinatura" };
  const id = idDaUrl(req.query);
  const manifesto = `id:${/^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id};request-id:${requestId};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", segredo).update(manifesto).digest();
  const recebido = /^[0-9a-f]+$/i.test(v1) ? Buffer.from(v1, "hex") : Buffer.alloc(0);
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return { ok: false, motivo: "assinatura_invalida" };
  return { ok: true };
}

const SUFIXO_SEM_ASSINATURA = " [assinatura nao verificada: configure MP_WEBHOOK_SECRET]";

async function processar(req, semSegredo) {
  const q = req.query || {};
  const b = L.corpo(req);
  const topic = String(q.type || q.topic || b.type || b.topic || "").toLowerCase();
  const id = String(idDaUrl(q) || (b.data && b.data.id) || q.id || b.id || "").trim();

  if (!id) return { ok: true, ignorado: true, motivo: "sem_id" };
  if (topic && !topic.includes("payment")) return { ok: true, ignorado: true, motivo: "topic_" + topic };
  if (!/^\d+$/.test(id)) return { ok: true, ignorado: true, motivo: "id_invalido" };

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
  const jogo = String(meta.jogo || "").toLowerCase();
  const pago = Number(pay.transaction_amount);
  const aviso = semSegredo ? SUFIXO_SEM_ASSINATURA : "";

  let acao = "ignorar";
  let motivoIgn = "";
  let nomeJogo = "";
  if (status === "approved") {
    const cat = await R.lerCatalogo();
    const g = jogo && cat && (cat.games || []).find((x) => x.id === jogo);
    const preco = g ? Number(g.preco) : 0;
    nomeJogo = g ? g.name : "";
    if (!g || !g.protegido) motivoIgn = "jogo desconhecido";
    else if (!(preco > 0) || !(pago + 0.005 >= L.precoEsperado(pay, preco))) motivoIgn = "valor nao confere";
    else acao = "ativar";
  } else if (["refunded", "charged_back", "cancelled"].includes(status)) acao = "revogar";

  const out = await L.mutar((data) => {
    const reg = (ok, msg) => {
      data.log.push({ t: L.agora(), ok, msg: msg + aviso, pedido: L.idPedido(pedido), status, evento: "mp.payment", campos: ["mp", status] });
      data.log = data.log.slice(-20);
    };
    if (acao === "ignorar") {
      reg(true, motivoIgn ? "MP: pagamento aprovado ignorado (" + motivoIgn + ")." : "MP: status " + status + " (aguardando).");
      return { salvar: true, resultado: { ignorado: true, status } };
    }
    if (acao === "revogar") {
      const rec = data.pedidos[L.idPedido(pedido)];
      if (rec && data.keys[rec.h]) {
        const novo = !data.keys[rec.h].revogada;
        data.keys[rec.h].revogada = true;
        reg(true, "MP: chave revogada (" + status + ").");
        return { salvar: true, resultado: { revogada: true, avisar: novo } };
      }
      reg(true, "MP: estorno sem pedido local.");
      return { salvar: true, resultado: { revogada: false } };
    }
    const x = L.registrarPedido(data, {
      pedido, email, jogo, origem: "mercadopago", preco: pago, mp_payment: id,
      conta: meta.conta || "", aceite: meta.aceite || "",
    });
    reg(true, x.novo ? "MP: chave criada." : "MP: pedido ja conhecido.");
    return { salvar: true, resultado: { jogo, novo: x.novo, pedido } };
  }, "sentinela: pagamento Mercado Pago");

  // Aviso no Discord (opcional, sem dado pessoal). So na primeira vez, para nao repetir.
  if (out && out.novo) await D.avisarCompra({ jogo, nomeJogo, pedido: L.idPedido(pedido), preco: pago });
  if (out && out.avisar) await D.avisarEstorno({ pedido: L.idPedido(pedido), status });
  if (out) delete out.avisar;

  return Object.assign({ ok: true }, out);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");
    const ver = verificarAssinatura(req);
    if (!ver.ok) {
      await L.sleep(300);
      throw new L.Falha(401, "Nao autorizado (" + ver.motivo + ").", "assinatura");
    }
    return res.status(200).json(await processar(req, !!ver.semSegredo));
  } catch (e) { return L.responder(res, e); }
};
module.exports.verificarAssinatura = verificarAssinatura;
