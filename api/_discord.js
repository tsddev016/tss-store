// Aviso opcional para um canal do Discord (webhook de canal). Nunca leva dado pessoal:
// so jogo, numero do pedido e valor. Configure DISCORD_WEBHOOK_URL na Vercel.
// Falha aqui NUNCA atrapalha a compra (timeout curto e erro engolido).

function urlOk(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /(^|\.)discord(app)?\.com$/.test(x.hostname) && x.pathname.startsWith("/api/webhooks/");
  } catch (e) { return false; }
}

async function enviar(embed) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || !urlOk(url)) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "TSS Store", allowed_mentions: { parse: [] }, embeds: [embed] }),
      signal: ctl.signal,
    });
    return r.ok;
  } catch (e) { return false; } finally { clearTimeout(t); }
}

const reais = (v) => "R$ " + (Number(v) || 0).toFixed(2).replace(".", ",");
const lim = (s, n) => String(s == null || s === "" ? "?" : s).slice(0, n);

function avisarCompra({ jogo, nomeJogo, pedido, preco }) {
  return enviar({
    title: "Compra aprovada",
    color: 0x3ecf8e,
    fields: [
      { name: "Jogo", value: lim(nomeJogo || jogo, 100), inline: true },
      { name: "Valor", value: reais(preco), inline: true },
      { name: "Pedido", value: "`" + lim(pedido, 64) + "`" },
    ],
    timestamp: new Date().toISOString(),
  });
}

function avisarEstorno({ pedido, status }) {
  return enviar({
    title: "Chave revogada (" + lim(status, 30) + ")",
    color: 0xff5c6c,
    fields: [{ name: "Pedido", value: "`" + lim(pedido, 64) + "`" }],
    timestamp: new Date().toISOString(),
  });
}

module.exports = { avisarCompra, avisarEstorno };
