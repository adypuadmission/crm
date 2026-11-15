(() => {
  const $ = (s) => document.querySelector(s);
  const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'X-Requested-With': 'fetch', ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } })
    .then(async (r) => { if (r.status === 401) { location.href = '/admin/login'; throw new Error('auth'); } const j = await r.json(); return { ok: r.ok, status: r.status, ...j }; });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const STATUS_CLS = { 'New': 's-new', 'Contacted': 's-contacted', 'Interested': 's-interested', 'Counselling Done': 's-counsel', 'Applied': 's-applied', 'Admitted': 's-admitted', 'Not Interested': 's-no' };
  let ME = null, STATUSES = [], LEVELS = { UG: [], PG: [] }, rows = [];
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

  // ---------- add form: Level → Programme → Branch ----------
  const F = $('#addForm');
  function fillProgrammes() {
    const list = LEVELS[F.level.value] || [];
    const cur = F.programme.value;
    F.programme.innerHTML = '<option value="">Choose…</option>' + list.map((p) => `<option ${p.name === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    fillBranches();
  }
  function fillBranches() {
    const p = (LEVELS[F.level.value] || []).find((x) => x.name === F.programme.value);
    const cur = F.branch.value;
    F.branch.disabled = !(p && p.branches);
    F.branch.innerHTML = p && p.branches ? '<option value="">Choose branch…</option>' + p.branches.map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('') : '<option value="">— not needed —</option>';
  }
  F.level.addEventListener('change', fillProgrammes);
  F.programme.addEventListener('change', fillBranches);
  F.mobile.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

  F.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#addMsg'); msg.className = 'aerr'; msg.textContent = '';
    const body = { student_name: F.student_name.value, mobile: F.mobile.value, email: F.email.value, city: F.city.value, level: F.level.value,
      programme: F.programme.value, branch: F.branch.disabled ? '' : F.branch.value, status: F.status.value, notes: F.notes.value, sendSms: F.sendSms.checked };
    const btn = $('#addBtn'); btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const j = await api('/api/team/enquiries', { method: 'POST', body: JSON.stringify(body) });
      if (!j.ok) { msg.textContent = j.fields ? Object.values(j.fields).join(' ') : j.error; return; }
      msg.className = 'okmsg'; msg.textContent = `✓ Added ${j.row.student_name} as ${j.row.ref_no}${body.sendSms ? ' · SMS sent' : ''}`;
      toast(`Added ${j.row.ref_no}`);
      ['student_name', 'mobile', 'email', 'city', 'notes'].forEach((k) => { F[k].value = ''; });
      F.student_name.focus();
      load();
    } finally { btn.disabled = false; btn.textContent = 'Add student'; }
  });

  // ---------- bulk upload ----------
  let file = null;
  const drop = $('#drop');
  function pick(f) {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) { toast('Please choose an .xlsx or .csv file'); return; }
    file = f; $('#dropName').textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`; $('#uploadBtn').disabled = false; drop.classList.add('has');
  }
  $('#file').addEventListener('change', (e) => pick(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
  $('#uploadBtn').addEventListener('click', async () => {
    if (!file) return;
    const btn = $('#uploadBtn'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const j = await api(`/api/team/import?name=${encodeURIComponent(file.name)}&sms=${$('#bulkSms').checked ? 1 : 0}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const box = $('#result'); box.hidden = false;
      if (!j.ok) { box.innerHTML = `<p class="aerr">${esc(j.error)}</p>`; return; }
      box.innerHTML = `<div class="res-tiles"><span class="rt ok"><b>${j.added.length}</b>added</span><span class="rt dup"><b>${j.duplicates.length}</b>already in database</span><span class="rt bad"><b>${j.errors.length}</b>need fixing</span></div>`
        + (j.errors.length ? `<details open><summary>Rows to fix</summary><ul>${j.errors.slice(0, 50).map((x) => `<li>Row ${x.line}${x.name ? ` (${esc(x.name)})` : ''}: ${esc(x.problems.join(' '))}</li>`).join('')}</ul></details>` : '')
        + (j.duplicates.length ? `<details><summary>Skipped duplicates</summary><ul>${j.duplicates.slice(0, 50).map((x) => `<li>Row ${x.line} ${esc(x.name)} → already ${esc(x.ref)}</li>`).join('')}</ul></details>` : '');
      toast(`${j.added.length} students added`);
      file = null; $('#file').value = ''; $('#dropName').textContent = ''; drop.classList.remove('has');
      load();
    } finally { btn.textContent = 'Upload students'; btn.disabled = !file; }
  });

  // ---------- my students ----------
  async function load() {
    const p = new URLSearchParams();
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if ($('#fStatus').value) p.set('status', $('#fStatus').value);
    if ($('#from').value) p.set('from', $('#from').value);
    if ($('#to').value) p.set('to', $('#to').value);
    const [mine, all] = await Promise.all([api('/api/team/enquiries?' + p), api('/api/team/enquiries')]);
    rows = mine.rows; renderKpis(all.rows); renderTable();
  }
  function renderKpis(all) {
    const today = istDay(Date.now()), wk = Date.now() - 7 * 864e5;
    const k = [
      ['My students', all.length, '👩‍🎓', ''], ['Added today', all.filter((r) => r.created_by_id === ME.id && istDay(r.created_at) === today).length, '⚡', ''],
      ['Added this week', all.filter((r) => r.created_by_id === ME.id && new Date(r.created_at) > wk).length, '📅', ''],
      ['Waiting for a call', all.filter((r) => r.status === 'New').length, '📞', 'warn'], ['Admitted', all.filter((r) => r.status === 'Admitted').length, '🎉', 'good'],
    ];
    $('#kpis').innerHTML = k.map(([t, v, i, c]) => `<div class="kpi tk ${c}"><span class="tk-i">${i}</span><div><div class="kt">${t}</div><div class="kv"><b>${v}</b></div></div></div>`).join('');
  }
  function renderTable() {
    $('#hint').textContent = `${rows.length} shown`;
    if (!rows.length) { $('#rows').innerHTML = '<tr><td colspan="10" class="empty">No students yet. Add one above or upload a file.</td></tr>'; return; }
    $('#rows').innerHTML = rows.map((r, i) => `<tr data-id="${r.id}">
      <td class="muted">${i + 1}</td><td><code>${esc(r.ref_no)}</code></td><td><b>${esc(r.student_name)}</b></td>
      <td class="nowrap"><a href="tel:+91${esc(r.mobile)}">+91 ${esc(r.mobile)}</a>${r.email ? `<br><span class="muted">${esc(r.email)}</span>` : ''}</td>
      <td>${esc(r.city || '—')}</td>
      <td><span class="lv ${r.level === 'PG' ? 'pg' : 'ug'}">${esc(r.level)}</span> <b>${esc(r.programme)}</b>${r.branch ? `<br><span class="muted">${esc(r.branch)}</span>` : ''}</td>
      <td><select class="st ${STATUS_CLS[r.status] || ''}">${STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
      <td><input class="note" value="${esc(r.notes)}" placeholder="Add note…" maxlength="500"></td>
      <td>${r.created_by_id === ME.id ? '<span class="src me">👤 Added by you</span>' : `<span class="src as">📌 Assigned${r.created_by_name ? ' · ' + esc(r.created_by_name) : ' · website'}</span>`}</td>
      <td class="muted nowrap">${fmt(r.created_at)}</td></tr>`).join('');
  }
  $('#rows').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const patch = e.target.classList.contains('st') ? { status: e.target.value } : e.target.classList.contains('note') ? { notes: e.target.value } : null;
    if (!patch) return;
    const j = await api(`/api/team/enquiries/${tr.dataset.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (j.ok) { Object.assign(rows.find((r) => r.id == tr.dataset.id), j.row); if (patch.status) { e.target.className = 'st ' + (STATUS_CLS[j.row.status] || ''); load(); } toast(patch.status ? `Status → ${j.row.status}` : 'Note saved'); }
  });
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  ['fStatus', 'from', 'to'].forEach((id) => $('#' + id).addEventListener('change', load));
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = '/admin/login'; });

  (async () => {
    const j = await api('/api/team/me');
    ME = j.user; STATUSES = j.statuses; LEVELS = j.levels;
    $('#meChip').textContent = `👤 ${ME.name} · @${ME.username}`;
    const h = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
    $('#hello').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${ME.name.split(' ').filter((w) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))[0] || ME.name} 👋`;
    $('#cityList').innerHTML = (j.cities || []).map((c) => `<option value="${esc(c)}">`).join('');
    F.status.innerHTML = STATUSES.map((s) => `<option>${esc(s)}</option>`).join('');
    $('#fStatus').insertAdjacentHTML('beforeend', STATUSES.map((s) => `<option>${esc(s)}</option>`).join(''));
    fillProgrammes();
    load();
  })();
})();
