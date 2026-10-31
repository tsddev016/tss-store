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

function avisarAdmin(titulo, texto) {
  return enviar({ title: lim(titulo, 100), color: 0xe6cf4a, description: lim(texto, 300), timestamp: new Date().toISOString() });
}

// Comandos do bot (registrados pelo painel: Integracao > Registrar comandos).
const LISTA_COMANDOS = [
  { name: "vendas", description: "Resumo de vendas, chaves em uso e reembolsos", type: 1 },
  { name: "chave", description: "Gerar chaves avulsas de um jogo", type: 1, options: [
    { type: 3, name: "jogo", description: "ID do jogo (ex.: backrooms)", required: true },
    { type: 4, name: "qtd", description: "Quantidade (1 a 5)", min_value: 1, max_value: 5 } ] },
  { name: "cupom", description: "Criar ou atualizar um cupom de desconto", type: 1, options: [
    { type: 3, name: "codigo", description: "Codigo (ex.: BACK3)", required: true },
    { type: 3, name: "tipo", description: "Tipo do desconto", required: true, choices: [{ name: "Porcentagem (%)", value: "percent" }, { name: "Valor fixo (R$)", value: "fixo" }] },
    { type: 10, name: "valor", description: "Quanto desconta", required: true },
    { type: 3, name: "jogo", description: "ID do jogo (vazio = todos)" },
    { type: 3, name: "ate", description: "Validade AAAA-MM-DD" },
    { type: 4, name: "max_usos", description: "Limite de usos (0 = sem limite)" } ] },
  { name: "revogar", description: "Revogar uma chave (cancela o acesso)", type: 1, options: [
    { type: 3, name: "chave", description: "Chave completa ou ID curto do painel", required: true } ] },
  { name: "reativar", description: "Reativar uma chave revogada", type: 1, options: [
    { type: 3, name: "chave", description: "Chave completa ou ID curto do painel", required: true } ] },
  { name: "liberar", description: "Liberar os computadores ligados a uma chave", type: 1, options: [
    { type: 3, name: "chave", description: "Chave completa ou ID curto do painel", required: true } ] },
  { name: "pedido", description: "Ver os dados de um pedido", type: 1, options: [
    { type: 3, name: "id", description: "Numero do pedido", required: true } ] },
  { name: "cupons", description: "Listar os cupons de desconto", type: 1 },
  { name: "cupom-apagar", description: "Apagar um cupom de desconto", type: 1, options: [
    { type: 3, name: "codigo", description: "Codigo do cupom", required: true } ] },
  { name: "gerar-ticket", description: "Enviar o painel de tickets de suporte em um canal", type: 1, options: [
    { type: 7, name: "canal", description: "Canal onde a mensagem do painel vai aparecer", required: true, channel_types: [0, 5] },
    { type: 7, name: "categoria", description: "Categoria onde os tickets serao criados", required: true, channel_types: [4] },
    { type: 8, name: "cargo1", description: "Cargo que pode ver os tickets", required: true },
    { type: 8, name: "cargo2", description: "Outro cargo que pode ver os tickets" },
    { type: 8, name: "cargo3", description: "Outro cargo que pode ver os tickets" } ] },
];

// Visiveis so para quem tem a permissao "Moderar membros" (moderadores) e administradores; fora de DMs.
// Quem realmente executa continua limitado a DISCORD_ADMIN_IDS (checado no servidor).
const COMANDOS = LISTA_COMANDOS.map((c) => ({ ...c, default_member_permissions: "1099511627776", dm_permission: false }));

module.exports = { avisarCompra, avisarEstorno, avisarAdmin, COMANDOS };
