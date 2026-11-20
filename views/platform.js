(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // SELF = a college's own admin editing its own profile (/c/<code>/admin/profile); otherwise the platform owner
  const SELF = document.body.classList.contains('self');
  const PROFILE = (slug) => (SELF ? '/api/college/profile' : `/api/platform/colleges/${slug}`);
  const PROGS = (slug) => (SELF ? '/api/college/programmes' : `/api/platform/colleges/${slug}/programmes`);
  const PARSE = SELF ? '/api/college/parse-programmes' : '/api/platform/parse-programmes';
  const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'X-Requested-With': 'fetch', ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } })
    .then(async (r) => { if (r.status === 401) { location.href = '/admin/login'; throw new Error('auth'); } const j = await r.json().catch(() => ({})); return { ok: r.ok, ...j }; });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const num = (n) => Number(n || 0).toLocaleString('en-IN');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
  const ago = (iso) => { if (!iso) return 'no enquiries yet'; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? 'last enquiry < 1 h ago' : h < 48 ? `last enquiry ${Math.round(h)} h ago` : `last enquiry ${Math.round(h / 24)} days ago`; };
  setInterval(() => { const lc = $('#liveClock'); if (lc) lc.textContent = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = '/admin/login'; });

  let DATA = { colleges: [], origin: location.origin };
  async function load() {
    const j = await api('/api/platform/colleges');
    if (!j.ok) { $('#grid').innerHTML = `<div class="pf-err">${esc(j.error || 'Could not load colleges')}</div>`; return; }
    DATA = j; render();
  }
  function render() {
    const cs = DATA.colleges, live = cs.filter((c) => c.stats);
    const sum = (k) => live.reduce((a, c) => a + (c.stats[k] || 0), 0);
    const T = sum('total'), A = sum('admitted');
    $('#kpis').innerHTML = [
      ['🏫', cs.length, 'Colleges', `${cs.filter((c) => c.status === 'active').length} active`],
      ['📥', num(T), 'Total enquiries', `${num(sum('today'))} today · ${num(sum('week'))} this week`],
      ['📝', num(sum('apps')), 'Forms submitted', `${num(sum('paid'))} paid`],
      ['🎓', num(A), 'Admitted', `${pct(A, T)}% conversion`],
      ['💰', inr(sum('collected')), 'Fees collected', 'all colleges'],
      ['👥', num(sum('team')), 'Team accounts', 'counsellors + callers'],
    ].map(([i, n, l, s]) => `<div class="pf-kpi"><span>${i}</span><b>${n}</b><em>${l}</em><small>${esc(s)}</small></div>`).join('');
    insights(live); compare(live); grid();
  }
  function insights(live) {
    const out = [];
    for (const c of live) {
      const s = c.stats, conv = pct(s.admitted, s.total);
      if (c.status !== 'active') out.push(['⏸', `<b>${esc(c.short)}</b> is suspended — its form link is switched off.`, 'muted']);
      if (s.untouched) out.push(['⚠️', `<b>${esc(c.short)}</b>: ${s.untouched} enquiries waiting 24 h+ with no call. Ask the team to call them today.`, 'warn']);
      if (s.total >= 20 && conv < 3) out.push(['📉', `<b>${esc(c.short)}</b> converts only ${conv}% of enquiries. Review counselling and follow-ups.`, 'warn']);
      if (!s.team && c.slug) out.push(['👤', `<b>${esc(c.short)}</b> has no counsellor or caller accounts yet. Open its dashboard → Team & AI.`, 'info']);
      if (!s.total && c.slug) out.push(['📣', `<b>${esc(c.short)}</b> has no enquiries yet. Share its form link / QR poster on WhatsApp and social media.`, 'info']);
      const tr = s.trend || [], last7 = tr.slice(-7).reduce((a, x) => a + x.n, 0), prev7 = tr.slice(-14, -7).reduce((a, x) => a + x.n, 0);
      if (prev7 >= 5 && last7 > prev7 * 1.3) out.push(['🚀', `<b>${esc(c.short)}</b> enquiries up ${pct(last7 - prev7, prev7)}% this week (${last7} vs ${prev7}).`, 'good']);
      if (prev7 >= 5 && last7 < prev7 * 0.6) out.push(['🔻', `<b>${esc(c.short)}</b> enquiries down ${pct(prev7 - last7, prev7)}% this week — time for a campaign?`, 'warn']);
    }
    const best = live.filter((c) => c.stats.total >= 10).sort((a, b) => pct(b.stats.admitted, b.stats.total) - pct(a.stats.admitted, a.stats.total))[0];
    if (best) out.unshift(['🏆', `Best conversion: <b>${esc(best.short)}</b> at ${pct(best.stats.admitted, best.stats.total)}%. Share what works with the other teams.`, 'good']);
    $('#insights').innerHTML = (out.length ? out : [['✅', 'All good — nothing needs attention right now.', 'good']]).slice(0, 8).map(([i, t, k]) => `<li class="${k}"><span>${i}</span><p>${t}</p></li>`).join('');
  }
  function compare(live) {
    const by = $('#cmpBy').value, max = Math.max(1, ...live.map((c) => c.stats[by] || 0));
    $('#compare').innerHTML = live.map((c) => { const v = c.stats[by] || 0; return `<div class="pf-bar"><span title="${esc(c.name)}">${esc(c.short)}</span><div><i data-w="${(v / max) * 100}"></i></div><b>${by === 'collected' ? inr(v) : num(v)}</b><small>${pct(c.stats.admitted, c.stats.total)}% conv.</small></div>`; }).join('') || '<p class="muted">No data yet.</p>';
    $$('#compare i').forEach((i) => { i.style.width = Math.max(2, +i.dataset.w) + '%'; });
  }
  $('#cmpBy').addEventListener('change', () => compare(DATA.colleges.filter((c) => c.stats)));
  $('#q').addEventListener('input', grid);
  function spark(tr) {
    const days = []; for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5 + 330 * 6e4).toISOString().slice(0, 10));
    const m = Object.fromEntries((tr || []).map((x) => [x.d, x.n])), v = days.map((d) => m[d] || 0), mx = Math.max(1, ...v);
    return `<svg class="pf-spark" viewBox="0 0 140 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.map((n, i) => `${i * 10.7},${28 - (n / mx) * 26}`).join(' ')}"/></svg>`;
  }
  function grid() {
    const q = $('#q').value.trim().toLowerCase();
    const cs = DATA.colleges.filter((c) => !q || (c.name + ' ' + c.short + ' ' + c.city).toLowerCase().includes(q));
    $('#grid').innerHTML = cs.map((c) => {
      const s = c.stats || {}, full = (p) => DATA.origin + p;
      return `<article class="pf-card ${c.status !== 'active' ? 'off' : ''}" data-slug="${esc(c.slug)}">
        <div class="pf-c-top"><div class="pf-c-logo">${c.logo ? `<img src="/c/${esc(c.slug)}/logo" alt="">` : c.main ? '🎓' : esc(c.short.slice(0, 3))}</div>
          <div class="pf-c-name"><b>${esc(c.name)}</b><small>${esc(c.city || '')}${c.main ? ' · main portal' : ` · ${c.programmes} programmes`}</small></div>
          <span class="pf-st ${c.status === 'active' ? 'on' : ''}">${c.status === 'active' ? '● Live' : '⏸ Suspended'}</span></div>
        ${c.error ? `<div class="pf-err">⚠ ${esc(c.error)}</div>` : `<div class="pf-c-stats"><div><b>${num(s.total)}</b><small>Enquiries</small></div><div><b>${num(s.today)}</b><small>Today</small></div><div><b>${num(s.admitted)}</b><small>Admitted</small></div><div><b>${pct(s.admitted, s.total)}%</b><small>Conversion</small></div></div>
        ${spark(s.trend)}<div class="pf-c-meta">${esc(ago(s.lastAt))}${s.apiKeys ? ` · 🔌 ${s.apiKeys} API key${s.apiKeys > 1 ? 's' : ''}` : ''}${s.untouched ? ` · <span class="warn">${s.untouched} waiting for a call</span>` : ''}</div>`}
        <div class="pf-c-link"><code>${esc(full(c.links.form))}</code><button class="btn ghost xs copy" data-u="${esc(full(c.links.form))}" type="button">📋 Copy</button></div>
        <div class="pf-c-act">
          <button class="btn primary xs open" type="button">📊 Open dashboard</button>
          <a class="btn ghost xs" href="${esc(c.links.form)}" target="_blank" rel="noopener">📝 Form ↗</a>
          <a class="btn ghost xs" href="${esc(c.links.poster)}" target="_blank" rel="noopener">📱 QR poster</a>
          <a class="btn xs wa" href="https://wa.me/?text=${encodeURIComponent(`Admissions open at ${c.name}. Fill the enquiry form: ${full(c.links.form)}`)}" target="_blank" rel="noopener">💬 Share</a>
          ${c.main ? '' : `<button class="btn ghost xs edit" type="button">✏️ Edit</button><button class="btn ghost xs reset" type="button">🔑 Reset admin password</button><button class="btn ghost xs toggle" type="button">${c.status === 'active' ? '⏸ Suspend' : '▶ Activate'}</button>`}
        </div></article>`;
    }).join('') || '<p class="muted">No college matches.</p>';
  }
  $('#grid').addEventListener('click', async (e) => {
    const card = e.target.closest('.pf-card'); if (!card) return; const slug = card.dataset.slug, c = DATA.colleges.find((x) => x.slug === slug);
    if (e.target.closest('.copy')) { navigator.clipboard.writeText(e.target.closest('.copy').dataset.u).then(() => toast('🔗 Link copied')); return; }
    if (e.target.closest('.open')) {
      if (c.main) { location.href = '/admin'; return; }
      const j = await api(`/api/platform/colleges/${slug}/open`, { method: 'POST' }); if (j.ok) location.href = j.url; else toast(j.error || 'Could not open'); return;
    }
    if (e.target.closest('.toggle')) {
      const to = c.status === 'active' ? 'suspended' : 'active';
      if (to === 'suspended' && !confirm(`Suspend ${c.name}? Its form and dashboard links stop working until you activate it again. No data is deleted.`)) return;
      const j = await api(`/api/platform/colleges/${slug}`, { method: 'PUT', body: JSON.stringify({ status: to }) }); toast(j.ok ? (to === 'active' ? '▶ Activated' : '⏸ Suspended') : j.error); load(); return;
    }
    if (e.target.closest('.reset')) {
      if (!confirm(`Create a new password for the ${c.short} admin (${c.adminUser})? The old password stops working.`)) return;
      const j = await api(`/api/platform/colleges/${slug}`, { method: 'PUT', body: JSON.stringify({ resetPassword: true }) });
      if (j.ok) prompt(`New password for ${c.adminUser} — copy it now, it is shown only once:`, j.password); else toast(j.error); return;
    }
    if (e.target.closest('.edit')) openWizard(slug);
  });

  // ---------------- wizard ----------------
  let step = 1, EDIT = null, LOGO = '', ROWS = [];
  const wiz = $('#wiz');
  $$('[data-close]', wiz).forEach((b) => b.addEventListener('click', () => { wiz.hidden = true; }));
  $('#linkPrefix').textContent = location.host + '/c/';
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  let slugTouched = false;
  $('#fSlug').addEventListener('input', () => { slugTouched = true; });
  ['#fShort', '#fName'].forEach((s) => $(s).addEventListener('input', () => { if (!slugTouched && !EDIT) $('#fSlug').value = slugify($('#fShort').value || $('#fName').value); }));
  $('#fShort').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  function contactRow(c = {}) {
    const d = document.createElement('div'); d.className = 'pf-crow';
    d.innerHTML = `<input class="cn" maxlength="60" placeholder="Name" value="${esc(c.name || '')}"><input class="cp" inputmode="numeric" maxlength="10" placeholder="Mobile" value="${esc(c.phone || '')}"><button class="icon" type="button" aria-label="Remove">✕</button>`;
    $('button', d).addEventListener('click', () => d.remove()); $('#contacts').appendChild(d);
  }
  $('#addContact').addEventListener('click', () => { if ($$('#contacts .pf-crow').length < 4) contactRow(); });

  function setLogo(data) { LOGO = data || ''; $('#logoImg').hidden = !LOGO; $('#logoPh').hidden = !!LOGO; if (LOGO) $('#logoImg').src = LOGO; }
  $('#logoFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => { const k = Math.min(1, 320 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); setLogo(cv.toDataURL('image/png')); URL.revokeObjectURL(url); };
    img.onerror = () => toast('Could not read that image'); img.src = url;
  });

  // programmes
  const LV = ['UG', 'PG'];
  function drawRows() {
    $('#rows').innerHTML = ROWS.map((r, i) => `<tr data-i="${i}"><td><select data-k="level">${LV.map((l) => `<option${r.level === l ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input data-k="school" value="${esc(r.school)}"></td><td><input data-k="programme" value="${esc(r.programme)}"></td><td><input data-k="branch" value="${esc(r.branch)}" placeholder="—"></td>
      <td><input data-k="fee" inputmode="numeric" value="${esc(r.fee || '')}"></td><td><button class="icon del" type="button" aria-label="Delete row">🗑</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted pf-empty">No programmes yet — upload Excel / PDF or type them above.</td></tr>';
    const p = new Set(ROWS.map((r) => r.level + r.programme)).size;
    $('#progCount').textContent = `${ROWS.length} rows · ${p} programmes · ${ROWS.filter((r) => !+r.fee).length} without fee`;
  }
  $('#rows').addEventListener('input', (e) => { const tr = e.target.closest('tr'); if (!tr || !e.target.dataset.k) return; ROWS[+tr.dataset.i][e.target.dataset.k] = e.target.dataset.k === 'fee' ? e.target.value.replace(/\D/g, '') : e.target.value; });
  $('#rows').addEventListener('change', (e) => { if (e.target.dataset.k === 'fee' || e.target.tagName === 'SELECT') drawRows(); });
  $('#rows').addEventListener('click', (e) => { if (e.target.closest('.del')) { ROWS.splice(+e.target.closest('tr').dataset.i, 1); drawRows(); } });
  $('#addRow').addEventListener('click', () => { const last = ROWS[ROWS.length - 1] || {}; ROWS.push({ level: last.level || 'UG', school: last.school || '', programme: '', branch: '', fee: '' }); drawRows(); $('#rows tr:last-child [data-k="programme"]').focus(); });
  $('#clearRows').addEventListener('click', () => { if (!ROWS.length || confirm('Remove all programme rows from this list?')) { ROWS = []; drawRows(); } });
  async function parse(kind, body, type) {
    toast('⏳ Reading programmes…');
    const j = await api(PARSE + '?kind=' + kind, { method: 'POST', body, headers: { 'Content-Type': type } });
    if (!j.ok) return toast(j.error || 'Could not read');
    if (!j.rows.length) return toast('No programmes found — please check the file or type them.');
    const key = (r) => [r.level, r.programme, r.branch].join('|').toLowerCase(), have = new Set(ROWS.map(key));
    const add = j.rows.filter((r) => !have.has(key(r))); ROWS.push(...add); drawRows();
    toast(`✅ ${add.length} programme rows added — please check names and fees`);
  }
  $('#xlsFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) parse('excel', f, 'application/octet-stream'); e.target.value = ''; });
  $('#pdfFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) parse('pdf', f, 'application/octet-stream'); e.target.value = ''; });
  $('#typeBtn').addEventListener('click', () => { $('#typeBox').hidden = !$('#typeBox').hidden; if (!$('#typeBox').hidden) $('#typeText').focus(); });
  $('#parseText').addEventListener('click', () => { const t = $('#typeText').value.trim(); if (t) parse('text', t, 'text/plain'); });

  function showStep(n) {
    step = n; $$('.pf-step', wiz).forEach((s) => { s.hidden = +s.dataset.step !== n; });
    $$('#steps li').forEach((li, i) => { li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); });
    $('#back').hidden = n === 1 || n === 4; $('#next').textContent = n === 4 ? 'Close' : n === 3 || (EDIT && n === 2) ? (EDIT ? '💾 Save changes' : '🚀 Create college') : 'Next →';
    $('#wizErr').textContent = '';
    $('#steps li:nth-child(3)').hidden = !!EDIT; $('#steps li:nth-child(4)').hidden = !!EDIT;
  }
  const val = (s) => $(s).value.trim();
  function check(n) {
    if (n === 1) { if (val('#fName').length < 3) return 'Enter the college name.'; if (!val('#fShort')) return 'Enter a short code (e.g. SNBP).'; if (!EDIT && !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(val('#fSlug'))) return 'The link must be 3–30 small letters / numbers.'; if (val('#fPhone') && !/^[6-9]\d{9}$/.test(val('#fPhone'))) return 'Helpline mobile must be 10 digits.'; }
    if (n === 2) { if (!ROWS.filter((r) => r.programme.trim()).length) return 'Add at least one programme.'; }
    if (n === 3) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('#aEmail'))) return 'Enter the admin email.'; if (!/^[a-z0-9._-]{3,30}$/.test(val('#aUser'))) return 'Username: 3–30 small letters / numbers.'; if (val('#aPass') && val('#aPass').length < 8) return 'Password must be at least 8 characters.'; }
    return '';
  }
  const payload = () => ({ name: val('#fName'), short: val('#fShort'), slug: val('#fSlug'), city: val('#fCity'), address: val('#fAddress'), email: val('#fEmail'), phone: val('#fPhone'), website: val('#fWebsite'),
    academicYear: val('#fAY'), feeYear: val('#fFeeYear'), color: $('#fColor').value, tagline: val('#fTagline'), logo: LOGO,
    contacts: $$('#contacts .pf-crow').map((d) => ({ name: $('.cn', d).value.trim(), phone: $('.cp', d).value.replace(/\D/g, '') })).filter((c) => c.name),
    programmes: ROWS.filter((r) => r.programme.trim()), adminName: val('#aName'), adminEmail: val('#aEmail'), adminMobile: val('#aMobile'), adminUser: val('#aUser'), adminPassword: $('#aPass').value });
  $('#back').addEventListener('click', () => showStep(step - 1));
  $('#next').addEventListener('click', async () => {
    if (step === 4) { wiz.hidden = true; return; }
    if (SELF && step === 1) { const err0 = check(1); if (err0) { $('#wizErr').textContent = err0; return; } }
    const err = check(step); if (err) { $('#wizErr').textContent = err; return; }
    const last = EDIT ? 2 : 3;
    if (step < last) return showStep(step + 1);
    $('#next').disabled = true; $('#next').textContent = EDIT ? 'Saving…' : 'Creating the college and its database…';
    const j = EDIT ? await api(PROFILE(EDIT), { method: 'PUT', body: JSON.stringify(payload()) }) : await api('/api/platform/colleges', { method: 'POST', body: JSON.stringify(payload()) });
    $('#next').disabled = false;
    if (!j.ok) { $('#wizErr').textContent = j.error || 'Something went wrong'; showStep(step); $('#wizErr').textContent = j.error || 'Something went wrong'; return; }
    if (EDIT) { toast('💾 Saved — students see the new details at once'); if (SELF) { setTimeout(() => { location.href = (window.__b || '') + '/admin'; }, 1200); return; } wiz.hidden = true; load(); return; }
    $('#done').innerHTML = `<div class="pf-done"><div class="pf-big">🎉</div><h3>${esc(val('#fName'))} is live!</h3><p class="muted">It has its own database, its own links and its own admin login.</p>
      <div class="pf-links">${[['📝 Student enquiry form', j.links.form], ['🔐 Admin login', j.links.admin], ['📱 QR poster (print)', j.links.poster]].map(([l, u]) => `<div><b>${l}</b><code>${esc(u)}</code><button class="btn ghost xs copy2" data-u="${esc(u)}" type="button">📋</button></div>`).join('')}</div>
      <div class="pf-cred"><b>Admin username:</b> <code>${esc(j.adminUser)}</code><br><b>Password:</b> <code>${esc(j.password)}</code> <button class="btn ghost xs copy2" data-u="${esc(j.password)}" type="button">📋</button><br><small>⚠ Copy the password now — it is shown only once. The admin can be given a new one anytime with “Reset admin password”.</small></div></div>`;
    $$('.copy2').forEach((b) => b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.u).then(() => toast('📋 Copied'))));
    showStep(4); load();
  });

  async function openWizard(slug) {
    EDIT = slug || null; slugTouched = false; $('#contacts').innerHTML = ''; ROWS = []; setLogo('');
    $$('.pf-step input:not([type=file]):not([type=color]), .pf-step textarea', wiz).forEach((i) => { i.value = ''; });
    $('#fAY').value = '2027–28'; $('#aUser').value = 'admin'; $('#fColor').value = '#0B1F4B'; $('#typeBox').hidden = true;
    $('#fSlug').disabled = !!EDIT; $('#wizTitle').textContent = EDIT ? '✏️ Edit college' : '➕ Create a college';
    if (EDIT) {
      const [a, b] = await Promise.all([api(PROFILE(slug)), api(PROGS(slug))]);
      if (!a.ok) return toast(a.error || 'Could not load');
      const c = a.college;
      Object.entries({ '#fName': c.name, '#fShort': c.short, '#fSlug': c.slug, '#fCity': c.city, '#fAddress': c.address, '#fEmail': c.email, '#fPhone': c.phone, '#fWebsite': c.website, '#fAY': c.academicYear, '#fFeeYear': c.feeYear, '#fTagline': c.tagline, '#aName': c.adminName, '#aEmail': c.adminEmail, '#aMobile': c.adminMobile })
        .forEach(([s, v]) => { $(s).value = v || ''; });
      $('#fColor').value = c.color || '#0B1F4B'; setLogo(c.logo); (c.contacts || []).forEach(contactRow); ROWS = b.rows || [];
    } else contactRow();
    drawRows(); showStep(1); wiz.hidden = false; $('#fName').focus();
  }
  if (SELF) {
    // college admin: only the edit wizard, opened straight away; closing returns to the dashboard
    document.body.classList.add('self');
    $('.tb-brand b').textContent = 'College profile'; $('.tb-brand small').textContent = 'Name, logo, contacts, programmes & fees — what students see';
    $('.tb-actions').innerHTML = '<a class="btn ghost" href="/admin">← Back to dashboard</a>';
    $('.pf-main').hidden = true; $('.pf-imp[href]').setAttribute('href', '/api/college/template.xlsx');
    $$('[data-close]', wiz).forEach((b) => b.addEventListener('click', () => { location.href = (window.__b || '') + '/admin'; }));
    openWizard('self'); $('#wizTitle').textContent = '🏫 College profile';
    return;
  }
  $('#newCollege').addEventListener('click', () => openWizard());
  load();
})();
