/* TSS - links legais e dados da empresa. Sem popup de aceite e sem coleta de dados. */
(function(){
  var V="2026-10-29";
  function empresa(){
    var els=document.querySelectorAll("[data-emp]");if(!els.length)return;
    fetch("/empresa.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(d){
      for(var i=0;i<els.length;i++){var v=d[els[i].getAttribute("data-emp")];els[i].textContent=v&&String(v).trim()?v:(els[i].getAttribute("data-fallback")||"informado no Discord da TSS")}
    }).catch(function(){for(var i=0;i<els.length;i++)els[i].textContent=els[i].getAttribute("data-fallback")||"informado no Discord da TSS"});
  }
  window.TSSLegal={versao:V,aceito:function(){return true},sincronizar:function(){return Promise.resolve()}};
  function init(){empresa()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
