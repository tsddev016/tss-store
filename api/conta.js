// Conta do comprador: dados pessoais (cifrados), compras, aceite dos termos, reembolso, exportar e excluir (LGPD).
const L = require("./_cofre");
const A = require("./_auth");
const R = require("./_release");

const mascararCpf = (c) => (c && c.length === 11 ? c.slice(0, 3) + ".***.***-" + c.slice(9) : "");
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;

async function nomesDeJogos() {
  try { const cat = await R.lerCatalogo(); const m = {}; ((cat && cat.games) || []).forEach((g) => { m[g.id] = g.name; }); return m; } catch (e) { return {}; }
}

function compras(data, uid, nomes) {
  return Object.entries(data.pedidos).filter(([, r]) => r.conta === uid).map(([p, r]) => {
    const k = data.keys[r.h];
    const rb = data.reembolsos[p];
    const status = rb && rb.estado === "reembolsado" ? "reembolsada" : (k && k.revogada ? "revogada" : (rb ? "reembolso_pedido" : "ativa"));
    return { pedido: p, jogo: r.jogo, nome_jogo: nomes[r.jogo] || r.jogo, criado: r.criado, origem: r.origem, preco: r.preco || null,
      status, chave: status === "ativa" || status === "reembolso_pedido" ? L.chaveDoPedido(p, r.jogo) : null };
  }).sort((a, b) => String(b.criado).localeCompare(String(a.criado)));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const s = A.exigirSessao(req);

    if (req.method === "GET") {
      const { data } = await L.lerChaves();
      const c = data.contas[s.uid];
      if (!c) throw new L.Falha(401, "Conta nao encontrada. Entre de novo.", "login");
      const ult = (c.aceites || []).slice(-1)[0];
      return res.status(200).json({
        ok: true,
        conta: { nome: s.nome || "", email_login: "", avatar: s.avatar || "", provedor: c.provedor, criada: c.criada },
        perfil: { nome_completo: "", email: "", cpf_mascarado: "" },
        aceite: { versao_atual: L.TERMOS_VERSAO, versao_aceita: ult ? ult.versao : "", em: ult ? ult.em : "" },
        compras: compras(data, s.uid, await nomesDeJogos()),
      });
    }

    if (req.method !== "POST") throw new L.Falha(405, "Metodo nao permitido.", "metodo");
    const b = L.corpo(req);
    const acao = String(b.acao || "");

    if (acao === "perfil") {
      throw new L.Falha(410, "A TSS nao guarda mais nome, CPF ou e-mail na conta. Voce informa esses dados so na hora da compra.", "sem_perfil");
    }

    if (acao === "aceitar") {
      if (String(b.versao) !== L.TERMOS_VERSAO) throw new L.Falha(400, "Versao dos termos desatualizada. Recarregue a pagina.", "aceite");
      await L.mutar((data) => {
        const c = data.contas[s.uid]; if (!c) throw new L.Falha(401, "Conta nao encontrada.", "login");
        c.aceites = c.aceites || [];
        if (c.aceites.some((a) => a.versao === L.TERMOS_VERSAO)) return { salvar: false, resultado: true };
        c.aceites.push({ versao: L.TERMOS_VERSAO, em: L.agora() });
        return { salvar: true, resultado: true };
      }, "conta: aceite dos termos");
      return res.status(200).json({ ok: true });
    }

    if (acao === "reembolso") {
      const pid = L.idPedido(b.pedido);
      const motivo = String(b.motivo || "").trim().slice(0, 300);
      const r = await L.mutar((data) => {
        const rec = data.pedidos[pid];
        if (!rec || rec.conta !== s.uid) throw new L.Falha(404, "Compra nao encontrada na sua conta.", "nao_achei");
        const atual = data.reembolsos[pid];
        if (atual) return { salvar: false, resultado: { ja: true, estado: atual.estado } };
        const dias = (Date.now() - new Date(rec.criado).getTime()) / 86400000;
        data.reembolsos[pid] = { pedido: pid, conta: s.uid, motivo, em: L.agora(), estado: "pedido", dentro_7_dias: dias <= 7 };
        data.log.push({ t: L.agora(), ok: true, msg: "Pedido de reembolso", pedido: pid, evento: "reembolso.pedido", campos: [] });
        data.log = data.log.slice(-20);
        return { salvar: true, resultado: { ja: false, dentro_7_dias: dias <= 7 } };
      }, "conta: pedido de reembolso");
      return res.status(200).json({ ok: true, ...r });
    }

    if (acao === "exportar") {
      const { data } = await L.lerChaves();
      const c = data.contas[s.uid]; if (!c) throw new L.Falha(401, "Conta nao encontrada.", "login");
      const aceites = (c.aceites || []).map((a) => ({ versao: a.versao, em: a.em }));
      return res.status(200).json({ ok: true, exportado_em: L.agora(),
        conta: { provedor: c.provedor, criada: c.criada, ultimo_login: c.ultimo_login },
        dados_pessoais: {}, aceites, compras: compras(data, s.uid, await nomesDeJogos()),
        reembolsos: Object.values(data.reembolsos).filter((x) => x.conta === s.uid) });
    }

    if (acao === "excluir") {
      if (String(b.confirmar) !== "EXCLUIR") throw new L.Falha(400, "Digite EXCLUIR para confirmar.", "dados");
      await L.mutar((data) => {
        delete data.contas[s.uid];
        // Compras ficam so como registro tecnico (hash de CPF/e-mail), pelo prazo legal de defesa. Sem nome e sem vinculo com a conta.
        for (const r of Object.values(data.pedidos)) if (r.conta === s.uid) { delete r.conta; delete r.nome; }
        for (const x of Object.values(data.reembolsos)) if (x.conta === s.uid) { delete x.conta; }
        return { salvar: true, resultado: true };
      }, "conta: exclusao a pedido do titular");
      A.limparCookie(res, A.SESSAO);
      return res.status(200).json({ ok: true });
    }

    throw new L.Falha(400, "Acao desconhecida.", "pedido");
  } catch (e) { return L.responder(res, e); }
};
