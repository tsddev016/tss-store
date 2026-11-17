/* TSS - login obrigatorio com o Discord + links legais. Sem popup de aceite e sem coleta de dados. */
(function(){
  var V="2026-10-29";
  var LIVRES=/^\/(conta|termos|privacidade|reembolso|sobre|suporte|404)(\.html)?\/?$/;
  function portao(){
    if(LIVRES.test(location.pathname))return;
    var st=document.createElement("style");st.id="tss-gate";st.textContent="html{visibility:hidden}";document.head.appendChild(st);
    function liberar(){var s=document.getElementById("tss-gate");if(s)s.remove()}
    fetch("/api/auth?acao=eu",{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json()}).then(function(d){
      if(d&&d.logado){liberar();return}
      location.replace("/auth/entrar/discord?volta="+encodeURIComponent(location.pathname+location.search));
    }).catch(function(){liberar()});
  }
  function empresa(){
    var els=document.querySelectorAll("[data-emp]");if(!els.length)return;
    fetch("/empresa.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(d){
      for(var i=0;i<els.length;i++){var v=d[els[i].getAttribute("data-emp")];els[i].textContent=v&&String(v).trim()?v:(els[i].getAttribute("data-fallback")||"informado no Discord da TSS")}
    }).catch(function(){for(var i=0;i<els.length;i++)els[i].textContent=els[i].getAttribute("data-fallback")||"informado no Discord da TSS"});
  }
  window.TSSLegal={versao:V,aceito:function(){return true},sincronizar:function(){return Promise.resolve()}};
  portao();
  function init(){empresa()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
