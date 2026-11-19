(() => {
  const $ = (s) => document.querySelector(s);
  const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'X-Requested-With': 'fetch', ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } })
    .then(async (r) => { if (r.status === 401) { location.href = (window.__b || '') + '/admin/login'; throw new Error('auth'); } const j = await r.json(); return { ok: r.ok, status: r.status, ...j }; });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const STATUS_CLS = { 'New': 's-new', 'Contacted': 's-contacted', 'Interested': 's-interested', 'Counselling Done': 's-counsel', 'Form Sent': 's-form', 'Applied': 's-applied', 'Admitted': 's-admitted', 'Not Interested': 's-no' };
  let ALLOW_REVEAL = false, ME = null, STATUSES = [], LEVELS = { UG: [], PG: [] }, rows = [], KIND = 'counsellor', OUTCOMES = [], cf = 'today', crows = [], LOG = null;
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
      programme: F.programme.value, branch: F.branch.disabled ? '' : F.branch.value, status: F.status.value, notes: F.notes.value, sendSms: F.sendSms.checked,
      data_source: F.data_source.value, data_location: F.data_location.value };
    const btn = $('#addBtn'); btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const j = await api('/api/team/enquiries', { method: 'POST', body: JSON.stringify(body) });
      if (!j.ok) { msg.textContent = j.fields ? Object.values(j.fields).join(' ') : j.error; return; }
      msg.className = 'okmsg'; msg.textContent = `✓ Added ${j.row.student_name} as ${j.row.ref_no}${body.sendSms ? ' · SMS sent' : ''}`;
      toast(`Added ${j.row.ref_no}`);
      ['student_name', 'mobile', 'email', 'city', 'notes'].forEach((k) => { F[k].value = ''; }); // source & location stay for the next student
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
      const j = await api(`/api/team/import?name=${encodeURIComponent(file.name)}&sms=${$('#bulkSms').checked ? 1 : 0}&source=${encodeURIComponent($('#upSource').value)}&location=${encodeURIComponent($('#upLocation').value)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const box = $('#result'); box.hidden = false;
      if (!j.ok) { box.innerHTML = `<p class="aerr">${esc(j.error)}</p>`; return; }
      box.innerHTML = `<div class="res-tiles"><span class="rt ok"><b>${j.added.length}</b>added</span><span class="rt dup"><b>${j.duplicates.length}</b>already in database</span><span class="rt bad"><b>${j.errors.length}</b>need fixing</span></div>`
        + (j.errors.length ? `<details open><summary>Rows to fix</summary><ul>${j.errors.slice(0, 50).map((x) => `<li>Row ${x.line}${x.name ? ` (${esc(x.name)})` : ''}: ${esc(x.problems.join(' '))}</li>`).join('')}</ul></details>` : '')
        + (j.duplicates.length ? `<details open><summary>Skipped duplicates (${j.duplicates.length})</summary><ul>${j.duplicates.slice(0, 100).map((x) => `<li>Row ${x.line} ${esc(x.name)} → ${esc(x.owner || 'already ' + x.ref)}</li>`).join('')}</ul></details>` : '');
      toast(`${j.added.length} students added`);
      file = null; $('#file').value = ''; $('#dropName').textContent = ''; drop.classList.remove('has');
      load();
    } finally { btn.textContent = 'Upload students'; btn.disabled = !file; }
  });

  // ---------- calling team ----------
  const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const addDays = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const dShort = (d) => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  async function loadCalls() {
    const p = new URLSearchParams(); if (cf) p.set('follow', cf); if (cf === 'today' || cf === 'upcoming' || cf === 'overdue') p.set('sort', 'next'), p.set('dir', 'asc');
    if ($('#cq').value.trim()) p.set('q', $('#cq').value.trim());
    const [list, sum] = await Promise.all([api('/api/team/enquiries?' + p), api('/api/team/summary')]);
    crows = list.rows || [];
    $('#cToday').textContent = sum.today; $('#cOver').textContent = sum.overdue; $('#cUn').textContent = sum.untouched; $('#cAll').textContent = sum.all;
    const k = [['Assigned to me', sum.all, '📋', ''], ['Due today', sum.today, '📅', sum.today ? 'warn' : ''], ['Overdue', sum.overdue, '⏰', sum.overdue ? 'bad' : ''], ['Not called yet', sum.untouched, '🔴', sum.untouched ? 'warn' : ''], ['Called', sum.all - sum.untouched, '✅', 'good']];
    $('#kpis').innerHTML = k.map(([t, v, i, c]) => `<div class="kpi tk ${c}"><span class="tk-i">${i}</span><div><div class="kt">${t}</div><div class="kv"><b>${v}</b></div></div></div>`).join('');
    const empty = { today: '🎉 No follow-ups due today.', overdue: '👍 Nothing overdue.', untouched: '✅ You have called every student assigned to you.', upcoming: 'No upcoming follow-ups planned.', '': 'No students assigned to you yet. The admin assigns students for calling.' };
    $('#clist').innerHTML = crows.length ? crows.map((r) => {
      const t = istToday(), due = r.next_action_date;
      const dueTag = !due ? '' : due < t ? `<span class="fu over">⏰ was due ${dShort(due)}</span>` : due === t ? '<span class="fu now">📅 due today</span>' : `<span class="fu">🗓 ${dShort(due)}</span>`;
      return `<article class="cc" data-id="${r.id}">
        <div class="cc-main"><button class="cc-open" type="button" title="Open: timeline, WhatsApp templates, email, admission form">${esc(r.student_name)} 📂</button> <code>${esc(r.ref_no)}</code> ${window.leadChip ? window.leadChip(r) : ''}${r.app_status ? ` <span class="appb">🎓 ${esc(r.app_status)}</span>` : ''}
          <div class="cc-sub"><span class="lv ${r.level === 'PG' ? 'pg' : 'ug'}">${esc(r.level)}</span> ${esc(r.programme)}${r.branch ? ' · ' + esc(r.branch) : ''} · 📍 ${esc(r.city || '—')}</div>
          <div class="cc-tags"><span class="mask">🔒 +91 ${esc(r.mobile)}</span> <span class="stb ${STATUS_CLS[r.status] || ''}">${esc(r.status)}</span>
            ${r.call_count ? `<span class="fu">📞 ${r.call_count} call${r.call_count > 1 ? 's' : ''} · last: ${esc(r.last_call_outcome || '')}</span>` : '<span class="fu new">🔴 not called yet</span>'} ${dueTag}</div></div>
        <div class="cc-act"><button class="btn primary dial" data-via="call" type="button">📞 Call</button><button class="btn wa dial" data-via="whatsapp" type="button">💬 WhatsApp</button><button class="btn ghost log" type="button">📝 Log call</button></div>
      </article>`; }).join('') : `<p class="empty-c">${empty[cf]}</p>`;
  }
  $('#callTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; cf = b.dataset.f; $('#callTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadCalls(); });
  let ct; $('#cq').addEventListener('input', () => { clearTimeout(ct); ct = setTimeout(loadCalls, 300); });
  $('#clist').addEventListener('click', async (e) => {
    const card = e.target.closest('.cc'); if (!card) return;
    const r = crows.find((x) => x.id == card.dataset.id);
    if (e.target.closest('.cc-open')) return window.StudentPanel.open(r.id, { onClose: loadCalls });
    const d = e.target.closest('.dial');
    if (d) {
      const via = d.dataset.via;
      const j = await api(`/api/team/enquiries/${r.id}/dial`, { method: 'POST', body: JSON.stringify({ via }) });
      if (!j.mobile) return toast(j.error || 'Not allowed');
      if (via === 'whatsapp') {
        const msg = `Hello ${j.first}, I am ${ME.name} from the Admission Office, Ajeenkya DY Patil University, Pune. Thank you for your enquiry for ${j.course} (Ref: ${j.ref}). Please reply here for any query.`;
        window.open(`https://wa.me/91${j.mobile}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      } else location.href = 'tel:+91' + j.mobile;
      setTimeout(() => openLog(r, via), 1200); // after the call, ask for the result
      return;
    }
    if (e.target.closest('.log')) openLog(r, 'call');
  });
  async function openLog(r, via) {
    LOG = { r, via, outcome: '' };
    $('#logTitle').textContent = `📝 ${via === 'whatsapp' ? 'WhatsApp' : 'Call'} with ${r.student_name} · ${r.ref_no}`;
    $('#outcomes').innerHTML = OUTCOMES.map((o) => `<button type="button" data-o="${esc(o)}">${{ Connected: '✅', 'Not picked': '📵', Busy: '⏳', 'Switched off': '📴', 'Not reachable': '🚫', 'Wrong number': '❌', 'Call back later': '🔁' }[o] || ''} ${esc(o)}</button>`).join('');
    const f = $('#logForm'); f.reset();
    $('#logStatus').innerHTML = STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
    f.next.value = r.next_action_date && r.next_action_date >= istToday() ? r.next_action_date : addDays(2);
    const h = await api(`/api/team/enquiries/${r.id}/calls`);
    $('#logHist').innerHTML = (h.calls || []).length ? '<b class="small">Earlier calls</b>' + h.calls.slice(0, 4).map((c) => `<div class="hm"><span>${esc(c.outcome)} · ${fmt(c.at)}</span>${c.feedback ? `<p>${esc(c.feedback)}</p>` : ''}</div>`).join('') : '';
    $('#logModal').hidden = false;
  }
  $('#outcomes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; LOG.outcome = b.dataset.o;
    $('#outcomes').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const f = $('#logForm');
    if (LOG.outcome === 'Connected' && f.status.value === 'New') f.status.value = 'Contacted';
    if (['Not picked', 'Busy', 'Switched off', 'Not reachable'].includes(LOG.outcome)) f.next.value = addDays(1);
    if (LOG.outcome === 'Call back later') f.next.value = addDays(1);
  });
  $('#quickDates').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('#logForm').next.value = b.dataset.d ? addDays(+b.dataset.d) : ''; });
  document.addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) e.target.closest('.modal').hidden = true; });
  $('#logSave').addEventListener('click', async () => {
    if (!LOG.outcome) return toast('Choose how the call went');
    const f = $('#logForm');
    const j = await api(`/api/team/enquiries/${LOG.r.id}/calls`, { method: 'POST', body: JSON.stringify({ outcome: LOG.outcome, feedback: f.feedback.value, status: f.status.value, next_action_date: f.next.value, channel: LOG.via }) });
    if (!j.ok) return toast(j.error || 'Could not save');
    $('#logModal').hidden = true; toast(`✅ Saved · ${LOG.outcome}${f.next.value ? ' · next follow-up ' + dShort(f.next.value) : ''}`); loadCalls();
    if (f.status.value === 'Form Sent') window.StudentPanel.open(LOG.r.id, { pane: 'form', onClose: loadCalls });
  });

  // ---------- my students ----------
  async function load() {
    if (KIND === 'caller') return loadCalls();
    const p = new URLSearchParams();
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if ($('#fStatus').value) p.set('status', $('#fStatus').value);
    if ($('#from').value) p.set('from', $('#from').value);
    if ($('#to').value) p.set('to', $('#to').value);
    const [mine, all] = await Promise.all([api('/api/team/enquiries?' + p), api('/api/team/enquiries')]);
    rows = mine.rows; ALLOW_REVEAL = !!mine.allowReveal; renderKpis(all.rows); renderTable();
    $('#srcList').innerHTML = [...new Set(all.rows.map((r) => r.data_source).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('');
  }
  function renderKpis(all) {
    const today = istDay(Date.now()), wk = Date.now() - 7 * 864e5;
    const k = [
      ['My students', all.length, '👩‍🎓', ''], ['Added today', all.filter((r) => r.created_by_id === ME.id && istDay(r.created_at) === today).length, '⚡', ''],
      ['Added this week', all.filter((r) => r.created_by_id === ME.id && new Date(r.created_at) > wk).length, '📅', ''],
      ['Waiting for a call', all.filter((r) => r.status === 'New').length, '📞', 'warn'], ['Admitted', all.filter((r) => r.status === 'Admitted').length, '🎉', 'good'],
    ];
    $('#qrCount').textContent = all.filter((r) => r.created_by_id === ME.id && r.source === 'qr-ref').length;
    $('#kpis').innerHTML = k.map(([t, v, i, c]) => `<div class="kpi tk ${c}"><span class="tk-i">${i}</span><div><div class="kt">${t}</div><div class="kv"><b>${v}</b></div></div></div>`).join('');
  }
  function renderTable() {
    $('#hint').textContent = `${rows.length} shown`;
    renderAssignBar();
    if (!rows.length) { $('#rows').innerHTML = '<tr><td colspan="12" class="empty">No students yet. Add one above or upload a file.</td></tr>'; return; }
    $('#rows').innerHTML = rows.map((r, i) => `<tr data-id="${r.id}">
      <td><input type="checkbox" class="pick" ${SEL.has(r.id) ? 'checked' : ''} aria-label="Select"></td>
      <td class="muted">${i + 1}</td><td><code>${esc(r.ref_no)}</code></td><td><button class="openp" type="button" title="Open: timeline, WhatsApp templates, email, admission form">${esc(r.student_name)} <span class="op">📂</span></button>
        <div class="chips-s">${window.leadChip ? window.leadChip(r) : ''}${r.dup_of ? '<span class="dupb">👯 duplicate</span>' : ''}${r.app_status ? `<span class="appb">🎓 ${esc(r.app_status)}</span>` : ''}</div></td>
      <td class="nowrap"><span class="mask" title="Hidden for privacy — only the main admin can see full numbers">🔒 +91 ${esc(r.mobile)}</span>${ALLOW_REVEAL ? ` <button class="btn xs reveal" data-via="call" type="button">📞 Call</button> <button class="btn xs reveal wa" data-via="whatsapp" type="button">💬 WhatsApp</button>` : ''}${r.email ? `<br><span class="muted">${esc(r.email)}</span>` : ''}</td>
      <td>${esc(r.city || '—')}</td>
      <td><span class="lv ${r.level === 'PG' ? 'pg' : 'ug'}">${esc(r.level)}</span> <b>${esc(r.programme)}</b>${r.branch ? `<br><span class="muted">${esc(r.branch)}</span>` : ''}</td>
      <td><select class="st ${STATUS_CLS[r.status] || ''}">${STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
      <td class="small">${r.caller_name ? `${r.caller_name === 'AI Caller' ? '🤖' : '📞'} ${esc(r.caller_name)}${r.call_count ? `<br><span class="muted">${r.call_count} call${r.call_count > 1 ? 's' : ''} · ${esc(r.last_call_outcome || '')}</span>` : ''}` : '<span class="muted">—</span>'}</td>
      <td><input class="note" value="${esc(r.notes)}" placeholder="Add note…" maxlength="500"></td>
      <td>${r.created_by_id === ME.id && r.source === 'qr-ref' ? '<span class="src qr">📱 Via your QR</span>' : r.created_by_id === ME.id ? '<span class="src me">👤 Added by you</span>' : `<span class="src as">📌 Assigned${r.created_by_name ? ' · ' + esc(r.created_by_name) : ' · website'}</span>`}${r.data_source ? `<br><span class="dsrc">🏷 ${esc(r.data_source)}</span>` : ''}</td>
      <td class="muted nowrap">${fmt(r.created_at)}</td></tr>`).join('');
  }
  $('#rows').addEventListener('click', async (e) => {
    const op = e.target.closest('.openp'); if (op) return window.StudentPanel.open(+op.closest('tr').dataset.id, { onClose: load });
    const b = e.target.closest('.reveal'); if (!b) return;
    const tr = b.closest('tr');
    const via = b.dataset.via;
    if (!confirm(`This opens ${via === 'whatsapp' ? 'a WhatsApp chat from your own WhatsApp' : 'a call'} with the student. It is recorded and the admin is informed. Continue?`)) return;
    const j = await api(`/api/team/enquiries/${tr.dataset.id}/reveal`, { method: 'POST', body: JSON.stringify({ via }) });
    if (!j.mobile) return toast(j.error || 'Not allowed');
    if (via === 'whatsapp') {
      const msg = `Hello ${j.first}, I am ${ME.name} from the Admission Office, Ajeenkya DY Patil University, Pune. Thank you for your enquiry for ${j.course} (Ref: ${j.ref}). Please reply here for any query — I will guide you.`;
      window.open(`https://wa.me/91${j.mobile}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      return;
    }
    const a = document.createElement('a'); a.href = 'tel:+91' + j.mobile; a.className = 'btn xs primary'; a.textContent = '📞 Tap to call';
    b.replaceWith(a); setTimeout(() => { if (a.isConnected) a.remove(); }, 20000);
  });
  $('#rows').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.classList.contains('st') && e.target.value === 'Form Sent') {
      const r = rows.find((x) => x.id == tr.dataset.id); e.target.value = r.status;
      toast('🎓 Create the admission form link, then send it by WhatsApp or email');
      return window.StudentPanel.open(r.id, { pane: 'form', onClose: load });
    }
    const patch = e.target.classList.contains('st') ? { status: e.target.value } : e.target.classList.contains('note') ? { notes: e.target.value } : null;
    if (!patch) return;
    const j = await api(`/api/team/enquiries/${tr.dataset.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (j.ok) { Object.assign(rows.find((r) => r.id == tr.dataset.id), j.row); if (patch.status) { e.target.className = 'st ' + (STATUS_CLS[j.row.status] || ''); load(); } toast(patch.status ? `Status → ${j.row.status}` : 'Note saved'); }
  });
  // ---------- my calling team (counsellor) ----------
  const SEL = new Set(); let MYTEAM = { callers: [], aiCaller: null };
  const agoT = (iso) => { if (!iso) return 'never logged in'; const m = (Date.now() - new Date(iso)) / 60000; return m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  async function loadMyTeam() {
    const j = await api('/api/team/my-team'); if (!j.ok && !j.callers) return; MYTEAM = j;
    $('#myCallers').innerHTML = j.callers.length ? j.callers.map((u) => `<div class="mem ${u.active ? '' : 'off'}" data-id="${u.id}"><div class="mem-av">${esc(u.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</div>
      <div class="mem-n"><b>${esc(u.name)}</b> <span class="kind caller">📞 Caller</span><small>@${esc(u.username)} · ${esc(u.mobile)} · ${u.active ? agoT(u.last_login) : 'disabled'}</small></div>
      <div class="mem-s"><b>${u.assigned}</b><small>assigned</small></div><div class="mem-s"><b>${u.called}</b><small>called</small></div><div class="mem-s ${u.untouched ? 'warn' : ''}"><b>${u.untouched}</b><small>untouched</small></div><div class="mem-s"><b>${u.interested}</b><small>interested</small></div>
      <div class="mem-a"><button class="reset" type="button">🔑 Reset password</button>${u.active ? '<button class="dis" type="button">⛔ Disable</button>' : '<button class="ena" type="button">✅ Enable</button>'}</div></div>`).join('')
      : '<p class="muted small">No callers in your team yet. Create one on the left, then tick students in "My students" and assign them.</p>';
    const opts = j.callers.filter((u) => u.active).map((u) => `<option value="${u.id}">📞 ${esc(u.name)}</option>`).join('') + (j.aiCaller ? `<option value="${j.aiCaller.id}">🤖 AI Caller${j.aiCaller.connected ? '' : ' (not connected yet)'}</option>` : '');
    $('#asCaller').innerHTML = '<option value="">Choose caller…</option>' + opts;
    renderAssignBar();
  }
  function renderAssignBar() { $('#assignBar').hidden = KIND !== 'counsellor' || (!MYTEAM.callers.some((u) => u.active) && !MYTEAM.aiCaller); $('#selN').textContent = SEL.size; const a = $('#selAll'); if (a) a.checked = rows.length > 0 && rows.every((r) => SEL.has(r.id)); }
  $('#rows').addEventListener('change', (e) => { if (!e.target.classList.contains('pick')) return; const id = +e.target.closest('tr').dataset.id; e.target.checked ? SEL.add(id) : SEL.delete(id); renderAssignBar(); });
  $('#selAll').addEventListener('change', (e) => { rows.forEach((r) => (e.target.checked ? SEL.add(r.id) : SEL.delete(r.id))); renderTable(); });
  async function assign(body) {
    if (!SEL.size) return toast('Tick students first');
    const j = await api('/api/team/assign', { method: 'POST', body: JSON.stringify({ ids: [...SEL], ...body }) });
    if (!j.ok) return toast(j.error || 'Could not assign');
    toast(j.result.length ? '✅ Assigned: ' + j.result.map((x) => `${x.name} +${x.count}`).join(' · ') : `${j.assigned} students now have no caller`);
    SEL.clear(); load(); loadMyTeam();
  }
  $('#asGo').addEventListener('click', () => { if (!$('#asCaller').value) return toast('Choose a caller'); assign({ caller_id: +$('#asCaller').value }); });
  $('#asShare').addEventListener('click', () => { const ids = MYTEAM.callers.filter((u) => u.active).map((u) => u.id); if (!ids.length) return toast('Create callers first'); assign({ callers: ids }); });
  $('#asNone').addEventListener('click', () => assign({ caller_id: null }));
  $('#callerForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#callerMsg').textContent = '';
    const j = await api('/api/team/my-team', { method: 'POST', body: JSON.stringify({ name: f.elements['name'].value, username: f.username.value, mobile: f.mobile.value, password: f.password.value }) });
    if (!j.ok) { $('#callerMsg').textContent = j.error || 'Could not create'; return; }
    const box = $('#cpwBox'); box.hidden = false; box.innerHTML = `<b>✅ Caller created: ${esc(j.user.name)}</b><span>Username: <code>${esc(j.user.username)}</code></span><span>Password: <code>${esc(j.password)}</code></span><small>Share these with the caller now — the password is not shown again. Login: ${esc(location.origin)}/admin/login</small>`;
    f.reset(); loadMyTeam();
  });
  $('#callerForm').username.addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); });
  $('#myCallers').addEventListener('click', async (e) => {
    const card = e.target.closest('.mem'); if (!card) return; const id = card.dataset.id;
    if (e.target.classList.contains('reset')) { const j = await api(`/api/team/my-team/${id}`, { method: 'PATCH', body: JSON.stringify({ resetPassword: true }) }); if (j.ok) { const box = $('#cpwBox'); box.hidden = false; box.innerHTML = `<b>New password for ${esc(j.user.name)}</b><span>Username: <code>${esc(j.user.username)}</code></span><span>Password: <code>${esc(j.password)}</code></span>`; } return; }
    if (e.target.classList.contains('dis') || e.target.classList.contains('ena')) { const j = await api(`/api/team/my-team/${id}`, { method: 'PATCH', body: JSON.stringify({ active: e.target.classList.contains('ena') }) }); if (j.ok) toast(j.user.active ? `${j.user.name} enabled` : `${j.user.name} disabled`); loadMyTeam(); }
  });

  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  ['fStatus', 'from', 'to'].forEach((id) => $('#' + id).addEventListener('change', load));
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = (window.__b || '') + '/admin/login'; });

  (async () => {
    const j = await api('/api/team/me');
    ME = j.user; STATUSES = j.statuses; LEVELS = j.levels; KIND = j.kind || 'counsellor'; OUTCOMES = j.outcomes || [];
    if (KIND === 'caller') {
      ['qrSec', 'pushSec', 'studentsSec'].forEach((id) => { $('#' + id).hidden = true; });
      $('#callSec').hidden = false;
      document.querySelector('.tb-brand b').textContent = 'Calling Workspace';
      document.querySelector('.hello .muted').textContent = 'Students the admin assigned to you for calling. Tap Call, then log how it went and when to follow up.';
      $('#meChip').textContent = `📞 ${ME.name} · @${ME.username}`;
      const hh = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
      $('#hello').textContent = `${hh < 12 ? 'Good morning' : hh < 17 ? 'Good afternoon' : 'Good evening'}, ${ME.name.split(' ')[0]} 👋`;
      return loadCalls();
    }
    if (!j.studentMsgs) { // admin has switched student messages off
      [F.sendSms, $('#bulkSms')].forEach((c) => { if (c) { c.checked = false; const l = c.closest('label'); if (l) l.hidden = true; } });
    }
    $('#meChip').textContent = `👤 ${ME.name} · @${ME.username}`;
    const h = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
    $('#hello').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${ME.name.split(' ').filter((w) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))[0] || ME.name} 👋`;
    $('#cityList').innerHTML = (j.cities || []).map((c) => `<option value="${esc(c)}">`).join('');
    F.status.innerHTML = STATUSES.map((s) => `<option>${esc(s)}</option>`).join('');
    $('#fStatus').insertAdjacentHTML('beforeend', STATUSES.map((s) => `<option>${esc(s)}</option>`).join(''));
    // personal QR
    const link = `${location.origin}/?src=qr&ref=${encodeURIComponent(ME.username)}`;
    $('#myQr').src = '/qr.svg?ref=' + encodeURIComponent(ME.username);
    $('#myPoster').href = (window.__b || '') + '/qr-poster.pdf?ref=' + encodeURIComponent(ME.username);
    $('#myLink').textContent = link;
    $('#waShare').href = 'https://wa.me/?text=' + encodeURIComponent(`Admissions 2027-28 at Ajeenkya DY Patil University, Pune. Enquire in 30 seconds: ${link}`);
    $('#copyLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('Link copied ✓'); } catch { toast(link); } });
    fillProgrammes();
    $('#teamSec').hidden = false; loadMyTeam().catch(() => {});
    load();
  })();
})();
