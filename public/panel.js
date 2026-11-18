// Student panel — one place to see everything about a student and act on it (admin, counsellors and callers):
// timeline, WhatsApp / email templates, admission form link + payments, duplicates.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(opts.headers || {}) } })
    .then(async (r) => { if (r.status === 401) { location.href = '/admin/login'; throw new Error('auth'); } const j = await r.json().catch(() => ({})); return { ok: r.ok, ...j }; });
  const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const toast = (m) => { const t = $('#toast'); if (!t) return alert(m); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); };

  // 🔥 hot / 🌤 warm / ❄ cold — from status, calls and admission progress
  function leadScore(r) {
    if (!r) return null;
    let s = { New: 25, Contacted: 35, Interested: 65, 'Counselling Done': 75, 'Form Sent': 80, Applied: 90, Admitted: 100, 'Not Interested': 0 }[r.status] ?? 20;
    if (r.last_call_outcome === 'Connected') s += 5;
    if (['Not picked', 'Switched off', 'Not reachable', 'Busy'].includes(r.last_call_outcome)) s -= Math.min(15, 5 * (r.call_count || 1));
    if (r.last_call_outcome === 'Wrong number') s = 0;
    if (r.app_status === 'Form opened') s += 5; if (r.app_status === 'Payment submitted') s += 5;
    if (r.created_at && Date.now() - new Date(r.created_at) < 3 * 864e5 && r.status === 'New') s += 15; // fresh enquiry: call it while it is warm
    s = Math.max(0, Math.min(100, s));
    return { n: s, label: r.status === 'Admitted' ? '🎉 Admitted' : s >= 65 ? '🔥 Hot' : s >= 35 ? '🌤 Warm' : '❄ Cold', cls: r.status === 'Admitted' ? 'adm' : s >= 65 ? 'hot' : s >= 35 ? 'warm' : 'cold' };
  }
  window.leadScore = leadScore;
  window.leadChip = (r) => { const l = leadScore(r); return l ? `<span class="lead ${l.cls}" title="Lead score ${l.n}/100">${l.label}</span>` : ''; };

  const TPL = [
    ['intro', '👋 Introduction', 'Admissions at ADYPU', 'Hello {first}, I am {me} from the Admission Office, Ajeenkya DY Patil University (ADYPU), Pune. Thank you for your enquiry for {programme} (Ref: {ref}). I will guide you through programmes, fees, hostel and admission. Please reply here with any question.'],
    ['missed', '📞 Missed call', 'We tried to reach you', 'Hello {first}, I tried calling you about your admission enquiry for {programme} at ADYPU, Pune. Please tell me a convenient time to call, or reply here with your questions. – {me}, ADYPU Admissions'],
    ['details', '📚 Programme & fees', 'Programme and fee details – {programme}', 'Hello {first}, here are the details for {programme} at ADYPU, Pune:\n• Annual tuition fee ({feeYear}): {fee}\n• Hostel, scholarships and education loans: our team will guide you\n• Programmes: https://adypu.edu.in\nShall I book a free counselling session or campus visit for you? – {me}'],
    ['visit', '🏫 Campus visit', 'Visit the ADYPU campus', 'Hello {first}, you are welcome to visit our campus at D Y Patil Knowledge City, Charholi Bk., Lohegaon, Pune (Mon–Sat, 10 am – 5 pm). Tell me a day and I will arrange a campus tour and counselling for {programme}. – {me}'],
    ['form', '🎓 Admission form', 'Your ADYPU admission form – {programme}', 'Hello {first}, congratulations on taking the next step! Please fill your admission form for {programme} here:\n{link}\nIt takes about 10 minutes — keep your marksheets and a photo ready. You can pay the admission fee online / UPI / bank transfer after submitting. – {me}, ADYPU Admissions'],
    ['fee', '💳 Fee reminder', 'Admission fee reminder', 'Hello {first}, this is a gentle reminder to complete your admission fee payment for {programme}, to confirm your seat. Pay here (UPI / bank / online): {link}\nNeed help? Reply here. – {me}'],
    ['docs', '📄 Documents', 'Documents for your admission', 'Hello {first}, please keep these ready for admission: Class X & XII marksheets, leaving certificate, Aadhaar card, passport-size photos, entrance scorecard (if any) and caste / income certificate (if applicable). You can also upload them in your admission form: {link} – {me}'],
    ['welcome', '🎉 Welcome', 'Welcome to ADYPU!', 'Dear {first}, congratulations and welcome to the ADYPU family! Your admission for {programme} is confirmed. Our team will share the orientation and next steps soon. – {me}, Admission Office'],
  ];

  const STC = { New: 's-new', Contacted: 's-contacted', Interested: 's-interested', 'Counselling Done': 's-counsel', 'Form Sent': 's-form', Applied: 's-applied', Admitted: 's-admitted', 'Not Interested': 's-no' };
  let S = null, OPTS = {}, mode = null;
  function shell() {
    if ($('#spModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="spModal" hidden><div class="modal-box wide sp-box">
      <header class="modal-h"><div class="sp-head" id="spHead"></div><button class="icon" data-close type="button" aria-label="Close">✕</button></header>
      <div class="modal-b sp-body"><div id="spDup"></div>
        <div class="sp-actions"><button class="btn wa" data-act="whatsapp" type="button">💬 WhatsApp</button><button class="btn ghost" data-act="email" type="button">✉️ Email</button>
          <button class="btn primary" data-act="form" type="button">🎓 Admission form</button><button class="btn ghost" data-act="note" type="button">📝 Note</button></div>
        <div class="sp-pane" id="spCompose" hidden>
          <div class="tpl" id="spTpl"></div>
          <label class="lab" id="spSubjWrap">Subject<input id="spSubj" maxlength="140"></label>
          <label class="lab"><span id="spMsgLabel">Message</span><textarea id="spMsg" rows="6" maxlength="1500"></textarea></label>
          <div class="sp-row"><small class="muted" id="spHint"></small><button class="btn primary" id="spSend" type="button">Send</button></div>
        </div>
        <div class="sp-pane" id="spForm" hidden></div>
        <div class="sp-pane" id="spNote" hidden><label class="lab">Add a note to the timeline<textarea id="spNoteTxt" rows="2" maxlength="400" placeholder="e.g. Father will visit on Saturday with documents"></textarea></label><div class="sp-row"><span></span><button class="btn primary" id="spNoteSave" type="button">Save note</button></div></div>
        <div class="sp-apps" id="spApps"></div>
        <div><b class="small">🕑 Timeline</b><ol class="tl" id="spTl"></ol></div>
      </div></div></div>`);
    const m = $('#spModal');
    m.addEventListener('click', onClick);
    $('#spTpl').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) useTpl(b.dataset.t); });
    $('#spSend').addEventListener('click', send);
    $('#spNoteSave').addEventListener('click', async () => {
      const j = await api(`/api/student/${S.row.id}/note`, { method: 'POST', body: JSON.stringify({ text: $('#spNoteTxt').value }) });
      if (!j.ok) return toast(j.error || 'Could not save'); $('#spNoteTxt').value = ''; toast('Note saved'); reload();
    });
  }
  const vars = () => {
    const r = S.row, open = S.apps.find((a) => !['Cancelled'].includes(a.status));
    return { first: String(r.student_name).split(' ')[0], programme: r.course, ref: r.ref_no, me: S.me.name, fee: S.fee ? inr(S.fee) : 'as per the fee structure', feeYear: S.feeYear,
      link: open && open.link ? open.link : '[admission form link — create it with 🎓 Admission form]' };
  };
  const fill = (t) => t.replace(/\{(\w+)\}/g, (_, k) => vars()[k] ?? '');
  function useTpl(key) {
    const t = TPL.find((x) => x[0] === key); if (!t) return;
    $('#spTpl').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === key));
    $('#spSubj').value = fill(t[2]); $('#spMsg').value = fill(t[3]); $('#spMsg').dataset.tpl = key;
  }
  function showPane(p) { ['spCompose', 'spForm', 'spNote'].forEach((id) => { $('#' + id).hidden = id !== p; }); }
  async function onClick(e) {
    if (e.target.matches('[data-close]') || e.target === $('#spModal')) { $('#spModal').hidden = true; if (OPTS.onClose) OPTS.onClose(); return; }
    const act = e.target.closest('[data-act]'); if (act) {
      const a = act.dataset.act;
      if (a === 'whatsapp' || a === 'email') {
        mode = a; showPane('spCompose'); $('#spSubjWrap').hidden = a !== 'email';
        $('#spMsgLabel').textContent = a === 'email' ? 'Email message' : 'WhatsApp message (opens your WhatsApp with this text ready)';
        $('#spTpl').innerHTML = TPL.map((t) => `<button type="button" data-t="${t[0]}">${t[1]}</button>`).join('');
        $('#spSend').textContent = a === 'email' ? '✉️ Send email' : '💬 Open WhatsApp';
        $('#spHint').textContent = a === 'email' ? (!S.hasEmail ? '⚠ No email address for this student.' : !S.emailReady ? '⚠ Student email is not switched on yet (admin: Admissions tab → Email set-up).' : 'Sent from the admission email. Logged on the timeline.')
          : (!S.canDial ? '⚠ You can WhatsApp only students assigned to you for calling.' : 'Sent from your own WhatsApp — the student replies to you. Logged on the timeline.');
        $('#spSend').disabled = a === 'email' ? !(S.hasEmail && S.emailReady) : !S.canDial;
        useTpl(S.apps.some((x) => x.status === 'Submitted' || x.status === 'Payment pending') ? 'fee' : S.row.call_count ? 'details' : 'intro');
        return;
      }
      if (a === 'note') { showPane('spNote'); $('#spNoteTxt').focus(); return; }
      if (a === 'form') { showPane('spForm'); renderForm(); return; }
      if (a === 'mk-form') return makeForm(act);
      if (a === 'copy') { try { await navigator.clipboard.writeText(act.dataset.link); toast('Link copied ✓'); } catch { prompt('Copy this link', act.dataset.link); } return; }
      if (a === 'form-wa') { mode = 'whatsapp'; $('#spModal').querySelector('[data-act=whatsapp]').click(); useTpl('form'); return; }
      if (a === 'form-mail') { $('#spModal').querySelector('[data-act=email]').click(); useTpl('form'); return; }
      if (a === 'merge') { if (!confirm(`Merge ${act.dataset.ref} into ${act.dataset.keepref}? Calls, forms and the timeline move to ${act.dataset.keepref}, and ${act.dataset.ref} is deleted.`)) return;
        const j = await api(`/api/admin/students/${act.dataset.id}/merge`, { method: 'POST', body: JSON.stringify({ into: +act.dataset.keep }) }); if (!j.ok) return toast(j.error || 'Could not merge');
        toast(`✅ Merged into ${j.keep}`); if (+act.dataset.id === S.row.id) return open(+act.dataset.keep, OPTS); return reload(); }
      if (a === 'notdup') { const j = await api(`/api/admin/students/${act.dataset.id}/not-duplicate`, { method: 'POST' }); if (j.ok) { toast('Marked as not a duplicate'); reload(); } return; }
      if (a === 'open') return open(+act.dataset.id, OPTS);
    }
  }
  async function send() {
    const text = $('#spMsg').value.trim(); if (text.length < 5) return toast('Write the message first');
    if (mode === 'whatsapp') {
      const w = window.open('about:blank', '_blank');
      const j = await api(`/api/student/${S.row.id}/whatsapp`, { method: 'POST', body: JSON.stringify({ text, template: $('#spMsg').dataset.tpl }) });
      if (!j.url) { if (w) w.close(); return toast(j.error || 'Not allowed'); }
      if (w) w.location = j.url; else location.href = j.url;
      toast('💬 WhatsApp opened · logged on the timeline'); setTimeout(reload, 800);
    } else {
      $('#spSend').disabled = true; $('#spSend').textContent = 'Sending…';
      const j = await api(`/api/student/${S.row.id}/email`, { method: 'POST', body: JSON.stringify({ subject: $('#spSubj').value, text }) });
      $('#spSend').disabled = false; $('#spSend').textContent = '✉️ Send email';
      if (!j.ok) return toast(j.error || 'Could not send'); toast('✉️ Email sent'); reload();
    }
  }
  function renderForm() {
    const open = S.apps.find((a) => !['Cancelled', 'Paid'].includes(a.status));
    $('#spForm').innerHTML = `<b>🎓 Admission form & fee payment</b>
      <p class="small muted">Create a personal link for the student. They fill the full application (as on the printed form), upload documents and pay the admission fee online / UPI / bank transfer / at campus.</p>
      <div class="sp-type"><label><input type="radio" name="spType" value="Provisional" ${!open || open.type === 'Provisional' ? 'checked' : ''}><span><b>Provisional admission</b><small>Seat blocked with the provisional fee${S.provisionalFee ? ' (' + inr(S.provisionalFee) + ')' : ''}; documents can follow</small></span></label>
        <label><input type="radio" name="spType" value="Permanent" ${open && open.type === 'Permanent' ? 'checked' : ''}><span><b>Permanent admission</b><small>Full first-year fee${S.fee ? ' (' + inr(S.fee) + ' for ' + esc(S.row.course) + ', ' + esc(S.feeYear) + ')' : ''}</small></span></label></div>
      <div class="sp-row"><label class="mini"><input type="checkbox" id="spMailToo" ${S.hasEmail && S.emailReady ? 'checked' : 'disabled'}> also email the link to the student</label><button class="btn primary" data-act="mk-form" type="button">${open ? '🔁 Update & get link' : '✨ Create form link'}</button></div>`;
  }
  async function makeForm(btn) {
    const type = ($('#spForm [name=spType]:checked') || {}).value || 'Provisional';
    btn.disabled = true;
    const j = await api(`/api/student/${S.row.id}/application`, { method: 'POST', body: JSON.stringify({ type, email: $('#spMailToo') && $('#spMailToo').checked }) });
    btn.disabled = false;
    if (!j.ok) return toast(j.error || 'Could not create the form');
    toast(j.emailError ? `Link ready · email not sent: ${j.emailError}` : j.emailed ? '✅ Form link created and emailed' : '✅ Form link ready — share it by WhatsApp or copy it');
    await reload(); showPane('spForm'); renderForm();
  }
  const APP_CLS = { Sent: 'sent', Opened: 'open', Submitted: 'sub', 'Payment pending': 'pend', 'Part paid': 'pend', Paid: 'paid', Cancelled: 'can' };
  function renderApps() {
    $('#spApps').innerHTML = S.apps.length ? S.apps.map((a) => `<div class="appc ${APP_CLS[a.status] || ''}">
      <div class="appc-h"><b>🎓 ${esc(a.type)} admission</b> <span class="appst ${APP_CLS[a.status] || ''}">${esc(a.status)}</span>${a.app_no ? ` <code>${esc(a.app_no)}</code>` : ''}
        <span class="muted small">· ${esc(a.programme || '')} · by ${esc(a.created_by || '')} · ${fmt(a.created_at)}</span></div>
      <div class="appc-b"><span>Fee <b>${inr(a.fee)}</b></span><span>Paid <b class="${a.paid >= a.fee && a.fee ? 'ok' : ''}">${inr(a.paid)}</b></span>${a.fee > a.paid ? `<span>Due <b class="due">${inr(a.fee - a.paid)}</b></span>` : ''}
        ${a.payments.map((p) => `<span class="payc ${p.status === 'Pending verification' ? 'pend' : p.status === 'Rejected' ? 'bad' : 'ok'}">${inr(p.amount)} · ${esc(p.mode)} · ${esc(p.status)}</span>`).join('')}</div>
      ${a.link && a.status !== 'Cancelled' ? `<div class="appc-l"><input readonly value="${esc(a.link)}"><button class="btn xs ghost" data-act="copy" data-link="${esc(a.link)}" type="button">🔗 Copy</button><button class="btn xs wa" data-act="form-wa" type="button">💬 WhatsApp</button><button class="btn xs ghost" data-act="form-mail" type="button">✉️ Email</button><a class="btn xs ghost" href="${esc(a.link)}" target="_blank" rel="noopener">↗ Open</a></div>` : ''}
    </div>`).join('') : '';
  }
  const ICON = { created: '🆕', status: '🔄', assign: '👥', call: '📞', whatsapp: '💬', email: '✉️', form: '🎓', payment: '💳', merge: '👯', note: '📝', ai: '🤖' };
  function renderTimeline() {
    const items = [...S.events.map((e) => ({ at: e.at, icon: ICON[e.kind] || '•', who: e.actor, text: e.text, kind: e.kind })),
      ...S.calls.map((c) => ({ at: c.at, icon: c.channel === 'ai' ? '🤖' : c.channel === 'whatsapp' ? '💬' : '📞', who: c.user_name, text: `<b>${esc(c.outcome)}</b>${c.feedback ? ' — ' + esc(c.feedback) : ''}${c.next_action_date ? ` <span class="muted">· next ${esc(c.next_action_date)}</span>` : ''}`, html: true, kind: 'callrec' }))]
      .filter((x) => !(x.kind === 'call')) // the call record already carries the details
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    $('#spTl').innerHTML = items.length ? items.map((x) => `<li><span class="tl-i">${x.icon}</span><div><div>${x.html ? x.text : esc(x.text)}</div><small class="muted">${esc(x.who || '')} · ${fmt(x.at)}</small></div></li>`).join('') : '<li class="muted small">Nothing yet.</li>';
  }
  function renderHead() {
    const r = S.row, l = leadScore(r);
    $('#spHead').innerHTML = `<div><b class="sp-name">${esc(r.student_name)}</b> <code>${esc(r.ref_no)}</code> ${l ? `<span class="lead ${l.cls}">${l.label}</span>` : ''} <span class="stb ${STC[r.status] || ''}">${esc(r.status)}</span>
      <div class="small muted">${esc(r.level)} · ${esc(r.course)} · 📍 ${esc(r.city || '—')}${r.region ? ' (' + esc(r.region) + ')' : ''} · ${S.me.role === 'admin' ? `📞 +91 ${esc(r.mobile)}` : `🔒 +91 ${esc(r.mobile)}`}${r.email ? ' · ✉️ ' + esc(r.email) : ''}
      ${S.fee ? ` · 💰 Tuition ${inr(S.fee)}/yr` : ''}${r.data_source ? ` · 🏷 ${esc(r.data_source)}` : ''}${r.data_location ? ' · ' + esc(r.data_location) : ''}</div>
      <div class="small muted">Counsellor: <b>${esc(r.counsellor_name || '—')}</b> · Caller: <b>${esc(r.caller_name || '—')}</b>${r.created_by_name ? ' · Added by ' + esc(r.created_by_name) : ''}</div></div>`;
    const d = S.dup;
    $('#spDup').innerHTML = d ? `<div class="dupbox"><b>👯 Duplicate entries — same mobile number or email</b>
      <ul>${d.list.map((x) => `<li class="${x.id === r.id ? 'me' : ''}"><code>${esc(x.ref)}</code> ${esc(x.course)} · ${esc(x.status)} · added by ${esc(x.by)} · ${fmt(x.at)} ${x.id === d.first ? '<span class="tag1">first entry</span>' : ''}
        ${x.id !== r.id ? `<button class="btn xs ghost" data-act="open" data-id="${x.id}" type="button">Open</button>` : ''}
        ${S.me.role === 'admin' && x.id !== d.first ? `<button class="btn xs ghost" data-act="merge" data-id="${x.id}" data-ref="${esc(x.ref)}" data-keep="${d.first}" data-keepref="${esc(d.list.find((y) => y.id === d.first).ref)}" type="button">⤵ Merge into first</button><button class="btn xs ghost" data-act="notdup" data-id="${x.id}" type="button">Not a duplicate</button>` : ''}</li>`).join('')}</ul></div>` : '';
  }
  async function reload() {
    const j = await api(`/api/student/${S.row.id}`); if (!j.row) return toast(j.error || 'Not found');
    S = j; renderHead(); renderApps(); renderTimeline(); if (OPTS.onChange) OPTS.onChange(j.row);
  }
  async function open(id, opts = {}) {
    shell(); OPTS = opts; showPane(null);
    const j = await api(`/api/student/${id}`); if (!j.row) return toast(j.error || 'Not found');
    S = j; renderHead(); renderApps(); renderTimeline(); $('#spModal').hidden = false;
    if (opts.pane === 'form') { showPane('spForm'); renderForm(); }
  }
  window.StudentPanel = { open };
})();
