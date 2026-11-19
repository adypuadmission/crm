// Loaded only on college portals (/c/<code>/…): keeps every request and link inside that college.
(function () {
  var m = document.querySelector('meta[name="t-base"]'); var B = m ? m.content : '';
  window.__b = B; if (!B) return;
  var STATIC = /^\/(style\.css|app\.js|admin\.css|guard\.js|panel\.js|help\.js|login\.js|apply\.js|apply\.css|tenant-shim\.js|favicon|fonts\/)/;
  var fix = function (u) { return typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' && u.indexOf(B + '/') !== 0 && u !== B && !STATIC.test(u) ? B + u : u; };
  window.__u = fix;
  var f = window.fetch; window.fetch = function (u, o) { return f.call(this, fix(u), o); };
  var xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (meth, u) { arguments[1] = fix(u); return xo.apply(this, arguments); };
  var wo = window.open; window.open = function (u) { arguments[0] = fix(u); return wo.apply(this, arguments); };
  var attrs = ['href', 'src', 'action'];
  var walk = function (el) {
    if (!el || el.nodeType !== 1) return;
    attrs.forEach(function (a) { var v = el.getAttribute && el.getAttribute(a); if (v && v !== fix(v)) el.setAttribute(a, fix(v)); });
    if (el.querySelectorAll) el.querySelectorAll('[href^="/"],[src^="/"],[action^="/"]').forEach(function (n) { attrs.forEach(function (a) { var v = n.getAttribute(a); if (v && v !== fix(v)) n.setAttribute(a, fix(v)); }); });
  };
  new MutationObserver(function (list) { list.forEach(function (r) { if (r.type === 'attributes') walk(r.target); else r.addedNodes.forEach(walk); }); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: attrs });
  document.addEventListener('DOMContentLoaded', function () { walk(document.body); });
})();
