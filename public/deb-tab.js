// 🎓 DEB tab — Online Learning colleges only (the server removes this script elsewhere)
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  if (!$('#tab-deb')) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
  const api = async (u, o = {}) => { const r = await fetch(u, { ...o, headers: { ...H, ...(o.headers || {}) } }); const j = await r.json().catch(() => ({})); return { ok: r.ok, ...j }; };
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._d); t._d = setTimeout(() => t.classList.remove('show'), 3200); };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  let ST = {}, SET = {}, ROWS = [], PROGS = [], SEL = new Set();
  const CHIP = { Ready: 'ok', Pushed: 'done', Failed: 'bad', Incomplete: 'warn' };

  async function loadAll() {
    const [s, c, l] = await Promise.all([api('/api/deb/status'), api('/api/deb/settings'), api('/api/deb/learners')]);
    if (!s.ok) return; ST = s; SET = c; ROWS = l.rows || []; PROGS = l.programmes || [];
    header(); conn(); table();
  }
  function header() {
    const n = (k) => ST.counts[k] || 0, tot = ROWS.length;
    $('#debCount').textContent = n('Ready'); $('#debCount').hidden = !n('Ready');
    $('#debKpis').innerHTML = [['👩‍🎓', tot, 'Learners'], ['✅', n('Ready'), 'Ready to push'], ['🚀', n('Pushed'), 'Sent to DEB'], ['⚠️', n('Incomplete'), 'Need details'], ['❌', n('Failed'), 'DEB rejected'], ['🔎', ROWS.filter((r) => r.verified && r.verified.ok).length, 'DEB-IDs verified']]
      .map(([i, v, l]) => `<div><span>${i}</span><b>${v}</b><small>${l}</small></div>`).join('');
    const step = !ST.configured ? 1 : !tot ? 2 : ROWS.some((r) => r.deb_id && !(r.verified && r.verified.ok)) ? 3 : 4;
    $$('#debSteps li').forEach((li) => { const s = +li.dataset.s; li.classList.toggle('done', s < step); li.classList.toggle('on', s === step); });
    const dl = ST.deadline; if (dl) { const d = Math.ceil((new Date(dl + 'T23:59:59+05:30') - Date.now()) / 864e5); $('#debDeadline').innerHTML = d >= 0 ? `<b>${d}</b> day${d === 1 ? '' : 's'} left<small>DEB last date ${new Date(dl).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</small>` : `<b>⏰</b><small>DEB last date has passed</small>`; $('#debDeadline').classList.toggle('urgent', d >= 0 && d <= 7); }
    else $('#debDeadline').innerHTML = '<small>Set the DEB last date in “DEB connection” to get a countdown</small>';
    $('#debListSum').textContent = `${tot} learners · ${n('Pushed')} sent · ${n('Ready')} ready · ${n('Incomplete')} need details`;
  }
  function conn() {
    $('#debConnSum').textContent = ST.configured ? `Connected · HEI code ${SET.heiCode} · saved ${when(SET.savedAt)} by ${SET.savedBy || ''}` : 'Not connected yet — open and fill the details from your DEB portal login';
    $('#debConnToggle').textContent = $('#debConn').hidden ? (ST.configured ? 'Edit' : 'Open') : 'Close';
    if (!$('#debConn').dataset.filled) {
      $('#dHei').value = SET.heiCode || ''; $('#dDeadline').value = SET.deadline || ''; $('#dKeyQ').checked = SET.keyInQuery !== false;
      $('#dSId').value = SET.student ? SET.student.clientId : ''; $('#dAId').value = SET.admission ? SET.admission.clientId : '';
      $('#dSKey').placeholder = SET.student ? `saved (${SET.student.apiKey}) — leave blank to keep` : 'APIKey from DEB'; $('#dAKey').placeholder = SET.admission ? `saved (${SET.admission.apiKey}) — leave blank to keep` : 'APIKey from DEB';
      $('#dMap').innerHTML = SET.list.map((p) => { const m = SET.programmes[p.key] || {}; return `<tr data-k="${esc(p.key)}"><td>${esc(p.label)}</td><td><input class="mc" maxlength="30" value="${esc(m.code || '')}" placeholder="DEB map code"></td>
        <td><select class="mm">${SET.lists.mode.map((x) => `<option${(m.mode || SET.lists.mode[0]) === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></td></tr>`; }).join('');
      $('#debConn').dataset.filled = '1';
    }
    if (!ST.configured && $('#debConn').hidden && !conn.opened) { conn.opened = 1; $('#debConn').hidden = false; $('#debConnToggle').textContent = 'Close'; }
  }
  $('#debConnToggle').addEventListener('click', () => { $('#debConn').hidden = !$('#debConn').hidden; $('#debConnToggle').textContent = $('#debConn').hidden ? 'Edit' : 'Close'; });
  $('#debConn').addEventListener('submit', async (e) => {
    e.preventDefault();
    const programmes = {}; $$('#dMap tr').forEach((tr) => { programmes[tr.dataset.k] = { code: $('.mc', tr).value.trim(), mode: $('.mm', tr).value }; });
    const j = await api('/api/deb/settings', { method: 'PUT', body: JSON.stringify({ heiCode: $('#dHei').value.trim(), deadline: $('#dDeadline').value, keyInQuery: $('#dKeyQ').checked, studentClientId: $('#dSId').value.trim(), studentApiKey: $('#dSKey').value,
      admissionClientId: $('#dAId').value.trim(), admissionApiKey: $('#dAKey').value, programmes, password: $('#dPass').value }) });
    $('#dPass').value = ''; $('#dSKey').value = ''; $('#dAKey').value = '';
    if (!j.ok) return toast(j.error || 'Could not save');
    toast('💾 DEB connection saved'); delete $('#debConn').dataset.filled; $('#debConn').hidden = true; loadAll();
  });

  // ---------- learners table ----------
  const progLabel = (k) => (PROGS.find((p) => p.key === k) || {}).label || '—';
  function table() {
    const f = $('#debFilter').value, q = $('#debQ').value.trim().toLowerCase();
    const rows = ROWS.filter((r) => (!f || r.status === f) && (!q || [r.name, r.deb_id, r.enrollment_no, r.email].join(' ').toLowerCase().includes(q)));
    $('#debRows').innerHTML = rows.map((r) => {
      const v = r.verified;
      const vtag = v ? (v.ok ? `<span class="deb-v ok" title="${esc(v.message)}">✔ found on DEB${v.debName ? ': ' + esc(v.debName) : ''}${v.nameMatch === false ? ' <b class="warn">⚠ name differs</b>' : ''}</span>` : `<span class="deb-v bad" title="${esc(v.message)}">✖ ${esc(v.message)}</span>`) : (r.deb_id ? '<span class="deb-v">not verified yet</span>' : '');
      const note = r.status === 'Pushed' ? `🚀 Sent ${when(r.pushed_at)} by ${esc(r.pushed_by || '')}<br><small>${esc(r.last_msg || '')}</small>` : r.status === 'Failed' ? `<b class="bad">DEB: ${esc(r.last_msg || '')}</b>` : r.issues.length ? `<ul class="deb-iss">${r.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '✅ All details complete';
      return `<tr data-id="${r.id}"><td><input type="checkbox" class="dsel" ${SEL.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.name)}"></td>
        <td><b>${esc(r.name)}</b><br><small>${esc(r.gender || '')} ${r.dob ? '· ' + esc(r.dob) : ''}${r.source === 'admission' ? ' · from admission' : r.source === 'import' ? ' · imported' : ''}</small></td>
        <td>${esc(progLabel(r.programme))}<br><small>${r.deb_code ? '<code>' + esc(r.deb_code) + '</code> · ' + esc(r.mode) : '<span class="warn">no DEB code</span>'}</small></td>
        <td><code>${esc(r.deb_id || '—')}</code><br>${vtag}</td>
        <td>${esc(r.enrollment_no || '—')}<br><small>${esc(r.admission_date || '')}</small></td>
        <td><span class="deb-chip ${CHIP[r.status] || ''}">${esc(r.status)}</span></td>
        <td class="deb-note">${note}</td>
        <td class="deb-act"><button class="btn ghost xs ed" type="button">✏️ Edit</button></td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted deb-empty">${ROWS.length ? 'Nothing matches the filter.' : 'No learners yet — 📥 Import your DEB Excel, 🎓 bring admitted students, or ➕ add one.'}</td></tr>`;
    $('#debSelN').textContent = SEL.size;
  }
  $('#debFilter').addEventListener('change', table); $('#debQ').addEventListener('input', table);
  $('#debAll').addEventListener('change', (e) => { $$('#debRows tr[data-id]').forEach((tr) => { const id = +tr.dataset.id; if (e.target.checked) SEL.add(id); else SEL.delete(id); }); table(); });
  $('#debRows').addEventListener('change', (e) => { if (!e.target.classList.contains('dsel')) return; const id = +e.target.closest('tr').dataset.id; if (e.target.checked) SEL.add(id); else SEL.delete(id); $('#debSelN').textContent = SEL.size; });
  $('#debRows').addEventListener('click', (e) => { if (e.target.closest('.ed')) edit(ROWS.find((r) => r.id === +e.target.closest('tr').dataset.id)); });

  // ---------- modal helpers ----------
  const modal = (title, html) => { $('#debMTitle').textContent = title; $('#debMBody').innerHTML = html; $('#debModal').hidden = false; };
  const close = () => { $('#debModal').hidden = true; };
  $('#debModal').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.id === 'debModal') close(); });
  const opt = (list, v) => `<option value="">— choose —</option>${list.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}${v && !list.includes(v) ? `<option selected>${esc(v)}</option>` : ''}`;
  function edit(r) {
    r = r || { nationality: 'Indian', country: 'India', gov_id_type: 'Aadhaar' }; const L = ST.lists;
    modal(r.id ? `✏️ ${r.name}` : '➕ Add learner', `<form id="debF" class="deb-form" autocomplete="off">
      <label>Full name *<input name="name" value="${esc(r.name || '')}" required></label>
      <label>Programme *<select name="programme"><option value="">— choose —</option>${PROGS.map((p) => `<option value="${esc(p.key)}"${p.key === r.programme ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      <label>DEB-ID * <small>(12 digits)</small><input name="deb_id" inputmode="numeric" maxlength="14" value="${esc(r.deb_id || '')}"></label>
      <label>ABC ID <small>(12 digits)</small><input name="abc_id" inputmode="numeric" maxlength="14" value="${esc(r.abc_id || '')}"></label>
      <label>Enrolment number *<input name="enrollment_no" maxlength="40" value="${esc(r.enrollment_no || '')}"></label>
      <label>Admission date *<input name="admission_date" placeholder="DD-MM-YYYY" maxlength="10" value="${esc(r.admission_date || '')}"></label>
      <label>Gender<select name="gender">${opt(['MALE', 'FEMALE', 'OTHER'], r.gender)}</select></label>
      <label>Date of birth<input name="dob" placeholder="DD-MM-YYYY" maxlength="10" value="${esc(r.dob || '')}"></label>
      <label>Category *<select name="category">${opt(L.category, r.category)}</select></label>
      <label>Locality *<select name="locality">${opt(L.locality, r.locality)}</select></label>
      <label>Nationality *<input name="nationality" value="${esc(r.nationality || '')}"></label>
      <label>Country of residence *<input name="country" value="${esc(r.country || '')}"></label>
      <label>Government ID type *<select name="gov_id_type">${opt(L.govId, r.gov_id_type)}</select></label>
      <label>Government ID number *<input name="gov_id_no" maxlength="30" autocomplete="off" placeholder="${r.has_gov_id ? esc(r.gov_id_no) + ' — leave blank to keep' : ''}"></label>
      <label>Email<input name="email" type="email" value="${esc(r.email || '')}"></label>
      <label>Admission details <small>(optional, sent as “NA” if empty)</small><input name="admission_details" maxlength="100" value="${esc(r.admission_details || '')}"></label>
      <div class="deb-fbtns">${r.id && r.status !== 'Pushed' ? '<button class="btn ghost del" type="button">🗑 Remove</button>' : '<span></span>'}<span>${r.id && r.deb_id ? '<button class="btn ghost vf" type="button">🔎 Verify DEB-ID</button> ' : ''}<button class="btn primary" type="submit">💾 Save</button></span></div>
      ${r.status === 'Pushed' ? '<p class="cc-hint">Already sent to DEB. Changes here are saved in this system; push again only if DEB asks you to.</p>' : ''}</form>`);
    $('#debF').addEventListener('submit', async (e) => {
      e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
      const j = await api(r.id ? `/api/deb/learners/${r.id}` : '/api/deb/learners', { method: r.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (!j.ok) return toast(j.error || 'Could not save'); toast('💾 Saved'); close(); loadAll();
    });
    const del = $('#debF .del'); if (del) del.addEventListener('click', async () => { if (!confirm(`Remove ${r.name} from the DEB list? (Nothing is sent to DEB.)`)) return; const j = await api(`/api/deb/learners/${r.id}`, { method: 'DELETE' }); toast(j.ok ? 'Removed' : j.error); close(); loadAll(); });
    const vf = $('#debF .vf'); if (vf) vf.addEventListener('click', () => { close(); verify([r.id]); });
  }
  $('#debAdd').addEventListener('click', () => edit());

  // ---------- import / admissions ----------
  let FILE = null;
  $('#debFile').addEventListener('change', async (e) => {
    FILE = e.target.files[0]; e.target.value = ''; if (!FILE) return;
    toast('⏳ Reading the Excel…');
    const r = await fetch('/api/deb/import', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/octet-stream' }, body: FILE }); const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || 'Could not read the file');
    const fixes = j.preview.reduce((a, x) => a + x.changes.length, 0);
    modal(`📥 Import preview — ${j.preview.length} learners`, `<p class="cc-hint">Nothing is saved or sent yet. Check the list, then click <b>Save to DEB list</b>. ${fixes ? `<b>${fixes}</b> automatic fixes are shown in orange.` : ''}</p>
      <div class="table-wrap deb-prev"><table><thead><tr><th>Learner</th><th>Programme</th><th>DEB-ID</th><th>Fixed automatically</th><th>Still missing</th></tr></thead><tbody>
      ${j.preview.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.exists ? ' <small class="muted">(already in list — empty fields will be filled)</small>' : ''}<br><small>${esc(x.sheets.join(', '))}</small></td><td>${esc(x.programme)}</td><td><code>${esc(x.deb_id || '—')}</code></td>
        <td class="fix">${x.changes.map(esc).join('<br>') || '—'}</td><td class="warn">${x.issues.length ? x.issues.map(esc).join('<br>') : '<span class="ok">ready ✅</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="deb-fbtns"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="debImpGo" type="button">💾 Save to DEB list</button></div>`);
    $('#debImpGo').addEventListener('click', async () => {
      const r2 = await fetch('/api/deb/import?commit=1', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/octet-stream' }, body: FILE }); const k = await r2.json().catch(() => ({}));
      toast(r2.ok ? `✅ ${k.added} added, ${k.updated} updated` : k.error || 'Import failed'); close(); loadAll();
    });
  });
  $('#debFromAdm').addEventListener('click', async () => { const j = await api('/api/deb/from-admissions', { method: 'POST' }); toast(j.ok ? (j.added ? `🎓 ${j.added} admitted students added — fill DEB-ID, enrolment no. and locality` : 'No new admitted students to add') : j.error); loadAll(); });

  // ---------- bulk fill ----------
  $('#debBulk').addEventListener('click', () => {
    const ids = picked(); if (!ids.length) return toast('Tick the learners first (or use the top tick-box for all)');
    const L = ST.lists;
    modal(`✏️ Set one detail for ${ids.length} learner${ids.length > 1 ? 's' : ''}`, `<form id="debBF" class="deb-form">
      <label>What to set<select name="field"><option value="admission_date">Admission date</option><option value="locality">Locality (Urban / Rural)</option><option value="category">Category</option><option value="programme">Programme</option><option value="nationality">Nationality</option><option value="country">Country of residence</option><option value="gov_id_type">Government ID type</option><option value="admission_details">Admission details</option></select></label>
      <label>Value<span id="debBV"></span></label>
      <p class="cc-hint deb-fbtns">Learners already sent to DEB are not changed.</p>
      <div class="deb-fbtns"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">✅ Apply</button></div></form>`);
    const input = () => { const f = $('#debBF [name=field]').value; const sel = (list) => `<select name="value">${list.map((x) => `<option${typeof x === 'object' ? ` value="${esc(x.key)}"` : ''}>${esc(typeof x === 'object' ? x.label : x)}</option>`).join('')}</select>`;
      $('#debBV').innerHTML = f === 'locality' ? sel(L.locality) : f === 'category' ? sel(L.category) : f === 'gov_id_type' ? sel(L.govId) : f === 'programme' ? sel(PROGS) : f === 'admission_date' ? '<input name="value" placeholder="DD-MM-YYYY" maxlength="10" required>' : '<input name="value" required>'; };
    input(); $('#debBF [name=field]').addEventListener('change', input);
    $('#debBF').addEventListener('submit', async (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); const j = await api('/api/deb/bulk', { method: 'POST', body: JSON.stringify({ ...b, ids }) }); toast(j.ok ? `✅ Updated ${j.updated} learners` : j.error); close(); loadAll(); });
  });

  // ---------- verify & push ----------
  const picked = () => [...SEL].filter((id) => ROWS.some((r) => r.id === id));
  async function verify(ids) {
    ids = ids || picked(); if (!ids.length) ids = ROWS.filter((r) => r.deb_id && !(r.verified && r.verified.ok)).map((r) => r.id);
    if (!ids.length) return toast('Nothing to verify');
    toast(`🔎 Checking ${ids.length} DEB-ID(s) on the DEB portal…`);
    const j = await api('/api/deb/verify', { method: 'POST', body: JSON.stringify({ ids: ids.slice(0, 50) }) });
    if (!j.ok) return toast(j.error || 'Could not verify'); const ok = j.results.filter((x) => x.ok).length;
    toast(`🔎 ${ok} of ${j.results.length} found on DEB${j.results.length - ok ? ' — see the red notes' : ''}`); loadAll();
  }
  $('#debVerify').addEventListener('click', () => verify());
  $('#debPush').addEventListener('click', () => {
    const ids = picked(); const sel = ids.length ? ROWS.filter((r) => ids.includes(r.id)) : ROWS.filter((r) => r.status === 'Ready' || (r.status === 'Failed' && !r.issues.length));
    if (!ST.configured) return toast('First save the DEB connection (step 1)');
    const ready = sel.filter((r) => r.status === 'Ready' || r.status === 'Failed' && !r.issues.length), skip = sel.length - ready.length;
    if (!ready.length) return toast(sel.length ? 'None of the selected learners is ready — fill what is missing first' : 'No learner is ready to push yet');
    const unver = ready.filter((r) => !(r.verified && r.verified.ok)).length;
    modal(`🚀 Send ${ready.length} admission${ready.length > 1 ? 's' : ''} to UGC-DEB`, `<p>These records will be sent to <b>${esc(ST.base)}</b> as your university's official admission data.</p>
      <div class="table-wrap deb-prev"><table><thead><tr><th>Learner</th><th>DEB-ID</th><th>Programme code</th><th>Mode</th><th>Enrolment</th><th>Admission date</th><th>Category · Locality</th><th>ID</th></tr></thead><tbody>
      ${ready.map((r) => `<tr><td>${esc(r.name)}</td><td><code>${esc(r.deb_id)}</code></td><td><code>${esc(r.deb_code)}</code></td><td>${esc(r.mode)}</td><td>${esc(r.enrollment_no)}</td><td>${esc(r.admission_date)}</td><td>${esc(r.category)} · ${esc(r.locality)}</td><td>${esc(r.gov_id_type)} ${esc(r.gov_id_no)}</td></tr>`).join('')}</tbody></table></div>
      ${unver ? `<p class="warn">⚠ ${unver} DEB-ID(s) are not verified yet — verifying first avoids rejections.</p>` : ''}${skip ? `<p class="muted">${skip} selected learner(s) are not ready / already sent and will be skipped.</p>` : ''}
      <label class="deb-chk"><input type="checkbox" id="debOk"> I have checked these details and want to send them to UGC-DEB.</label>
      <div class="deb-fbtns"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="debGo" type="button" disabled>🚀 Send to DEB</button></div>`);
    $('#debOk').addEventListener('change', (e) => { $('#debGo').disabled = !e.target.checked; });
    $('#debGo').addEventListener('click', async () => {
      $('#debGo').disabled = true; $('#debGo').textContent = 'Sending… please wait';
      const j = await api('/api/deb/push', { method: 'POST', body: JSON.stringify({ ids: ready.map((r) => r.id), confirm: true, force: false }) });
      if (!j.ok && j.error) { toast(j.error); close(); return; }
      $('#debMBody').innerHTML = `<div class="deb-res"><b>🚀 ${j.sent} sent</b> · <b class="bad">${j.failed} rejected</b> · ${j.skipped} skipped</div>
        <ul class="deb-reslist">${j.results.map((x) => `<li class="${x.ok ? 'ok' : x.skipped ? '' : 'bad'}">${x.ok ? '✅' : x.skipped ? '⏭' : '❌'} <b>${esc(x.name)}</b> — ${esc(x.message)}</li>`).join('')}</ul>
        <div class="deb-fbtns"><span></span><button class="btn primary" data-close type="button">Done</button></div>`;
      SEL.clear(); loadAll();
    });
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-tab="deb"]')) loadAll(); });
  loadAll();
})();
