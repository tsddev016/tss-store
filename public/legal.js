/* TSS - aceite dos Termos + links legais. Mude V ao alterar os termos (igual a TERMOS_VERSAO em api/_cofre.js). */
(function(){
  var V="2026-10-29",KEY="tss_aceite";
  function aceito(){try{var a=JSON.parse(localStorage.getItem(KEY)||"null");return !!a&&a.v===V}catch(e){return false}}
  function paginaLegal(){return /^\/(termos|privacidade|reembolso|sobre|suporte)(\.html)?\/?$/.test(location.pathname)}
  function el(t,a,h){var e=document.createElement(t);for(var k in a||{})e[k]=a[k];if(h!=null)e.innerHTML=h;return e}
  function sincronizar(){
    if(!aceito())return Promise.resolve();
    return fetch("/api/conta",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"aceitar",versao:V})}).catch(function(){});
  }
  function mostrar(){
    if(document.getElementById("tss-aceite"))return;
    var css=el("link",{rel:"stylesheet",href:"/legal.css"});document.head.appendChild(css);
    var w=el("div",{id:"tss-aceite",role:"dialog"});w.setAttribute("aria-modal","true");w.setAttribute("aria-labelledby","tss-ac-t");
    w.innerHTML='<div class="box"><h2 id="tss-ac-t">Antes de continuar</h2>'
      +'<p>Para usar a TSS The Swift Store, leia e aceite as regras abaixo. Resumo do que importa:</p>'
      +'<ul><li><b>Seus dados:</b> para comprar pedimos nome completo, CPF e e-mail (nome e CPF vão só ao Mercado Pago; guardamos apenas o e-mail, como código de verificação). Registramos também IP e navegador no aceite, e um código do computador para limitar o uso da chave.</li>'
      +'<li><b>Jogo:</b> você compra uma <b>licença de uso pessoal</b>, não o jogo em si. Compartilhar ou revender a chave não é permitido.</li>'
      +'<li><b>Reembolso:</b> 7 dias para desistir da compra online, conforme o Código de Defesa do Consumidor.</li>'
      +'<li><b>Aviso:</b> jogos de terror podem ter sustos e luzes piscantes.</li></ul>'
      +'<label><input type="checkbox" id="tss-c1"><span>Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a>, a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a> e a <a href="/reembolso" target="_blank" rel="noopener">Política de Reembolso</a>.</span></label>'
      +'<label><input type="checkbox" id="tss-c2"><span>Tenho 18 anos ou mais (ou tenho autorização do meu responsável legal).</span></label>'
      +'<div class="bt"><button type="button" id="tss-nao">Não aceito</button><button type="button" class="ok" id="tss-sim" disabled>Aceitar e continuar</button></div>'
      +'<p class="rec" id="tss-rec" hidden>Sem o aceite não conseguimos liberar a loja. Você pode ler os documentos e voltar quando quiser.</p></div>';
    document.body.appendChild(w);document.documentElement.style.overflow="hidden";
    var c1=document.getElementById("tss-c1"),c2=document.getElementById("tss-c2"),ok=document.getElementById("tss-sim");
    function chk(){ok.disabled=!(c1.checked&&c2.checked)}c1.onchange=chk;c2.onchange=chk;
    document.getElementById("tss-nao").onclick=function(){document.getElementById("tss-rec").hidden=false};
    ok.onclick=function(){
      try{localStorage.setItem(KEY,JSON.stringify({v:V,t:new Date().toISOString()}))}catch(e){}
      w.remove();document.documentElement.style.overflow="";sincronizar();
    };
    c1.focus();
  }
  function empresa(){
    var els=document.querySelectorAll("[data-emp]");if(!els.length)return;
    fetch("/empresa.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(d){
      for(var i=0;i<els.length;i++){var v=d[els[i].getAttribute("data-emp")];els[i].textContent=v&&String(v).trim()?v:(els[i].getAttribute("data-fallback")||"informado no Discord da TSS")}
    }).catch(function(){for(var i=0;i<els.length;i++)els[i].textContent=els[i].getAttribute("data-fallback")||"informado no Discord da TSS"});
  }
  window.TSSLegal={versao:V,aceito:aceito,sincronizar:sincronizar};
  function init(){empresa();if(!aceito()&&!paginaLegal())mostrar()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
