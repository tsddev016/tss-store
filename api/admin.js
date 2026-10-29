// Painel do administrador (API). Toda acao exige ADMIN_PASSWORD.
const L = require("./_cofre");

const JOGO_OK = /^[a-z0-9_-]{1,40}$/;

// Chave de recuperacao do pedido (derivada com KEY_SECRET, igual a que o comprador viu).
// So devolve se bater com o hash guardado: assim nunca mostra uma chave que nao funciona.
function recDe(pid, r) {
  try {
    if (!r || !r.rec_h) return "";
    const c = L.codigoRecuperacao(pid);
    return L.seguro(r.rec_h, L.hashRecuperacao(c)) ? c : "";
  } catch (e) { return ""; }
}

function achar(data, id) {
  id = String(id || "").toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(id)) throw new L.Falha(400, "Identificador invalido.", "pedido");
  const hs = Object.keys(data.keys).filter((h) => h.startsWith(id));
  if (hs.length !== 1) throw new L.Falha(404, "Chave nao encontrada.", "sem_chave");
  return hs[0];
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");
    const b = L.corpo(req);
    await L.exigirAdmin(b.senha);
    const acao = String(b.acao || "");

    if (acao === "entrar") return res.status(200).json({ ok: true });

    if (acao === "listar") {
      const { data } = await L.lerChaves();
      const chaves = Object.entries(data.keys).map(([h, k]) => ({
        id: h.slice(0, 12), jogo: k.jogo || "", max: k.max || L.MAX_PADRAO,
        usos: Array.isArray(k.maquinas) ? k.maquinas.length : 0,
        criada: k.criada || "", ativada: k.ativada || "", revogada: !!k.revogada,
        pedido: k.pedido || "", origem: k.origem || "", nota: k.nota || "",
      })).sort((a, c) => String(c.criada).localeCompare(String(a.criada)));
      const pedidos = Object.entries(data.pedidos).map(([p, r]) => ({
        pedido: p, jogo: r.jogo, criado: r.criado, origem: r.origem, chave_id: String(r.h || "").slice(0, 12),
        revogada: !!(data.keys[r.h] && data.keys[r.h].revogada), tem_email: !!r.email,
        reembolso: (data.reembolsos[p] || {}).estado || "", motivo: (data.reembolsos[p] || {}).motivo || "", conta: !!r.conta, mp: !!r.mp_payment, preco: Number(r.preco) || 0, rec: recDe(p, r),
      })).sort((a, c) => String(c.criado).localeCompare(String(a.criado)));
      return res.status(200).json({ ok: true, chaves, pedidos, log: data.log.slice().reverse() });
    }

    if (acao === "gerar") {
      const jogo = String(b.jogo || "").toLowerCase();
      const qtd = Math.floor(Number(b.qtd));
      const max = Math.floor(Number(b.max)) || L.MAX_PADRAO;
      if (!JOGO_OK.test(jogo)) throw new L.Falha(400, "Jogo invalido.", "pedido");
      if (!(qtd >= 1 && qtd <= 200)) throw new L.Falha(400, "Quantidade deve ser de 1 a 200.", "pedido");
      if (!(max >= 1 && max <= 10)) throw new L.Falha(400, "Limite de computadores deve ser de 1 a 10.", "pedido");
      const nota = String(b.nota || "").slice(0, 80);
      const novas = await L.mutar((data) => {
        const out = [];
        for (let i = 0; i < qtd; i++) {
          const c = L.chaveAleatoria();
          data.keys[L.sha(L.norm(c))] = { jogo, max, maquinas: [], criada: L.agora(), origem: "admin", nota };
          out.push(c);
        }
        return { salvar: true, resultado: out };
      }, `sentinela: ${qtd} chave(s) geradas (${jogo})`);
      return res.status(200).json({ ok: true, chaves: novas });
    }

    if (["revogar", "reativar", "liberar"].includes(acao)) {
      const r = await L.mutar((data) => {
        const h = achar(data, b.id);
        const k = data.keys[h];
        if (acao === "revogar") k.revogada = true;
        if (acao === "reativar") delete k.revogada;
        if (acao === "liberar") k.maquinas = [];
        return { salvar: true, resultado: true };
      }, `sentinela: ${acao}`);
      return res.status(200).json({ ok: r });
    }

    if (acao === "reembolsar") {
      const pid = L.idPedido(b.pedido);
      const { data } = await L.lerChaves();
      const rec = data.pedidos[pid];
      if (!rec) throw new L.Falha(404, "Pedido nao encontrado.", "sem_pedido");
      let aviso = "Chave revogada. Este pedido nao veio do Pix do site: devolva o dinheiro manualmente.";
      if (rec.mp_payment) {
        const tk = process.env.MP_ACCESS_TOKEN;
        if (!tk) throw new L.Falha(500, "Mercado Pago nao configurado.", "config");
        const r = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(rec.mp_payment) + "/refunds", {
          method: "POST",
          headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json", "X-Idempotency-Key": "refund-" + pid },
          body: "{}",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok && !(j && /already/i.test(JSON.stringify(j)))) {
          throw new L.Falha(502, "Mercado Pago recusou o reembolso: " + String((j && (j.message || j.error)) || r.status), "mp");
        }
        aviso = "Pix devolvido pelo Mercado Pago e chave revogada.";
      }
      await L.mutar((d) => {
        const k = d.keys[rec.h]; if (k) k.revogada = true;
        d.reembolsos[pid] = Object.assign({ pedido: pid, em: L.agora() }, d.reembolsos[pid] || {}, { estado: "reembolsado", feito_em: L.agora() });
        return { salvar: true, resultado: true };
      }, "sentinela: reembolso");
      return res.status(200).json({ ok: true, aviso });
    }

    if (acao === "pedido_manual") {
      const jogo = String(b.jogo || "").toLowerCase();
      if (!JOGO_OK.test(jogo)) throw new L.Falha(400, "Jogo invalido.", "pedido");
      const email = String(b.email || "").trim();
      const r = await L.mutar((data) => {
        const x = L.registrarPedido(data, { pedido: b.pedido, email, jogo, origem: "manual" });
        return { salvar: true, resultado: x };
      }, "sentinela: pedido manual");
      return res.status(200).json({ ok: true, chave: r.chave, novo: r.novo });
    }

    throw new L.Falha(400, "Acao desconhecida.", "pedido");
  } catch (e) { return L.responder(res, e); }
};
