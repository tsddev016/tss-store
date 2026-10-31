// Painel do administrador (API). Toda acao exige ADMIN_PASSWORD.
const L = require("./_cofre");
const D = require("./_discord");

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
      await D.avisarAdmin("Reembolso realizado", "Pedido `" + pid + "`");
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

    if (acao === "cupons") {
      const { data } = await L.lerChaves();
      const cupons = Object.entries(data.cupons).map(([c, x]) => ({ codigo: c, tipo: x.tipo, valor: x.valor, jogo: x.jogo || "", ate: x.ate || "", max_usos: x.max_usos || 0, usos: x.usos || 0, ativo: x.ativo !== false, criado: x.criado || "" }))
        .sort((a, c) => String(c.criado).localeCompare(String(a.criado)));
      return res.status(200).json({ ok: true, cupons });
    }

    if (acao === "cupom_salvar") {
      const cod = L.norm(b.codigo);
      if (cod.length < 3 || cod.length > 24) throw new L.Falha(400, "O codigo deve ter de 3 a 24 letras/numeros.", "pedido");
      const tipo = b.tipo === "fixo" ? "fixo" : "percent";
      const valor = Number(b.valor);
      if (tipo === "percent" && !(valor >= 1 && valor <= 90)) throw new L.Falha(400, "Desconto em % deve ser de 1 a 90.", "pedido");
      if (tipo === "fixo" && !(valor > 0 && valor <= 500)) throw new L.Falha(400, "Desconto em R$ deve ser de 0,01 a 500.", "pedido");
      const jogo = String(b.jogo || "").toLowerCase();
      if (jogo && !JOGO_OK.test(jogo)) throw new L.Falha(400, "Jogo invalido.", "pedido");
      const ate = String(b.ate || "");
      if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new L.Falha(400, "Data de validade invalida.", "pedido");
      const max = Math.floor(Number(b.max_usos)) || 0;
      if (max < 0 || max > 100000) throw new L.Falha(400, "Limite de usos invalido.", "pedido");
      await L.mutar((data) => {
        const ant = data.cupons[cod] || {};
        data.cupons[cod] = { tipo, valor: Math.round(valor * 100) / 100, jogo, ate, max_usos: max, usos: Number(ant.usos) || 0, ativo: b.ativo !== false, criado: ant.criado || L.agora() };
        return { salvar: true, resultado: true };
      }, "cupom salvo: " + cod);
      await D.avisarAdmin("Cupom salvo", "Codigo `" + cod + "` (" + (tipo === "fixo" ? "R$ " + valor : valor + "%") + ")");
      return res.status(200).json({ ok: true });
    }

    if (acao === "cupom_apagar") {
      const cod = L.norm(b.codigo);
      await L.mutar((data) => { const ex = !!data.cupons[cod]; delete data.cupons[cod]; return { salvar: ex, resultado: ex }; }, "cupom apagado: " + cod);
      return res.status(200).json({ ok: true });
    }

    if (acao === "discord_registrar") {
      const app = process.env.DISCORD_APP_ID, tk = process.env.DISCORD_BOT_TOKEN, gid = process.env.DISCORD_GUILD_ID;
      if (!app || !tk) throw new L.Falha(400, "Configure DISCORD_APP_ID e DISCORD_BOT_TOKEN na Vercel e publique de novo.", "config");
      const url = "https://discord.com/api/v10/applications/" + encodeURIComponent(app) + (gid ? "/guilds/" + encodeURIComponent(gid) : "") + "/commands";
      const r = await fetch(url, { method: "PUT", headers: { Authorization: "Bot " + tk, "Content-Type": "application/json" }, body: JSON.stringify(D.COMANDOS) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new L.Falha(502, "Discord recusou: " + String((j && j.message) || r.status), "discord");
      return res.status(200).json({ ok: true, aviso: D.COMANDOS.length + " comandos registrados" + (gid ? " no servidor." : " (globais: podem levar ate 1 hora para aparecer).") });
    }

    throw new L.Falha(400, "Acao desconhecida.", "pedido");
  } catch (e) { return L.responder(res, e); }
};
