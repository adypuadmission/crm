(() => {
  const $ = (s) => document.querySelector(s);
  const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(opts.headers || {}) } })
    .then(async (r) => { if (r.status === 401) { location.href = '/admin/login'; throw new Error('auth'); } return r.json(); });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const istParts = (iso) => { const d = new Date(new Date(iso).getTime() + 330 * 60000); return { dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() }; };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const STATUS_CLS = { 'New': 's-new', 'Contacted': 's-contacted', 'Interested': 's-interested', 'Counselling Done': 's-counsel', 'Applied': 's-applied', 'Admitted': 's-admitted', 'Not Interested': 's-no' };
  const SMS_BADGE = { sent: ['✓ Sent', 'ok'], logged: ['Logged (test)', 'test'], failed: ['✕ Failed', 'bad'] };
  const FUNNEL = ['New', 'Contacted', 'Interested', 'Counselling Done', 'Applied', 'Admitted'];
  const PAL = {
    UG: { base: '#0B1F4B', progs: ['#1e3a8a', '#3b5bdb', '#6d83f2', '#a5b4fc'], br: '#c7d2fe' },
    PG: { base: '#c2410c', progs: ['#ea580c', '#f59e0b', '#fbbf24'], br: '#fed7aa' },
  };
  const FILTERS = ['pushedBy', 'counsellor', 'q', 'programme', 'branch', 'region', 'status', 'verified', 'from', 'to'];
  let TEAM = [], STATUSES = [], LEVELS = { UG: [], PG: [] }, rows = [], allRows = [], inited = false, level = '', trendDays = 14;
  let sort = { key: 'date', dir: 'desc' };

  // ---------- helpers ----------
  const params = () => {
    const p = new URLSearchParams();
    if (level) p.set('level', level);
    FILTERS.forEach((k) => { const v = $('#' + k).value.trim(); if (v) p.set(k, v); });
    p.set('sort', sort.key); p.set('dir', sort.dir);
    return p.toString();
  };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
  // CSP blocks inline style attributes, so sizes go through the CSSOM after rendering.
  const applySizes = (root) => {
    root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
  };
  function countUp(el, to) {
    const t0 = performance.now(), d = 700;
    const step = (t) => { const k = Math.min(1, (t - t0) / d); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const lastDays = (n) => { const out = [], now = Date.now(); for (let i = n - 1; i >= 0; i--) out.push(istDay(now - i * 864e5)); return out; };
  const programmesOf = (lv) => (lv ? LEVELS[lv] : [...LEVELS.UG, ...LEVELS.PG]).map((p) => p.name);
  const branchesAll = () => { const p = [...LEVELS.UG, ...LEVELS.PG].find((x) => x.branches); return p ? p.branches : []; };

  async function load() {
    const qs = params();
    $('#xlsx').href = '/api/admin/export.xlsx?' + qs;
    $('#pdf').href = '/api/admin/export.pdf?' + qs;
    const [j, everything] = await Promise.all([api('/api/admin/enquiries?' + qs), api('/api/admin/enquiries')]);
    rows = j.rows; allRows = everything.rows; STATUSES = j.statuses; LEVELS = j.levels || LEVELS; TEAM = j.team || []; fillTeamSelects();
    if (!inited) init(j);
    render();
  }
  function init(j) {
    inited = true;
    $('#status').insertAdjacentHTML('beforeend', STATUSES.map((s) => `<option>${esc(s)}</option>`).join(''));
    const pill = $('#smsPill');
    pill.textContent = j.smsProvider === 'console' ? '📵 SMS: test mode' : `📱 SMS: ${j.smsProvider}`;
    pill.classList.toggle('warn', j.smsProvider === 'console');
    fillProgrammes(); fillBranches();
  }
  function fillProgrammes() {
    const cur = $('#programme').value, list = programmesOf(level);
    $('#programme').innerHTML = '<option value="">All programmes</option>' + list.map((p) => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('');
    if (cur && !list.includes(cur)) $('#programme').value = '';
  }
  function fillBranches() {
    const prog = [...LEVELS.UG, ...LEVELS.PG].find((p) => p.name === $('#programme').value);
    const list = prog ? (prog.branches || []) : branchesAll();
    const cur = $('#branch').value;
    $('#branch').innerHTML = `<option value="">${prog && !prog.branches ? 'No branches' : 'All branches'}</option>` + list.map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
    $('#branch').disabled = !!prog && !prog.branches;
    if (cur && !list.includes(cur)) $('#branch').value = '';
  }
  function fillTeamSelects() {
    [['pushedBy', '<option value="">All sources</option><option value="web">🌐 Website form</option>'], ['counsellor', '<option value="">All counsellors</option><option value="none">⚠ Unassigned</option>']].forEach(([id, base]) => {
      const el = $('#' + id), cur = el.value;
      el.innerHTML = base + TEAM.map((u) => `<option value="${u.id}">${u.active ? '👤' : '⛔'} ${esc(u.name)}</option>`).join('');
      el.value = [...el.options].some((o) => o.value === cur) ? cur : '';
    });
  }
  function fillRegions() {
    const cur = $('#region').value;
    const regs = [...new Set(allRows.map((r) => r.region || 'Other'))].sort();
    if (cur && !regs.includes(cur)) regs.push(cur);
    $('#region').innerHTML = '<option value="">All regions</option>' + regs.map((r) => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('');
  }
  function setFilter(key, val, toggle = true) {
    if (key === 'level') { level = toggle && level === val ? '' : val; syncLevel(); fillProgrammes(); fillBranches(); }
    else {
      const el = $('#' + key);
      if (el.tagName === 'SELECT' && val && ![...el.options].some((o) => o.value === val)) el.insertAdjacentHTML('beforeend', `<option>${esc(val)}</option>`);
      el.value = toggle && el.value === val ? '' : val;
      if (key === 'programme') fillBranches();
    }
    load();
  }
  const syncLevel = () => $('#lvlSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.level === level));

  // ---------- render ----------
  function render() {
    fillRegions(); renderChips();
    $('#tabCount').textContent = rows.length;
    renderKpis(); renderInsights(); renderSunburst(); renderFunnel(); renderMap(); renderTrend(); renderHeatmap(); renderLeader(); renderPerf(); renderTable();
  }

  function renderChips() {
    const labels = { pushedBy: 'Pushed by', counsellor: 'Counsellor', q: 'Search', programme: 'Programme', branch: 'Branch', region: 'Region', status: 'Status', verified: 'Verified', from: 'From', to: 'To' };
    const chips = [];
    if (level) chips.push(`<span class="fchip">Level: <b>${level}</b><button data-clear="level" aria-label="Remove filter">✕</button></span>`);
    FILTERS.filter((k) => $('#' + k).value).forEach((k) => {
      const el = $('#' + k), txt = el.selectedOptions ? el.selectedOptions[0].text : el.value;
      chips.push(`<span class="fchip">${labels[k]}: <b>${esc(txt)}</b><button data-clear="${k}" aria-label="Remove filter">✕</button></span>`);
    });
    $('#activeChips').innerHTML = chips.join('');
  }

  // KPI cards with sparkline, split bar and rings
  function sparkline(values, w = 120, h = 34) {
    const max = Math.max(1, ...values), step = w / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}"><path d="${line}L${w},${h}L0,${h}Z" fill="url(#sg)" opacity=".35"/><path d="${line}" fill="none" stroke="#F08A24" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="#F08A24"/><defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F08A24"/><stop offset="1" stop-color="#F08A24" stop-opacity="0"/></linearGradient></defs></svg>`;
  }
  function ring(p, color) {
    const r = 22, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="#eef2f8" stroke-width="7"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 28 28)" class="ring-arc"/>
      <text x="28" y="32" text-anchor="middle" font-size="12" font-weight="700" fill="#0B1F4B">${p}%</text></svg>`;
  }
  function renderKpis() {
    const days = lastDays(14), byDay = Object.fromEntries(days.map((d) => [d, 0]));
    rows.forEach((r) => { const k = istDay(r.created_at); if (k in byDay) byDay[k]++; });
    const series = days.map((d) => byDay[d]);
    const last7 = series.slice(7).reduce((a, b) => a + b, 0), prev7 = series.slice(0, 7).reduce((a, b) => a + b, 0);
    const delta = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : (last7 ? 100 : 0);
    const ug = rows.filter((r) => r.level === 'UG').length, pg = rows.filter((r) => r.level === 'PG').length;
    const ver = rows.filter((r) => r.mobile_verified).length, adm = rows.filter((r) => r.status === 'Admitted').length;
    const pending = rows.filter((r) => r.status === 'New' && Date.now() - new Date(r.created_at) > 864e5).length;
    const today = rows.filter((r) => istDay(r.created_at) === istDay(Date.now())).length;
    $('#kpis').innerHTML = `
      <div class="kpi k-main"><div class="kt">Total enquiries</div><div class="kv"><b class="cu" data-v="${rows.length}">0</b>
        <span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% <small>vs prev. week</small></span></div>${sparkline(series)}<div class="kf">⚡ ${today} today</div></div>
      <div class="kpi"><div class="kt">UG vs PG</div><div class="kv"><b class="cu" data-v="${ug}">0</b><span class="muted"> / </span><b class="cu pg" data-v="${pg}">0</b></div>
        <div class="split"><span class="s-ug" data-w="${pct(ug, ug + pg) || 0}"></span><span class="s-pg" data-w="${pct(pg, ug + pg) || 0}"></span></div>
        <div class="kf"><span class="dot-ug"></span>UG ${pct(ug, ug + pg)}% · <span class="dot-pg"></span>PG ${pct(pg, ug + pg)}%</div></div>
      <div class="kpi k-ring">${ring(pct(ver, rows.length), '#0d9488')}<div><div class="kt">Mobile verified</div><div class="kv"><b class="cu" data-v="${ver}">0</b></div><div class="kf">OTP-confirmed numbers</div></div></div>
      <div class="kpi k-ring">${ring(pct(adm, rows.length), '#16a34a')}<div><div class="kt">Admitted</div><div class="kv"><b class="cu" data-v="${adm}">0</b></div><div class="kf">Enquiry → admission</div></div></div>
      <div class="kpi ${pending ? 'k-alert' : ''}" data-click="status:New"><div class="kt">Waiting > 24 h</div><div class="kv"><b class="cu" data-v="${pending}">0</b></div>
        <div class="kf">${pending ? '📞 New enquiries not yet called. Click to list them.' : '✅ Every enquiry has been followed up'}</div></div>`;
    $('#kpis').querySelectorAll('.cu').forEach((el) => countUp(el, +el.dataset.v));
    applySizes($('#kpis'));
  }

  // Auto-written insights
  function topOf(list, fn) { const m = {}; list.forEach((r) => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
  const SLOTS = ['12–3 am', '3–6 am', '6–9 am', '9 am–12 noon', '12–3 pm', '3–6 pm', '6–9 pm', '9 pm–12 am'];
  const SLOT_SHORT = ['12–3a', '3–6a', '6–9a', '9–12n', '12–3p', '3–6p', '6–9p', '9p–12'];
  const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function renderInsights() {
    const out = [];
    if (!rows.length) { $('#insights').innerHTML = '<div class="ins"><span>🔎</span><p>No enquiries match these filters yet.</p></div>'; return; }
    const reg = topOf(rows, (r) => r.region);
    if (reg[0]) out.push(['🗺️', `<b>${esc(reg[0][0])}</b> brings <b>${pct(reg[0][1], rows.length)}%</b> of enquiries${reg[1] ? `, followed by ${esc(reg[1][0])}` : ''}.`, `region:${reg[0][0]}`]);
    const br = topOf(rows, (r) => r.branch);
    if (br[0]) out.push(['⚙️', `<b>${esc(br[0][0])}</b> is the most wanted branch (${br[0][1]} ${br[0][1] === 1 ? 'enquiry' : 'enquiries'}).`, `branch:${br[0][0]}`]);
    else { const pr = topOf(rows, (r) => r.programme); if (pr[0]) out.push(['🎓', `<b>${esc(pr[0][0])}</b> is the most popular programme (${pr[0][1]}).`, `programme:${pr[0][0]}`]); }
    const s = lastDays(14).map((d) => rows.filter((r) => istDay(r.created_at) === d).length);
    const a = s.slice(7).reduce((x, y) => x + y, 0), b = s.slice(0, 7).reduce((x, y) => x + y, 0);
    if (a || b) out.push(a > b ? ['🚀', `Momentum is <b>up</b>: ${a} enquiries this week vs ${b} the week before.`, '']
      : a === b ? ['➖', `Enquiries are <b>steady</b>: ${a} this week, same as last week.`, '']
        : ['📉', `Enquiries <b>slowed</b>: ${a} this week vs ${b} last week. Time for a campaign push?`, '']);
    const hm = {}; rows.forEach((r) => { const p = istParts(r.created_at), k = `${p.dow}-${Math.floor(p.hour / 3)}`; hm[k] = (hm[k] || 0) + 1; });
    const best = Object.entries(hm).sort((x, y) => y[1] - x[1])[0];
    if (best) { const [d, sl] = best[0].split('-').map(Number); out.push(['⏰', `Students are most active on <b>${DOWS[d]}, ${SLOTS[sl]}</b>. That's the best time to call back.`, '']); }
    const un = rows.filter((r) => !r.counsellor_id).length;
    if (un) out.push(['🧭', `<b>${un}</b> ${un === 1 ? 'enquiry has' : 'enquiries have'} no counsellor yet. Assign them in the Enquiries tab.`, 'counsellor:none']);
    const nv = rows.filter((r) => !r.mobile_verified).length;
    const fails = rows.filter((r) => r.sms_status === 'failed').length;
    if (fails) out.push(['📵', `<b>${fails}</b> confirmation SMS failed. Resend them from the Enquiries tab.`, '']);
    else if (nv) out.push(['🔐', `<b>${nv}</b> enquiries have an unverified mobile number.`, 'verified:no']);
    $('#insights').innerHTML = out.slice(0, 4).map(([i, t, f], k) => `<div class="ins ${f ? 'clk' : ''}" ${f ? `data-click="${esc(f)}"` : ''}><span>${i}</span><p>${t}</p></div>`).join('');
  }

  // Sunburst: level → programme → branch
  function arc(r0, r1, a0, a1) {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-3;
    const P = (r, a) => [(180 + r * Math.sin(a)).toFixed(2), (180 - r * Math.cos(a)).toFixed(2)];
    const L = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = P(r1, a0), [x1, y1] = P(r1, a1), [x2, y2] = P(r0, a1), [x3, y3] = P(r0, a0);
    return `M${x0},${y0}A${r1},${r1} 0 ${L} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${L} 0 ${x3},${y3}Z`;
  }
  function renderSunburst() {
    const svg = $('#sunburst'), total = rows.length;
    $('#sbReset').hidden = !(level || $('#programme').value || $('#branch').value);
    if (!total) { svg.innerHTML = '<text x="180" y="185" text-anchor="middle" fill="#94a3b8" font-size="14">No data</text>'; $('#sbLegend').innerHTML = ''; return; }
    const tree = {};
    rows.forEach((r) => {
      const L = r.level || 'UG', P = r.programme || r.course, B = r.branch || '';
      tree[L] = tree[L] || { n: 0, p: {} }; tree[L].n++;
      tree[L].p[P] = tree[L].p[P] || { n: 0, b: {} }; tree[L].p[P].n++;
      if (B) tree[L].p[P].b[B] = (tree[L].p[P].b[B] || 0) + 1;
    });
    let a = 0, parts = [], legend = [];
    ['UG', 'PG'].filter((L) => tree[L]).forEach((L) => {
      const pal = PAL[L], la0 = a, la1 = a + (tree[L].n / total) * Math.PI * 2;
      parts.push(`<path class="seg" d="${arc(52, 92, la0, la1)}" fill="${pal.base}" data-click="level:${L}" data-tip="${L}: ${tree[L].n} enquiries (${pct(tree[L].n, total)}%)"/>`);
      if (la1 - la0 > 0.35) { const m = (la0 + la1) / 2; parts.push(`<text x="${180 + 72 * Math.sin(m)}" y="${184 - 72 * Math.cos(m)}" text-anchor="middle" class="sb-l">${L}</text>`); }
      let pa = la0;
      Object.entries(tree[L].p).sort((x, y) => y[1].n - x[1].n).forEach(([P, pd], i) => {
        const pa1 = pa + (pd.n / total) * Math.PI * 2, col = pal.progs[i % pal.progs.length];
        parts.push(`<path class="seg" d="${arc(95, 135, pa, pa1)}" fill="${col}" data-click="programme:${esc(P)}|level:${L}" data-tip="${esc(P)} (${L}): ${pd.n} (${pct(pd.n, total)}%)"/>`);
        if (pa1 - pa > 0.3) { const m = (pa + pa1) / 2; parts.push(`<text x="${180 + 115 * Math.sin(m)}" y="${183 - 115 * Math.cos(m)}" text-anchor="middle" class="sb-p">${esc(P.replace('Hotel Management', 'Hotel'))}</text>`); }
        legend.push(`<button class="lg" data-click="programme:${esc(P)}|level:${L}"><i class="sw-${L.toLowerCase()}-${i % pal.progs.length}"></i><span>${esc(P)} <small>${L}</small></span><b>${pd.n}</b></button>`);
        let ba = pa;
        Object.entries(pd.b).sort((x, y) => y[1] - x[1]).forEach(([B, n], k) => {
          const ba1 = ba + (n / total) * Math.PI * 2;
          parts.push(`<path class="seg br" d="${arc(138, 172, ba, ba1)}" fill="${col}" fill-opacity="${0.35 + 0.5 * ((k % 3) / 2)}" data-click="branch:${esc(B)}|programme:${esc(P)}|level:${L}" data-tip="${esc(P)} – ${esc(B)}: ${n}"/>`);
          ba = ba1;
        });
        pa = pa1;
      });
      a = la1;
    });
    const label = $('#branch').value || $('#programme').value || (level ? `${level} programmes` : 'All enquiries');
    svg.innerHTML = `<g class="sb-anim">${parts.join('')}</g><circle cx="180" cy="180" r="48" fill="#fff"/>
      <text x="180" y="176" text-anchor="middle" class="sb-n">${total}</text><text x="180" y="196" text-anchor="middle" class="sb-c">${esc(label.length > 18 ? label.slice(0, 17) + '…' : label)}</text>`;
    $('#sbLegend').innerHTML = legend.join('');
  }

  // Admission funnel
  function renderFunnel() {
    const idx = (s) => (s === 'Not Interested' ? 1 : Math.max(0, FUNNEL.indexOf(s)));
    const reached = FUNNEL.map((_, i) => rows.filter((r) => idx(r.status) >= i).length);
    const ni = rows.filter((r) => r.status === 'Not Interested').length;
    const icons = ['📝', '📞', '💡', '🧑‍🏫', '📄', '🎉'];
    $('#funnel').innerHTML = FUNNEL.map((st, i) => {
      const w = reached[i] ? Math.max(8, (reached[i] / rows.length) * 100) : 0;
      const conv = i ? `${pct(reached[i], reached[i - 1])}% from previous` : 'all enquiries';
      return `<button class="fs ${$('#status').value === st ? 'sel' : ''}" data-click="status:${st}" data-tip="${st}: ${reached[i]} reached this stage (${conv})">
        <span class="fl">${icons[i]} ${st}</span><span class="fb"><span class="ff f${i} ${w ? '' : 'zero'}" data-w="${w}"><b>${reached[i] || ''}</b></span></span><span class="fp">${pct(reached[i], rows.length)}%</span></button>`;
    }).join('') + `<p class="fnote">${ni ? `❌ ${ni} not interested · ` : ''}Overall conversion to admission: <b>${pct(reached[5], rows.length)}%</b></p>`;
    applySizes($('#funnel'));
  }

  // Maharashtra division tile map
  const DIVS = [
    ['Konkan / Mumbai Division', 'Mumbai·Konkan', 70, 160], ['Nashik Division', 'Nashik', 170, 95], ['Pune Division', 'Pune', 170, 225],
    ['Chhatrapati Sambhajinagar Division', 'Sambhajinagar', 270, 160], ['Amravati Division', 'Amravati', 370, 95], ['Nagpur Division', 'Nagpur', 455, 160],
  ];
  function hex(cx, cy, r) { return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 6; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' '); }
  function shade(t) { // light lavender → navy
    const A = [238, 242, 255], B = [11, 31, 75]; return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
  }
  function renderMap() {
    const counts = topOf(rows, (r) => r.region || 'Other'), m = Object.fromEntries(counts), max = Math.max(1, ...DIVS.map((d) => m[d[0]] || 0));
    const top = DIVS.map((d) => [d, m[d[0]] || 0]).sort((a, b) => b[1] - a[1])[0];
    const sel = $('#region').value;
    $('#mhmap').innerHTML = `<text x="12" y="160" class="sea" text-anchor="middle" transform="rotate(-90 12 160)">ARABIAN SEA</text>` + DIVS.map(([key, short, x, y]) => {
      const n = m[key] || 0, t = n / max, dark = t > 0.45;
      return `<g class="tile ${sel === key ? 'sel' : ''}" data-click="region:${esc(key)}" data-tip="${esc(key)}: ${n} enquiries (${pct(n, rows.length)}%)">
        ${top && top[0][0] === key && n ? `<polygon points="${hex(x, y, 60)}" class="pulse"/>` : ''}
        <polygon points="${hex(x, y, 54)}" fill="${n ? shade(0.12 + t * 0.88) : '#f8fafc'}" class="hx"/>
        <text x="${x}" y="${y - 6}" text-anchor="middle" class="t1 ${dark ? 'lt' : ''}">${short}</text>
        <text x="${x}" y="${y + 16}" text-anchor="middle" class="t2 ${dark ? 'lt' : ''}">${n}</text></g>`;
    }).join('') + `<text x="505" y="290" text-anchor="end" class="mh">MAHARASHTRA</text>`;
    const outside = counts.filter(([k]) => !DIVS.some((d) => d[0] === k));
    $('#outside').innerHTML = `<p class="ot">🧳 Beyond the divisions</p>` + (outside.length ? outside.map(([k, n]) =>
      `<button class="oc ${sel === k ? 'sel' : ''}" data-click="region:${esc(k)}"><span>${esc(k)}</span><b>${n}</b></button>`).join('') : '<p class="muted small">No enquiries from outside Maharashtra yet.</p>');
  }

  // Trend: stacked UG/PG bars + total line
  function renderTrend() {
    const days = lastDays(trendDays), W = 560, H = 250, L = 34, R = 10, T = 18, B = 34;
    const ug = days.map((d) => rows.filter((r) => istDay(r.created_at) === d && r.level === 'UG').length);
    const pg = days.map((d) => rows.filter((r) => istDay(r.created_at) === d && r.level === 'PG').length);
    const tot = days.map((_, i) => ug[i] + pg[i]), max = Math.max(2, ...tot);
    const bw = (W - L - R) / days.length, y = (v) => H - B - (v / max) * (H - T - B);
    const sel = $('#from').value && $('#from').value === $('#to').value ? $('#from').value : '';
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = Math.round((max / 4) * k); g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`; }
    const bars = days.map((d, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64, lbl = new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
      return `<g class="tb ${sel === d ? 'sel' : ''}" data-click="day:${d}" data-tip="${lbl}: ${tot[i]} (UG ${ug[i]}, PG ${pg[i]})">
        <rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" class="hit"/>
        <rect x="${x}" y="${y(ug[i])}" width="${w}" height="${H - B - y(ug[i])}" rx="3" class="b-ug"/>
        <rect x="${x}" y="${y(tot[i])}" width="${w}" height="${y(ug[i]) - y(tot[i])}" rx="3" class="b-pg"/>
        ${(trendDays <= 14 || i % 3 === 0) ? `<text x="${L + i * bw + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="ax">${trendDays > 14 ? lbl.split(' ')[0] : lbl}</text>` : ''}</g>`;
    }).join('');
    const pts = tot.map((v, i) => [L + i * bw + bw / 2, y(v)]);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    $('#trend').innerHTML = g + bars + `<path d="${path}" class="tl"/>` + pts.map((p, i) => tot[i] ? `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="td"/>` : '').join('') +
      `<g class="leg"><rect x="${W - 150}" y="2" width="10" height="10" rx="2" class="b-ug"/><text x="${W - 136}" y="11" class="ax">UG</text><rect x="${W - 105}" y="2" width="10" height="10" rx="2" class="b-pg"/><text x="${W - 91}" y="11" class="ax">PG</text><line x1="${W - 60}" x2="${W - 44}" y1="7" y2="7" class="tl"/><text x="${W - 40}" y="11" class="ax">Total</text></g>`;
  }

  // Day × time heatmap
  function renderHeatmap() {
    const W = 560, H = 250, L = 44, T = 22, cw = (W - L - 6) / 8, chh = (H - T - 8) / 7;
    const m = {}; rows.forEach((r) => { const p = istParts(r.created_at), k = `${p.dow}-${Math.floor(p.hour / 3)}`; m[k] = (m[k] || 0) + 1; });
    const max = Math.max(1, ...Object.values(m));
    let s = SLOT_SHORT.map((sl, j) => `<text x="${L + j * cw + cw / 2}" y="14" text-anchor="middle" class="ax">${sl}</text>`).join('');
    DOWS.forEach((d, i) => {
      s += `<text x="${L - 8}" y="${T + i * chh + chh / 2 + 4}" text-anchor="end" class="ax">${d}</text>`;
      for (let j = 0; j < 8; j++) {
        const n = m[`${i}-${j}`] || 0, t = n / max;
        const fill = n ? `rgb(${Math.round(255 - 15 * t)},${Math.round(237 - 120 * t)},${Math.round(213 - 190 * t)})` : '#f4f6fb';
        s += `<rect x="${L + j * cw + 2}" y="${T + i * chh + 2}" width="${cw - 4}" height="${chh - 4}" rx="6" fill="${fill}" class="hm" data-tip="${d} ${SLOTS[j]}: ${n} enquiries"/>`;
        if (n) s += `<text x="${L + j * cw + cw / 2}" y="${T + i * chh + chh / 2 + 4}" text-anchor="middle" class="hv ${t > 0.6 ? 'lt' : ''}">${n}</text>`;
      }
    });
    $('#heatmap').innerHTML = s;
  }

  // Branch leaderboard
  function renderLeader() {
    const m = {};
    rows.filter((r) => r.branch).forEach((r) => { m[r.branch] = m[r.branch] || { UG: 0, PG: 0 }; m[r.branch][r.level === 'PG' ? 'PG' : 'UG']++; });
    const list = Object.entries(m).map(([b, v]) => [b, v.UG, v.PG, v.UG + v.PG]).sort((a, b) => b[3] - a[3]);
    const max = Math.max(1, ...list.map((x) => x[3])), medal = ['🥇', '🥈', '🥉'];
    const sel = $('#branch').value;
    $('#leader').innerHTML = list.length ? list.slice(0, 10).map(([b, u, p, t], i) => `
      <button class="lr ${sel === b ? 'sel' : ''}" data-click="branch:${esc(b)}" data-tip="${esc(b)}: B.Tech ${u} · M.Tech ${p}">
        <span class="rk">${medal[i] || i + 1}</span><span class="bn">${esc(b)}</span>
        <span class="lb"><span class="l-ug" data-w="${(u / max) * 100}"></span><span class="l-pg" data-w="${(p / max) * 100}"></span></span><b>${t}</b></button>`).join('')
      + '<p class="fnote"><span class="dot-ug"></span>B.Tech <span class="dot-pg"></span>M.Tech</p>'
      : '<p class="muted small">No engineering enquiries for these filters.</p>';
    applySizes($('#leader'));
  }

  // Team performance
  function renderPerf() {
    const groups = [{ key: 'web', name: '🌐 Website form', list: rows.filter((r) => !r.created_by_id) }]
      .concat(TEAM.map((u) => ({ key: String(u.id), name: `👤 ${u.name}${u.active ? '' : ' (disabled)'}`, list: rows.filter((r) => r.created_by_id === u.id) })))
      .filter((g) => g.list.length).sort((a, b) => b.list.length - a.list.length);
    const max = Math.max(1, ...groups.map((g) => g.list.length)), sel = $('#pushedBy').value;
    $('#perf').innerHTML = groups.length ? groups.map((g) => {
      const adm = g.list.filter((r) => r.status === 'Admitted').length;
      return `<button class="pr ${sel === g.key ? 'sel' : ''}" data-click="pushedBy:${g.key}" data-tip="${esc(g.name)}: ${g.list.length} pushed · ${adm} admitted (${pct(adm, g.list.length)}%)">
        <span class="pn">${esc(g.name)}</span><span class="pb"><span class="p-all" data-w="${(g.list.length / max) * 100}"></span><span class="p-adm" data-w="${(adm / max) * 100}"></span></span>
        <span class="pv"><b>${g.list.length}</b> · ${adm} 🎉</span></button>`;
    }).join('') + '<p class="fnote"><span class="dot-lav"></span>Students pushed &nbsp; <span class="dot-adm"></span>Admitted</p>'
      : '<p class="muted small">No students for these filters.</p>';
    applySizes($('#perf'));
  }

  // Table
  function renderTable() {
    document.querySelectorAll('th.sortable').forEach((th) => { th.classList.toggle('active', th.dataset.sort === sort.key); th.dataset.dir = th.dataset.sort === sort.key ? sort.dir : ''; });
    $('#sortSel').value = `${sort.key}:${sort.dir}`;
    if (![...$('#sortSel').options].some((o) => o.value === $('#sortSel').value)) $('#sortSel').value = '';
    $('#hint').textContent = `Showing ${rows.length} of ${allRows.length} enquiries. Excel / PDF exports include exactly these rows, in this order.`;
    if (!rows.length) { $('#rows').innerHTML = '<tr><td colspan="13" class="empty">No enquiries found for these filters.</td></tr>'; return; }
    $('#rows').innerHTML = rows.map((r, i) => {
      const sb = SMS_BADGE[r.sms_status];
      return `<tr data-id="${r.id}">
        <td class="muted">${i + 1}</td>
        <td><code>${esc(r.ref_no)}</code></td>
        <td><b>${esc(r.student_name)}</b></td>
        <td class="nowrap"><a href="tel:+91${esc(r.mobile)}">+91 ${esc(r.mobile)}</a> ${r.mobile_verified ? '<span class="vchip" title="Verified by OTP">✓</span>' : '<span class="uchip" title="Not verified">?</span>'}${r.email ? `<br><a class="muted" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}</td>
        <td>${r.city ? `${esc(r.city)}<br><span class="rtag">${esc(r.region || 'Other')}</span>` : '<span class="muted">—</span>'}</td>
        <td><span class="lv ${r.level === 'PG' ? 'pg' : 'ug'}">${esc(r.level || 'UG')}</span> <b>${esc(r.programme || r.course)}</b>${r.branch ? `<br><span class="muted">${esc(r.branch)}</span>` : ''}</td>
        <td>${r.source === 'qr-ref' ? `<span class="src qr">📱 ${esc(r.created_by_name)} (QR)</span>` : r.created_by_id ? `<span class="src me">👤 ${esc(r.created_by_name)}</span>` : r.source === 'qr' ? '<span class="src web">📱 QR scan</span>' : '<span class="src web">🌐 Website</span>'}</td>
        <td><select class="cs ${r.counsellor_id ? '' : 'none'}"><option value="">⚠ Unassigned</option>${TEAM.filter((u) => u.active || u.id === r.counsellor_id).map((u) => `<option value="${u.id}" ${u.id === r.counsellor_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></td>
        <td><select class="st ${STATUS_CLS[r.status] || ''}">${STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
        <td><input class="note" value="${esc(r.notes)}" placeholder="Add note…" maxlength="500"></td>
        <td class="muted nowrap">${fmt(r.created_at)}</td>
        <td class="nowrap">${sb ? `<span class="smsb ${sb[1]}">${sb[0]}</span>` : '<span class="muted">—</span>'} <button class="icon resend" title="Send confirmation SMS again">↻</button></td>
        <td><button class="icon del" title="Delete">🗑</button></td></tr>`;
    }).join('');
  }

  // ---------- interactions ----------
  // Any element with data-click="key:value|key:value" applies those filters (click again to clear).
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-click]'); if (!el) return;
    const pairs = el.dataset.click.split('|').map((p) => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; });
    const [k0, v0] = pairs[0];
    if (k0 === 'day') { const same = $('#from').value === v0 && $('#to').value === v0; $('#from').value = same ? '' : v0; $('#to').value = same ? '' : v0; markPreset(''); load(); return; }
    const isSame = (k0 === 'level' ? level : $('#' + k0).value) === v0;
    if (isSame) { setFilter(k0, '', false); return; }
    pairs.slice().reverse().forEach(([k, v]) => {
      if (k === 'level') { level = v; syncLevel(); fillProgrammes(); }
      else { const sel = $('#' + k); if (sel.tagName === 'SELECT' && ![...sel.options].some((o) => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`); sel.value = v; if (k === 'programme') fillBranches(); }
    });
    toast('Filter applied: ' + pairs.map((p) => p[1]).join(' › '));
    load();
  });
  // Tooltip for anything with data-tip
  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  });

  $('#lvlSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; level = b.dataset.level; syncLevel(); fillProgrammes(); fillBranches(); load(); });
  $('#programme').addEventListener('change', () => { fillBranches(); load(); });
  ['branch', 'region', 'status', 'verified', 'pushedBy', 'counsellor'].forEach((id) => $('#' + id).addEventListener('change', load));
  ['from', 'to'].forEach((id) => $('#' + id).addEventListener('change', () => { markPreset(''); load(); }));
  let qt; $('#q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(load, 300); });
  const markPreset = (p) => $('#presets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const p = b.dataset.p, today = istDay(Date.now());
    $('#to').value = p === 'all' ? '' : today;
    $('#from').value = p === 'all' ? '' : p === 'today' ? today : istDay(Date.now() - (+p - 1) * 864e5);
    markPreset(p); load();
  });
  $('#trendRange').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; trendDays = +b.dataset.days; $('#trendRange').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderTrend(); });
  $('#sbReset').addEventListener('click', () => { level = ''; syncLevel(); $('#programme').value = ''; $('#branch').value = ''; fillProgrammes(); fillBranches(); load(); });
  $('#activeChips').addEventListener('click', (e) => {
    const k = e.target.dataset.clear; if (!k) return;
    if (k === 'level') { level = ''; syncLevel(); fillProgrammes(); } else $('#' + k).value = '';
    if (k === 'programme' || k === 'level') fillBranches();
    if (k === 'from' || k === 'to') markPreset('');
    load();
  });
  $('#reset').addEventListener('click', () => { FILTERS.forEach((k) => { $('#' + k).value = ''; }); level = ''; syncLevel(); sort = { key: 'date', dir: 'desc' }; fillProgrammes(); fillBranches(); markPreset('all'); load(); });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    document.querySelectorAll('.tab').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
    if (b.dataset.tab === 'team') loadTeam();
  });
  document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sort = sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'date' ? 'desc' : 'asc' };
    load();
  }));
  $('#sortSel').addEventListener('change', (e) => { const [key, dir] = e.target.value.split(':'); if (key) { sort = { key, dir }; load(); } });

  $('#rows').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.classList.contains('cs')) {
      const { row } = await api(`/api/admin/enquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ counsellor_id: e.target.value || null }) });
      [rows, allRows].forEach((list) => { const x = list.find((r) => r.id == id); if (x) Object.assign(x, row); });
      e.target.classList.toggle('none', !row.counsellor_id);
      toast(row.counsellor_id ? `Counsellor → ${row.counsellor_name}` : 'Counsellor removed');
      renderPerf(); renderInsights();
      return;
    }
    if (e.target.classList.contains('st')) {
      const { row } = await api(`/api/admin/enquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
      [rows, allRows].forEach((list) => { const x = list.find((r) => r.id == id); if (x) Object.assign(x, row); });
      render(); toast(`Status → ${row.status}`);
    } else if (e.target.classList.contains('note')) {
      await api(`/api/admin/enquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ notes: e.target.value }) });
      [rows, allRows].forEach((list) => { const x = list.find((r) => r.id == id); if (x) x.notes = e.target.value; });
      toast('Note saved');
    }
  });
  $('#rows').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const r = rows.find((x) => x.id == tr.dataset.id);
    if (e.target.classList.contains('resend')) {
      e.target.disabled = true;
      const j = await api(`/api/admin/enquiries/${r.id}/sms`, { method: 'POST' });
      toast(j.ok ? `SMS sent to +91 ${r.mobile}` : 'SMS could not be sent. Check the provider settings.');
      load(); return;
    }
    if (!e.target.classList.contains('del')) return;
    if (!confirm(`Delete enquiry ${r.ref_no} (${r.student_name})? This cannot be undone.`)) return;
    await api(`/api/admin/enquiries/${r.id}`, { method: 'DELETE' });
    toast('Enquiry deleted'); load();
  });
  // ---------- Team management ----------
  const initials = (n) => n.replace(/^(Dr|Mrs|Mr|Ms|Prof)\.?\s+/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const ago = (iso) => { if (!iso) return 'never logged in'; const m = (Date.now() - new Date(iso)) / 60000; return m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  function showPw(user, password, title) {
    const box = $('#pwBox'); box.hidden = false;
    box.innerHTML = `<b>${esc(title)}</b><span>Username: <code>${esc(user.username)}</code></span><span>Password: <code>${esc(password)}</code></span><small>Copy it now: it won't be shown again. Login page: /admin/login</small>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function loadTeam() {
    const j = await api('/api/admin/users');
    const us = j.users || [];
    $('#teamSum').textContent = `${us.filter((u) => u.active).length} active · ${us.reduce((a, u) => a + u.pushed, 0)} students pushed in total`;
    $('#members').innerHTML = us.length ? us.map((u) => `<div class="mem ${u.active ? '' : 'off'}" data-id="${u.id}">
      <div class="mem-av">${esc(initials(u.name))}</div>
      <div class="mem-n"><b>${esc(u.name)}</b><small>@${esc(u.username)}${u.mobile ? ' · ' + esc(u.mobile) : ''} · ${u.active ? ago(u.last_login) : 'disabled'}</small></div>
      <div class="mem-s"><b>${u.pushed}</b><small>pushed</small></div><div class="mem-s"><b>${u.pushedWeek}</b><small>this week</small></div>
      <div class="mem-s"><b>${u.assigned}</b><small>counselling</small></div><div class="mem-s"><b>${u.admitted}</b><small>admitted</small></div>
      <div class="mem-a"><button class="view">📋 Students</button><a class="qrb" href="/qr-poster.pdf?ref=${encodeURIComponent(u.username)}" target="_blank" rel="noopener">📱 QR</a><button class="reset">🔑 Reset password</button>${u.active ? '<button class="dis">⛔ Disable</button>' : '<button class="ena">✅ Enable</button>'}</div></div>`).join('')
      : '<p class="muted small">No sub-admins yet. Create the first one on the left.</p>';
  }
  $('#members').addEventListener('click', async (e) => {
    const card = e.target.closest('.mem'); if (!card) return;
    const id = card.dataset.id;
    if (e.target.classList.contains('view')) {
      FILTERS.forEach((k) => { $('#' + k).value = ''; }); level = ''; syncLevel(); fillProgrammes(); fillBranches();
      document.querySelector('.tab[data-tab=table]').click(); $('#pushedBy').value = id; load(); return;
    }
    if (e.target.classList.contains('reset')) {
      const j = await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ resetPassword: true }) });
      if (j.ok) showPw(j.user, j.password, `New password for ${j.user.name}`); return;
    }
    if (e.target.classList.contains('dis') || e.target.classList.contains('ena')) {
      const j = await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ active: e.target.classList.contains('ena') }) });
      toast(j.user.active ? `${j.user.name} enabled` : `${j.user.name} disabled. They can no longer log in.`); loadTeam(); load();
    }
  });
  $('#userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = $('#userMsg'); msg.textContent = '';
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ name: f.elements['name'].value, username: f.username.value, mobile: f.mobile.value, password: f.password.value }) });
    const j = await r.json();
    if (!r.ok) { msg.textContent = j.error || 'Could not create the account.'; return; }
    showPw(j.user, j.password, `✅ Account created for ${j.user.name}`);
    f.reset(); loadTeam(); load();
  });
  $('#userForm').username.addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); });

  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = '/admin/login'; });

  const clock = () => { $('#liveClock').textContent = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST'; };
  clock(); setInterval(clock, 30000);
  load();
  setInterval(() => { if (document.visibilityState === 'visible' && !document.activeElement.matches('input,select')) load(); }, 60000);
})();
