(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const TOKEN = location.pathname.split('/')[2] || '';
  const API = `/api/apply/${encodeURIComponent(TOKEN)}`;
  const call = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); };
  let ST = null, D = {}, step = 0, SECS = [], saveT = null;

  // ---------- load ----------
  async function load() {
    const j = await call(API);
    if (!j.app) { $('#err').hidden = false; $('#err').innerHTML = `<h2>⚠ ${esc(j.error || 'This link is not valid.')}</h2><p class="muted">Please contact the ADYPU admission office.</p>`; return; }
    ST = j; D = { ...(j.data || {}) }; SECS = j.schema.sections;
    $('#hero').hidden = false;
    $('#hi').textContent = `Hello ${j.student.name ? j.student.name.split(' ')[0] : ''} 👋`;
    $('#hiSub').textContent = `${j.app.type} admission · ${j.year} · enquiry ${j.student.ref}${j.app.app_no ? ' · application ' + j.app.app_no : ''}`;
    renderFee();
    if (['Sent', 'Opened'].includes(j.app.status)) startForm();
    else showPay();
  }
  function feeOf(level, programme, branch) { const r = ST.feeTable.find((x) => x.level === level && x.programme === programme && x.branch === (branch || '')); return r ? r.fee : null; }
  function renderFee() {
    const a = ST.app, t = feeOf(D.level, D.programme, D.branch);
    $('#heroFee').innerHTML = `<small>${a.type === 'Provisional' ? 'Provisional admission fee' : 'Admission fee (first year)'}</small><b>${inr(a.fee)}</b>${t ? `<small>Annual tuition (${esc(ST.feeYear)}): ${inr(t)}</small>` : ''}${a.paid ? `<small class="ok">Paid ${inr(a.paid)}</small>` : ''}`;
  }

  // ---------- form ----------
  const shown = (f) => { if (!f.show) return true; const [k, op, v] = f.show, c = D[k] || ''; return op === '=' ? c === v : c !== v && c !== ''; };
  const required = (f) => (f.req || (f.reqIf && (D[f.reqIf[0]] || '') === f.reqIf[2])) && shown(f);
  function startForm() {
    $('#form').hidden = false; $('#steps').hidden = false;
    if (!D.c_country) D.c_country = 'India';
    if (!D.applicant_name && (D.first_name || D.last_name)) D.applicant_name = `${D.first_name || ''} ${D.last_name || ''}`.trim();
    const done = +sessionStorageGet('step'); step = Number.isFinite(done) && done < SECS.length ? done : 0;
    render();
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(TOKEN + k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(TOKEN + k, v); } catch {} }
  function renderSteps() {
    $('#steps').innerHTML = SECS.map((s, i) => `<button type="button" data-i="${i}" class="${i === step ? 'on' : i < step ? 'done' : ''}"><span>${i < step ? '✓' : s.icon}</span><small>${esc(s.title)}</small></button>`).join('');
  }
  const progOpts = () => (ST.levels[D.level] || []).map((p) => `<option ${p.name === D.programme ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const branchList = () => { const p = (ST.levels[D.level] || []).find((x) => x.name === D.programme); return p && p.branches ? p.branches : null; };
  function input(f) {
    const v = D[f.k] ?? f.def ?? '', req = required(f) ? ' <i>*</i>' : '', id = 'f_' + f.k;
    const cls = `fld ${f.half ? 'half' : f.third ? 'third' : 'full'}`;
    if (f.type === 'h') return `<h3 class="sub">${esc(f.label)}</h3>`;
    if (f.type === 'check') return `<label class="fld full decl"><input type="checkbox" id="${id}" data-k="${f.k}" ${v ? 'checked' : ''}><span>${esc(f.label)}${req}</span><em class="fe" data-e="${f.k}"></em></label>`;
    let ctl;
    if (f.type === 'select') ctl = `<select id="${id}" data-k="${f.k}"><option value="">Choose…</option>${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'programme') ctl = `<select id="${id}" data-k="${f.k}"><option value="">Choose programme…</option>${progOpts()}</select>`;
    else if (f.type === 'branch') { const b = branchList(); ctl = `<select id="${id}" data-k="${f.k}" ${b ? '' : 'disabled'}>${b ? '<option value="">Choose…</option>' + b.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('') : '<option value="">— not needed —</option>'}</select>`; }
    else {
      const t = { email: 'email', date: 'date', tel: 'tel', pin: 'text', aadhaar: 'text', marks: 'text' }[f.type] || 'text';
      const im = { tel: 'numeric', pin: 'numeric', aadhaar: 'numeric', marks: 'decimal' }[f.type];
      const ml = { tel: 10, pin: 6, aadhaar: 12, marks: 6 }[f.type] || f.max || 120;
      ctl = `<input id="${id}" data-k="${f.k}" type="${t}" value="${esc(v)}" maxlength="${ml}" ${im ? `inputmode="${im}"` : ''} ${f.type === 'email' ? 'autocomplete="email"' : ''}>`;
    }
    return `<label class="${cls}" for="${id}"><span>${esc(f.label)}${req}</span>${ctl}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}<em class="fe" data-e="${f.k}"></em></label>`;
  }
  function render() {
    renderSteps(); sessionStorageSet('step', step);
    const s = SECS[step];
    let html = `<h2>${s.icon} ${esc(s.title)} <small class="muted">Step ${step + 1} of ${SECS.length}</small></h2>`;
    if (s.docs) html += docsHtml();
    else html += `<div class="grid">${s.fields.filter((f) => f.type === 'h' || shown(f)).map(input).join('')}</div>`;
    if (s.id === 'programme') html += `<div class="feebox" id="feebox"></div>`;
    $('#secs').innerHTML = html;
    $('#prev').disabled = step === 0;
    $('#next').textContent = step === SECS.length - 1 ? '✅ Submit application' : 'Save & continue →';
    $('#next').classList.toggle('submit', step === SECS.length - 1);
    if (s.id === 'programme') feeBox();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function feeBox() {
    const t = feeOf(D.level, D.programme, D.branch), el = $('#feebox'); if (!el) return;
    el.innerHTML = t ? `💰 Annual tuition fee for <b>${esc(D.programme)}${D.branch ? ' – ' + esc(D.branch) : ''}</b> (${esc(ST.feeYear)}): <b>${inr(t)}</b>${ST.app.type === 'Provisional' ? `<br><small>To block your seat now you pay the provisional admission fee of <b>${inr(ST.app.fee)}</b>.</small>` : ''}` : '<small class="muted">Choose your programme to see the fee.</small>';
  }
  $('#secs').addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const f = SECS.flatMap((s) => s.fields).find((x) => x.k === k);
    if (f && ['tel', 'pin', 'aadhaar'].includes(f.type)) e.target.value = e.target.value.replace(/\D/g, '');
    D[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const em = $(`[data-e="${k}"]`); if (em) em.textContent = '';
    autosave();
  });
  $('#secs').addEventListener('change', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    D[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'level') { D.programme = ''; D.branch = ''; }
    if (k === 'programme') { const b = branchList(); if (!b || !b.includes(D.branch)) D.branch = ''; }
    if (['first_name', 'last_name'].includes(k) && !D._signed) D.applicant_name = `${D.first_name || ''} ${D.last_name || ''}`.trim();
    if (k === 'applicant_name') D._signed = true;
    const s = SECS[step];
    if (s.fields.some((f) => f.show && f.show[0] === k) || ['level', 'programme'].includes(k) || s.fields.some((f) => f.reqIf && f.reqIf[0] === k)) { const keep = document.activeElement && document.activeElement.id; render(); if (keep && $('#' + keep)) $('#' + keep).focus(); }
    if (['level', 'programme', 'branch'].includes(k)) feeBox();
  });
  function autosave() { clearTimeout(saveT); $('#saved').textContent = '…'; saveT = setTimeout(save, 1200); }
  async function save() {
    clearTimeout(saveT);
    const { _signed, ...data } = D;
    const j = await call(API + '/draft', { method: 'PUT', body: JSON.stringify({ data }) });
    $('#saved').textContent = j.ok ? '✓ Saved' : '';
    if (j.ok && j.fee) { ST.app.fee = j.fee; renderFee(); feeBox(); }
  }
  function validateStep(i) {
    const s = SECS[i], errs = {};
    if (s.docs) { ST.schema.docs.filter((d) => d.req && !ST.files.some((f) => f.kind === d.k)).forEach((d) => { errs['doc_' + d.k] = 'Please upload'; }); return errs; }
    s.fields.forEach((f) => {
      if (!f.k || !shown(f)) return; const v = D[f.k];
      if (required(f) && !v) { errs[f.k] = 'Required'; return; }
      if (!v) return;
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errs[f.k] = 'Enter a valid email';
      if (f.type === 'tel' && !/^[6-9]\d{9}$/.test(v)) errs[f.k] = '10-digit mobile number';
      if (f.type === 'pin' && !/^\d{6}$/.test(v)) errs[f.k] = '6-digit pincode';
      if (f.type === 'aadhaar' && !/^\d{12}$/.test(v)) errs[f.k] = 'Aadhaar has 12 digits';
      if (f.type === 'marks' && !/^\d{1,3}(\.\d{1,2})?$/.test(v)) errs[f.k] = 'Number, e.g. 78.5';
    });
    if (s.id === 'programme' && branchList() && !D.branch) errs.branch = 'Choose your specialisation';
    return errs;
  }
  function showErrs(errs) {
    Object.entries(errs).forEach(([k, m]) => { const el = $(`[data-e="${k}"]`); if (el) el.textContent = m; });
    const first = Object.keys(errs)[0]; const el = first && ($('#f_' + first) || $(`[data-e="${first}"]`)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Please fill the highlighted fields');
  }
  $('#next').addEventListener('click', async () => {
    const errs = validateStep(step); if (Object.keys(errs).length) return showErrs(errs);
    await save();
    if (step < SECS.length - 1) { step++; render(); return; }
    // final submit
    if (!confirm('Submit your application? You cannot change it after submitting.')) return;
    const b = $('#next'); b.disabled = true; b.textContent = 'Submitting…';
    const { _signed, ...data } = D;
    const j = await call(API + '/submit', { method: 'POST', body: JSON.stringify({ data }) });
    b.disabled = false;
    if (!j.app) {
      if (j.fields) { const k = Object.keys(j.fields)[0], i = SECS.findIndex((s) => s.fields.some((f) => f.k === k) || (s.docs && k.startsWith('doc_'))); if (i >= 0) { step = i; render(); } setTimeout(() => showErrs(j.fields), 50); }
      else toast(j.error || 'Could not submit'); b.textContent = '✅ Submit application'; return;
    }
    ST = { ...ST, ...j }; sessionStorageSet('step', 0);
    $('#form').hidden = true; $('#steps').hidden = true; showPay(true);
  });
  $('#prev').addEventListener('click', () => { if (step > 0) { save(); step--; render(); } });
  $('#steps').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.i; if (i < step) { save(); step = i; render(); } else if (i > step) { for (let k = step; k < i; k++) { const er = validateStep(k); if (Object.keys(er).length) { step = k; render(); return showErrs(er); } } save(); step = i; render(); } });

  // ---------- documents ----------
  function docsHtml() {
    return `<p class="muted small">Upload clear photos or PDFs (max 2 MB each). Photos are compressed automatically. Items marked * are needed now; you can bring the rest to the admission desk.</p>
      <div class="docs">${ST.schema.docs.map((d) => { const f = ST.files.find((x) => x.kind === d.k);
        return `<div class="doc ${f ? 'has' : ''}"><div><b>${esc(d.label)}${d.req ? ' <i>*</i>' : ''}</b><small class="muted">${f ? `✓ ${esc(f.name)} · ${(f.size / 1024).toFixed(0)} KB · <a href="${API}/file/${f.id}" target="_blank" rel="noopener">view</a>` : 'Not uploaded'}</small><em class="fe" data-e="doc_${d.k}"></em></div>
          <label class="btn ghost up">${f ? 'Replace' : '⬆ Upload'}<input type="file" accept="image/jpeg,image/png,application/pdf${d.k === 'photo' || d.k === 'signature' ? '' : ''}" data-doc="${d.k}" hidden></label></div>`; }).join('')}</div>`;
  }
  async function shrink(file, max) {
    if (!/^image\//.test(file.type)) return file;
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', 0.82));
  }
  $('#secs').addEventListener('change', async (e) => {
    const kind = e.target.dataset.doc; if (!kind || !e.target.files[0]) return;
    let file = e.target.files[0];
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) return toast('Please choose a JPG, PNG or PDF file');
    const lab = e.target.closest('label'); lab.firstChild.textContent = 'Uploading…';
    try {
      const blob = await shrink(file, kind === 'photo' || kind === 'signature' ? 700 : 1700);
      if (blob.size > 2 * 1024 * 1024) { toast('File is larger than 2 MB. Please use a smaller photo / PDF.'); render(); return; }
      const r = await fetch(`${API}/file?kind=${kind}&name=${encodeURIComponent(file.name.replace(/\.\w+$/, '') + (blob.type === 'application/pdf' ? '.pdf' : '.jpg'))}`, { method: 'POST', headers: { 'Content-Type': blob.type || file.type }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) { toast(j.error || 'Upload failed'); render(); return; }
      ST.files = ST.files.filter((f) => f.kind !== kind).concat(j.file); toast('✓ Uploaded'); render();
    } catch { toast('Could not read that file'); render(); }
  });

  // ---------- after submit: payment ----------
  function showPay(fresh) {
    const a = ST.app, due = Math.max(0, a.fee - a.paid), p = ST.pay || {};
    renderFee();
    $('#hiSub').textContent = `${a.type} admission · application ${a.app_no || ''}`;
    const pays = ST.payments || [];
    const paysHtml = pays.length ? `<h3 class="sub">Your payments</h3><ul class="pays">${pays.map((x) => `<li class="${x.status === 'Pending verification' ? 'pend' : x.status === 'Rejected' ? 'bad' : 'ok'}"><b>${inr(x.amount)}</b> · ${esc(x.mode)}${x.reference ? ' · ' + esc(x.reference) : ''} · <span>${esc(x.status)}</span>
      ${x.receipt_no ? ` · <a href="/apply/${encodeURIComponent(TOKEN)}/receipt/${x.id}.pdf" target="_blank" rel="noopener">⬇ Receipt</a>` : ''}</li>`).join('')}</ul>` : '';
    const box = $('#pay'); box.hidden = false;
    if (a.status === 'Paid') {
      box.innerHTML = `<div class="okbig">🎉</div><h2>Your ${a.type.toLowerCase()} admission is confirmed!</h2><p>Application <b>${esc(a.app_no)}</b> · fee paid <b>${inr(a.paid)}</b>. The admission office will contact you with the next steps.</p>${paysHtml}${contact()}`;
      return;
    }
    const pending = pays.some((x) => x.status === 'Pending verification');
    box.innerHTML = `${fresh ? `<div class="okbig">✅</div><h2>Application submitted!</h2><p>Your application number is <b>${esc(a.app_no)}</b>. Save it for future reference.</p>` : `<h2>Application ${esc(a.app_no || '')}</h2>`}
      ${pending ? '<p class="note">⏳ We received your payment details. The admission office will verify them (usually within 1 working day) and your receipt will appear here.</p>' : ''}
      <div class="due"><span>Amount due now</span><b>${inr(due)}</b><small>${a.type} admission fee${a.paid ? ` · already paid ${inr(a.paid)}` : ''}</small></div>
      ${due > 0 ? `<h3 class="sub">Choose how to pay</h3><div class="ptabs" id="ptabs">
        ${p.online ? '<button type="button" data-m="online" class="on">💳 Pay online</button>' : ''}${p.upi ? `<button type="button" data-m="upi" class="${p.online ? '' : 'on'}">📱 UPI</button>` : ''}
        ${p.bank ? `<button type="button" data-m="bank" class="${!p.online && !p.upi ? 'on' : ''}">🏦 Bank transfer</button>` : ''}<button type="button" data-m="campus" class="${!p.online && !p.upi && !p.bank ? 'on' : ''}">🏫 At campus</button></div>
        <div id="pbody"></div>` : ''}
      ${paysHtml}${contact()}`;
    if (due > 0) { const first = $('#ptabs button.on') || $('#ptabs button'); first.classList.add('on'); payBody(first.dataset.m, due); }
  }
  const contact = () => { const c = ST.counsellor; const list = c ? [c] : ST.contacts; return `<p class="muted small help">Need help? ${list.map((x) => `<a href="https://wa.me/91${x.phone}" target="_blank" rel="noopener">💬 ${esc(x.name)} (${x.phone})</a>`).join(' · ')}</p>`; };
  $('#pay').addEventListener('click', (e) => { const b = e.target.closest('#ptabs button'); if (!b) return; $('#ptabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); payBody(b.dataset.m, ST.app.fee - ST.app.paid); });
  function refForm(mode, label, needRef) {
    return `<form class="pform" data-mode="${esc(mode)}"><div class="grid"><label class="fld third"><span>Amount paid (₹) <i>*</i></span><input name="amount" inputmode="numeric" value="${ST.app.fee - ST.app.paid}"></label>
      ${needRef ? `<label class="fld third"><span>${esc(label)} <i>*</i></span><input name="reference" maxlength="40" placeholder="e.g. 412345678901"></label>
      <label class="fld third"><span>Payment screenshot (optional)</span><input type="file" name="proof" accept="image/jpeg,image/png,application/pdf"></label>` : ''}</div>
      <button class="btn primary" type="submit">${needRef ? 'Submit payment details' : 'I will pay at the campus'}</button></form>`;
  }
  async function payBody(m, due) {
    const p = ST.pay, el = $('#pbody');
    if (m === 'online') el.innerHTML = `<p>Pay securely by card, UPI or net banking. Your receipt is generated instantly.</p><button class="btn primary" id="payOnline" type="button">💳 Pay ${inr(due)} online</button>`;
    if (m === 'upi') {
      const link = await call(API + '/upi-link');
      el.innerHTML = `<div class="upi"><img src="${API}/upi.svg?t=${Date.now()}" alt="UPI QR code" width="190" height="190"><div><p>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) and pay <b>${inr(due)}</b> to <b>${esc(p.upiId)}</b> (${esc(p.payee)}).</p>
        ${link.uri ? `<a class="btn wa mob" href="${esc(link.uri)}">📱 Open UPI app</a>` : ''}<p class="small muted">After paying, enter the 12-digit UPI reference (UTR) below.</p></div></div>${refForm('UPI', 'UPI reference / UTR', true)}`;
    }
    if (m === 'bank') el.innerHTML = `<table class="bank"><tr><td>Account name</td><td><b>${esc(p.bank.accountName)}</b></td></tr><tr><td>Bank</td><td>${esc(p.bank.bankName)}${p.bank.branch ? ', ' + esc(p.bank.branch) : ''}</td></tr>
      <tr><td>Account number</td><td><b>${esc(p.bank.accountNo)}</b></td></tr><tr><td>IFSC</td><td><b>${esc(p.bank.ifsc)}</b></td></tr><tr><td>Remarks</td><td>${esc(ST.app.app_no || '')}</td></tr></table>${refForm('Bank transfer (NEFT / RTGS / IMPS)', 'UTR / transaction number', true)}`;
    if (m === 'campus') el.innerHTML = `<p>${esc(p.campus || 'Pay at the Admission Office.')}</p><p class="small muted">Carry your application number <b>${esc(ST.app.app_no || '')}</b>. Your receipt is given at the counter.</p>${refForm('At campus (cash / DD / cheque)', '', false)}`;
  }
  $('#pay').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button'); b.disabled = true;
    let proof = null;
    const file = f.proof && f.proof.files[0];
    if (file) { const blob = await shrink(file, 1600); const r = await fetch(API + '/proof', { method: 'POST', headers: { 'Content-Type': blob.type || file.type }, body: blob }).then((x) => x.json()).catch(() => ({})); proof = r.id || null; }
    const j = await call(API + '/payment', { method: 'POST', body: JSON.stringify({ mode: f.dataset.mode, amount: f.amount.value, reference: f.reference ? f.reference.value : '', proof_file_id: proof }) });
    b.disabled = false;
    if (!j.app) return toast(j.error || 'Could not save');
    ST = { ...ST, ...j }; toast('✓ Payment details received'); showPay();
  });
  $('#pay').addEventListener('click', async (e) => {
    if (e.target.id !== 'payOnline') return;
    const o = await call(API + '/rzp/order', { method: 'POST' }); if (!o.order_id) return toast(o.error || 'Online payment is not available');
    if (!window.Razorpay) await new Promise((ok) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
    if (!window.Razorpay) return toast('Could not load the payment window. Try UPI instead.');
    const rz = new window.Razorpay({ key: o.key, order_id: o.order_id, amount: o.amount, currency: 'INR', name: o.name, description: o.description, prefill: o.prefill, theme: { color: '#0B1F4B' },
      handler: async (resp) => { const j = await call(API + '/rzp/verify', { method: 'POST', body: JSON.stringify(resp) }); if (!j.app) return toast(j.error || 'Could not verify'); ST = { ...ST, ...j }; showPay(); } });
    rz.open();
  });
  load();
})();
