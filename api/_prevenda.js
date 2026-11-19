// Pre-venda: o jogo pode ser comprado e baixado, mas so abre com um codigo de liberacao (ou depois da data de lancamento).
// O codigo e derivado com KEY_SECRET (HMAC) e no cofre fica so o hash + a "rodada" (para o admin rever ou trocar o codigo).
const crypto = require("crypto");
const L = require("./_cofre");

const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
const JOGO_OK = /^[a-z0-9_-]{1,40}$/;

// "2026-11-30T00:00" (horario de Brasilia, UTC-3) -> "2026-11-30T03:00:00.000Z". Lixo vira "".
function lancamentoISO(s) {
  const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return "";
  const a = +m[1], mes = +m[2], d = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0), se = +(m[6] || 0);
  if (mes < 1 || mes > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return "";
  const dias = new Date(Date.UTC(a, mes, 0)).getUTCDate(); // dias do mes
  if (d > dias) return "";
  return new Date(Date.UTC(a, mes - 1, d, h + 3, mi, se)).toISOString();
}

function codigoPrevenda(jogo, rodada) {
  const seg = process.env.KEY_SECRET;
  if (!seg) throw new L.Falha(500, "Servidor ainda sem KEY_SECRET configurada.", "config");
  const dg = crypto.createHmac("sha256", seg).update(`prevenda:${jogo}:${Number(rodada) || 1}`).digest();
  let k = ""; for (let i = 0; i < 12; i++) k += ALFA[dg[i] % 32];
  return k.match(/.{4}/g).join("-");
}
const hashCodigo = (c) => L.sha(L.norm(c));

// Estado da pre-venda de um jogo do catalogo, pela hora do SERVIDOR (o relogio do PC do jogador nao vale).
function estado(g, agoraMs) {
  const lanc = lancamentoISO(g && g.lancamento);
  const porData = !!lanc && agoraMs >= Date.parse(lanc);
  const marcado = !!(g && g.prevenda === true);
  return { prevenda: marcado && !porData, lancamento: lanc, liberado_por_data: marcado && porData };
}

module.exports = { lancamentoISO, codigoPrevenda, hashCodigo, estado, JOGO_OK };
