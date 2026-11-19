// Dono/admin recebe automaticamente TODOS os jogos do catalogo, como se tivesse a licenca de cada um.
// Nao e rota (comeca com _); e chamado por _hub.js (login e atualizacao da biblioteca do Hub).
// Funciona assim: para cada jogo publicado no catalogo, cria (uma vez so) um pedido "admin" + chave na conta do admin.
// Jogo novo publicado = aparece sozinho na proxima vez que o Hub entrar ou atualizar a biblioteca.
const L = require("./_cofre");
const R = require("./_release");

// IDs do Discord que SEMPRE ganham todos os jogos (alem dos admins da Vercel e da aba Admins do painel).
const DONOS_FIXOS = ["1428464116774735956"];
const MAX_PCS_ADMIN = 99; // admin pode usar a chave em quantos PCs quiser
const JOGO_OK = /^[a-z0-9_-]{1,40}$/;

function idsAdmins(data) {
  const env = String(process.env.ADMIN_DISCORD_IDS || "").split(/[\s,;]+/);
  const painel = (data.admins || []).map((a) => String((a && a.id) || ""));
  return [...new Set([...DONOS_FIXOS, ...env, ...painel])].filter((x) => /^\d{15,25}$/.test(x));
}

function ehAdmin(data, uid) {
  return idsAdmins(data).some((id) => L.idConta("discord", id) === uid);
}

function pedidoAtivo(d, pid, r) {
  const k = d.keys[r.h];
  const rb = d.reembolsos[pid];
  return !(rb && rb.estado === "reembolsado") && !(k && k.revogada);
}

// Nunca derruba o login do Hub: se der qualquer erro aqui, so segue sem liberar.
async function garantir(uid) {
  try {
    const { data } = await L.lerChaves();
    if (!ehAdmin(data, uid)) return;
    const cat = await R.lerCatalogo();
    const jogos = ((cat && cat.games) || []).map((g) => String((g && g.id) || "")).filter((id) => JOGO_OK.test(id));
    if (!jogos.length) return;
    await L.mutar((d) => {
      let mudou = false;
      for (const jogo of jogos) {
        // ja tem esse jogo ativo (comprado ou liberado antes)? entao nao precisa de outro
        const jaTem = Object.entries(d.pedidos).some(([pid, r]) => r.conta === uid && r.jogo === jogo && pedidoAtivo(d, pid, r));
        if (jaTem) continue;
        const pid = L.idPedido("adm-" + jogo + "-" + String(uid).slice(-10));
        const reg = L.registrarPedido(d, { pedido: pid, jogo, origem: "admin", conta: uid });
        const k = d.keys[reg.h];
        if (k) { delete k.revogada; k.max = MAX_PCS_ADMIN; }
        if (d.reembolsos[pid]) delete d.reembolsos[pid];
        mudou = true;
      }
      return { salvar: mudou, resultado: mudou };
    }, "admin: jogos liberados na conta do dono");
  } catch (e) {
    console.error("adminjogos.garantir:", e && (e.erro || e.message));
  }
}

module.exports = { garantir, ehAdmin, DONOS_FIXOS };
