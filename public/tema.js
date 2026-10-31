/* Aplica a aparencia salva no painel (public/loja.json): cores e faixa de aviso. */
(function () {
  function hex(c) { return /^#[0-9a-f]{6}$/i.test(c || ""); }
  fetch("/loja.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
    if (!l) return;
    var R = document.documentElement, c = l.cores || {}, m = { gold: "--gold", gold2: "--gold2", bg: "--bg", panel: "--panel", text: "--text" };
    for (var k in m) { if (hex(c[k])) R.style.setProperty(m[k], c[k]); }
    if (hex(c.panel)) R.style.setProperty("--panel2", c.panel);
    if (hex(c.bg)) { var t = document.querySelector('meta[name="theme-color"]'); if (t) t.setAttribute("content", c.bg); }
    var a = l.anuncio;
    if (a && a.ativo && a.texto) {
      var bar = document.createElement(a.link && /^(https:\/\/|\/)/.test(a.link) ? "a" : "div");
      if (bar.tagName === "A") bar.href = a.link;
      bar.textContent = a.texto;
      bar.style.cssText = "display:block;background:var(--gold);color:#141108;text-align:center;padding:.55rem 1rem;font-weight:700;font-size:.9rem;text-decoration:none";
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }).catch(function () {});
})();
