// Screen protection for the admin and sub-admin dashboards.
// Sub-admins: watermark with their identity, copy / print / save / right-click / screenshot attempts are blocked
// and reported to the main admin, data blurs when the window loses focus, idle sessions are signed out.
// Main admin: watermark + idle sign-out (the admin keeps full access).
(() => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body || {}) }).catch(() => {});
  const isField = (el) => el && (el.closest('input, textarea, select, [contenteditable="true"]'));
  // copying is allowed only inside a box the person is typing in — never from read-only boxes that show data
  const isEditable = (el) => { const f = isField(el); return !!f && !f.readOnly && !f.disabled && !(f.closest && f.closest('.appc-l, .copyrow')); };
  const page = location.pathname.startsWith('/team') ? 'counsellor workspace' : 'admin dashboard';
  let ME = null, lastReport = {}, osKeyAt = 0;

  function toast(msg) {
    let t = document.getElementById('guardToast');
    if (!t) { t = document.createElement('div'); t.id = 'guardToast'; t.className = 'guard-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function report(type, detail) {
    const now = Date.now();
    if (now - (lastReport[type] || 0) < 4000) return; // one report per burst
    lastReport[type] = now;
    fetch('/api/security/event', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ type, page, detail }) })
      .then((r) => r.json()).then((j) => { if (j && j.locked) { alert('Your account has been locked because of repeated attempts to copy or capture student data. Please contact the admin.'); location.href = (window.__b || '') + '/admin/login'; } }).catch(() => {});
  }
  function watermark(text) {
    const safe = text.replace(/[<&>]/g, ''), op = ME && ME.role === 'sub' ? 0.11 : 0.075;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="190"><g transform="rotate(-24 180 95)" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#0B1F4B" fill-opacity="${op}"><text x="0" y="80">${safe}</text><text x="40" y="150" font-size="11">ADYPU · CONFIDENTIAL · traceable copy</text></g></svg>`;
    const wm = document.createElement('div');
    wm.className = 'guard-wm';
    wm.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    document.body.appendChild(wm);
    // keep it there even if someone deletes it in developer tools
    new MutationObserver(() => { if (!document.body.contains(wm)) { document.body.appendChild(wm); report('devtools', 'watermark removed'); } }).observe(document.body, { childList: true });
  }

  function protectSub() {
    document.documentElement.classList.add('guard-sub');
    const block = (e, type, msg) => { e.preventDefault(); e.stopPropagation(); report(type); toast(msg); };
    document.addEventListener('copy', (e) => { if (!isEditable(document.activeElement) || !isEditable(e.target)) block(e, 'copy', '⛔ Copying student data is not allowed. The admin has been notified.'); }, true);
    document.addEventListener('cut', (e) => { if (!isEditable(document.activeElement)) block(e, 'cut', '⛔ Not allowed. The admin has been notified.'); }, true);
    document.addEventListener('contextmenu', (e) => { if (!isField(e.target)) block(e, 'contextmenu', '⛔ Right-click is disabled on this page.'); }, true);
    document.addEventListener('dragstart', (e) => { if (!isField(e.target)) block(e, 'drag', '⛔ Dragging data out is not allowed.'); }, true);
    document.addEventListener('selectstart', (e) => { if (!isField(e.target)) e.preventDefault(); }, true);
    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'p') return block(e, 'print', '⛔ Printing is disabled. The admin has been notified.');
      if (mod && k === 's') return block(e, 'save', '⛔ Saving this page is disabled. The admin has been notified.');
      if (mod && k === 'a' && !isField(e.target)) return block(e, 'selectall', '⛔ Select-all is disabled on this page.');
      if (mod && ['c', 'x'].includes(k) && !isEditable(e.target)) return block(e, 'copy', '⛔ Copying student data is not allowed. The admin has been notified.');
      if (k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k))) return block(e, 'devtools', '⛔ Developer tools are not allowed here.');
      if (k === 'printscreen') { shield(); report('screenshot', 'PrintScreen key'); }
      // Windows snipping (Win+Shift+S), Mac screenshots (Cmd+Shift+3/4/5), Windows Game Bar (Win+Alt+PrtScn / Win+G)
      if (k === 'meta' || k === 'os') osKeyAt = Date.now();
      if (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) { shield(); report('screenshot', `screenshot shortcut (${e.metaKey ? 'Cmd/Win' : ''}+Shift+${k.toUpperCase()})`); }
      if (e.metaKey && (k === 'g' || (e.altKey && k === 'r'))) { shield(); report('screenshot', 'screen recording shortcut'); }
    }, true);
    document.addEventListener('keyup', (e) => { if ((e.key || '').toLowerCase() === 'printscreen') { shield(); report('screenshot', 'PrintScreen key'); try { navigator.clipboard.writeText('Screenshots of ADYPU student data are not allowed.'); } catch {} } }, true);
    window.addEventListener('beforeprint', () => report('print', 'browser print'));
    // blur data when the window loses focus (snipping / screen-capture tools take focus first)
    window.addEventListener('blur', () => {
      document.documentElement.classList.add('guard-blur');
      // the Windows key pressed just before the window lost focus = snipping tool / screenshot overlay
      if (Date.now() - osKeyAt < 1500) { report('screenshot', 'Windows key + window lost focus (snipping tool)'); osKeyAt = 0; }
    });
    window.addEventListener('focus', () => document.documentElement.classList.remove('guard-blur'));
    document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('guard-blur', document.hidden));
    // developer tools heuristic
    let devOpen = false;
    setInterval(() => {
      const open = window.outerWidth - window.innerWidth > 220 || window.outerHeight - window.innerHeight > 260;
      if (open && !devOpen) report('devtools', 'window size changed like developer tools');
      devOpen = open;
    }, 2500);
  }
  function shield() {
    document.documentElement.classList.add('guard-blur');
    setTimeout(() => document.documentElement.classList.remove('guard-blur'), 1500);
    toast('⛔ Screenshots of student data are not allowed. The admin has been notified.');
  }

  function idleLogout(minutes) {
    let last = Date.now();
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { last = Date.now(); }, { passive: true }));
    setInterval(async () => {
      const left = minutes * 60000 - (Date.now() - last);
      if (left <= 60000 && left > 50000) toast('⏳ You will be signed out in 1 minute because of inactivity.');
      if (left <= 0) { await post('/api/admin/logout'); location.href = (window.__b || '') + '/admin/login?idle=1'; }
    }, 10000);
  }

  fetch('/api/security/whoami').then((r) => (r.ok ? r.json() : null)).then((me) => {
    if (!me) return;
    ME = me;
    const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    watermark(me.role === 'sub' ? `${me.name} · @${me.username} · ${me.ip} · ${when}` : `CONFIDENTIAL · ${me.name} (Main Admin) · ${when}`);
    if (me.role === 'sub') protectSub();
    idleLogout(me.idleMinutes || 15);
  }).catch(() => {});
})();
