(() => {
  const ICONS = {
    'Computer Science & Engineering': '💻', 'Software Engineering': '🧩', 'Cybersecurity': '🛡️',
    'AI & Data Science': '🤖', 'Biomedical Engineering': '🫀', 'Biotechnology': '🧬',
    'Mechanical Engineering': '⚙️', 'Robotics & Automation': '🦾', 'Electronics & Computer Engineering': '🔌', 'Civil Engineering': '🏗️',
  };
  const PROG = {
    'B.Tech': ['🛠️', 'Engineering · 10 branches'], 'Law': ['⚖️', 'School of Law'], 'Design': ['🎨', 'School of Design'], 'Hotel Management': ['🏨', 'Hospitality'],
    'M.Tech': ['🔬', 'Engineering · 10 branches'], 'MBA': ['📈', 'Management'], 'MCA': ['🖥️', 'Computer Applications'],
  };
  const QUOTES = [
    'The future belongs to those who prepare for it today.', 'Script your own success story.', 'Dream big. Start small. Begin now.',
    'Every expert was once a beginner.', 'Rise above — your potential has no ceiling.', 'Great careers are built one bold decision at a time.',
  ];
  const MSGS = ["Let's get started ✨", 'Great start! 🚀', 'Nice — keep going 💪', "You're halfway there 🌟", 'Almost done — one more step 🎯', 'All set! Hit the button 🎉'];
  const BR = ['Computer Science & Engineering', 'Software Engineering', 'Cybersecurity', 'AI & Data Science', 'Biomedical Engineering', 'Biotechnology',
    'Mechanical Engineering', 'Robotics & Automation', 'Electronics & Computer Engineering', 'Civil Engineering'];
  let LEVELS = {
    UG: [{ name: 'B.Tech', branches: BR }, { name: 'Law' }, { name: 'Design' }, { name: 'Hotel Management' }],
    PG: [{ name: 'M.Tech', branches: BR }, { name: 'MBA' }, { name: 'MCA' }],
  };
  let level = 'UG';
  const sel = { programme: null, branch: null };
  const progOf = () => LEVELS[level].find((p) => p.name === sel.programme);
  let OTP_REQUIRED = true;
  const otp = { token: null, mobile: null, timer: null, left: 0 };
  const isMobile = (v) => /^[6-9]\d{9}$/.test(v);

  const $ = (s, r = document) => r.querySelector(s);
  // QR attribution: ?src=qr (scanned a poster) and ?ref=<counsellor username> (personal QR); kept for this visit
  const QS = new URLSearchParams(location.search);
  const ss = (k, v) => { try { if (v !== undefined) sessionStorage.setItem(k, v); return sessionStorage.getItem(k) || ''; } catch { return v || ''; } };
  const REF = ss('adypu_ref', QS.get('ref') ? QS.get('ref').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30) : undefined);
  const SRC = ss('adypu_src', QS.get('src') === 'qr' ? 'qr' : undefined);
  const form = $('#enquiryForm'), coursesEl = $('#courses'), progsEl = $('#progs'), seg = $('.seg');
  const mobileEl = $('#mobile');

  fetch('/api/config').then((r) => r.json()).then((c) => {
    if (c.levels) LEVELS = c.levels;
    if (c.academicYear) $('#ay').textContent = c.academicYear;
    if (typeof c.otpRequired === 'boolean') OTP_REQUIRED = c.otpRequired;
    if (Array.isArray(c.contacts) && c.contacts.length) renderContacts(c.contacts);
    if (Array.isArray(c.cities)) $('#cityList').innerHTML = c.cities.map((x) => `<option value="${x.replace(/"/g, '')}">`).join('');
    renderProgs(); refreshVerifyUi();
  }).catch(() => {});

  if (REF) {
    $('#qrImg').src = '/qr.svg?ref=' + encodeURIComponent(REF);
    $('#qrPoster').href = '/qr-poster.pdf?ref=' + encodeURIComponent(REF);
    fetch('/api/ref?u=' + encodeURIComponent(REF)).then((r) => r.json()).then((j) => {
      if (j.name) { const c = $('#refChip'); c.textContent = `🤝 Your counsellor: ${j.name}`; c.hidden = false; }
    }).catch(() => {});
  }
  function renderContacts(list) {
    const ini = (n) => n.replace(/^(Dr|Mrs|Mr|Ms|Prof)\.?\s+/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const html = list.map((c) => {
      const p = String(c.phone).replace(/\D/g, '').slice(-10), nice = `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
      const card = document.createElement('div'); card.className = 'hc';
      card.innerHTML = '<div class="hc-av"></div><div class="hc-n"><b></b><a></a></div><a class="hc-btn call" aria-label="Call">📞</a><a class="hc-btn wa" target="_blank" rel="noopener" aria-label="WhatsApp">💬</a>';
      card.querySelector('.hc-av').textContent = ini(c.name);
      card.querySelector('b').textContent = c.name;
      const t = card.querySelector('.hc-n a'); t.textContent = nice; t.href = `tel:+91${p}`;
      card.querySelector('.call').href = `tel:+91${p}`;
      card.querySelector('.wa').href = `https://wa.me/91${p}`;
      return card;
    });
    ['#helpContacts', '#successContacts'].forEach((sel) => { const el = $(sel); if (el) { el.innerHTML = ''; html.forEach((n) => el.appendChild(n.cloneNode(true))); } });
  }
  function renderProgs() {
    progsEl.innerHTML = '';
    LEVELS[level].forEach((p, i) => {
      const lab = document.createElement('label');
      lab.className = 'prog'; lab.style.animationDelay = `${i * 50}ms`;
      const inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'programme'; inp.value = p.name; inp.checked = p.name === sel.programme;
      const ic = document.createElement('span'); ic.className = 'pi'; ic.textContent = (PROG[p.name] || ['🎓'])[0];
      const tx = document.createElement('span'); tx.textContent = p.name;
      const sm = document.createElement('small'); sm.textContent = (PROG[p.name] || ['', ''])[1];
      lab.append(inp, ic, tx, sm); progsEl.appendChild(lab);
    });
    renderBranches();
  }
  function renderBranches() {
    const p = progOf();
    $('#branchWrap').hidden = !(p && p.branches);
    coursesEl.innerHTML = '';
    if (p && p.branches) {
      $('#branchTitle').textContent = `Choose your ${p.name} branch`;
      p.branches.forEach((name, i) => {
        const lab = document.createElement('label');
        lab.className = 'course'; lab.style.animationDelay = `${i * 30}ms`;
        const inp = document.createElement('input');
        inp.type = 'radio'; inp.name = 'course'; inp.value = name; inp.checked = name === sel.branch;
        const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = ICONS[name] || '🎓';
        const tx = document.createElement('span'); tx.textContent = name;
        lab.append(inp, ic, tx); coursesEl.appendChild(lab);
      });
    }
    updateProgress();
  }
  progsEl.addEventListener('change', (e) => {
    if (e.target.name !== 'programme') return;
    sel.programme = e.target.value;
    if (!(progOf() && progOf().branches && progOf().branches.includes(sel.branch))) sel.branch = null;
    setErr('course', '');
    renderBranches();
    if (progOf().branches) setTimeout(() => $('#branchWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  });
  coursesEl.addEventListener('change', (e) => { if (e.target.name === 'course') { sel.branch = e.target.value; setErr('course', ''); updateProgress(); } });
  function setLevel(l) {
    level = l; seg.dataset.active = l;
    seg.querySelectorAll('.seg-btn').forEach((x) => { const on = x.dataset.level === l; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
    // keep the branch when switching B.Tech ↔ M.Tech
    const twin = { 'B.Tech': 'M.Tech', 'M.Tech': 'B.Tech' }[sel.programme];
    sel.programme = twin || null;
    if (!twin) sel.branch = null;
    renderProgs();
  }
  seg.addEventListener('click', (e) => { const b = e.target.closest('.seg-btn'); if (b && b.dataset.level !== level) setLevel(b.dataset.level); });
  const programmeChosen = () => !!sel.programme && (!progOf().branches || !!sel.branch);
  const courseText = () => (sel.branch ? `${sel.programme} – ${sel.branch}` : sel.programme);
  renderProgs();

  // ---------- progress ----------
  function updateProgress() {
    const done = [
      $('#student_name').value.trim().length >= 2,
      isMobile(mobileEl.value) && (!OTP_REQUIRED || !!otp.token),
      $('#city').value.trim().length >= 2,
      programmeChosen(),
      $('#consent').checked,
    ].filter(Boolean).length;
    $('#bar').style.width = `${done * 20}%`;
    $('#progressTxt').textContent = MSGS[done];
  }
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', updateProgress);

  // ---------- rotating quotes ----------
  let qi = 0; const qEl = $('#quote');
  setInterval(() => { qEl.classList.add('fade'); setTimeout(() => { qi = (qi + 1) % QUOTES.length; qEl.textContent = QUOTES[qi]; qEl.classList.remove('fade'); }, 450); }, 4500);

  // ---------- city → region badge ----------
  let rt;
  $('#city').addEventListener('input', (e) => {
    clearTimeout(rt);
    const v = e.target.value.trim(), badge = $('#regionBadge');
    if (v.length < 3) { badge.hidden = true; return; }
    rt = setTimeout(async () => {
      try {
        const r = await (await fetch('/api/region?city=' + encodeURIComponent(v))).json();
        if (r.region && r.region !== 'Other') { badge.textContent = '📍 ' + r.region; badge.hidden = false; } else badge.hidden = true;
      } catch { badge.hidden = true; }
    }, 250);
  });

  // ---------- mobile OTP ----------
  const otpInputs = [...document.querySelectorAll('#otpInputs input')];
  function refreshVerifyUi() {
    const v = mobileEl.value, verified = otp.token && otp.mobile === v;
    $('#verifyBtn').hidden = !OTP_REQUIRED || !isMobile(v) || verified || !$('#otpBox').hidden;
    $('#verifiedChip').hidden = !verified;
    mobileEl.classList.toggle('locked', !!verified);
    mobileEl.readOnly = !!verified || !$('#otpBox').hidden;
    updateProgress();
  }
  mobileEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
    if (otp.mobile && otp.mobile !== e.target.value) { otp.token = null; otp.mobile = null; }
    refreshVerifyUi();
  });
  $('#verifyBtn').addEventListener('click', () => sendOtp());

  function startTimer(sec) {
    clearInterval(otp.timer); otp.left = sec;
    const tick = () => {
      $('#otpTimer').textContent = otp.left > 0 ? `Resend in ${otp.left}s` : "Didn't get it?";
      $('#resendBtn').disabled = otp.left > 0; otp.left--;
      if (otp.left < -1) clearInterval(otp.timer);
    };
    tick(); otp.timer = setInterval(tick, 1000);
  }
  async function sendOtp() {
    const m = mobileEl.value;
    setErr('mobile', '');
    if (!isMobile(m)) { setErr('mobile', 'Enter a valid 10-digit mobile number first.'); mobileEl.focus(); return false; }
    const vb = $('#verifyBtn'); vb.disabled = true; vb.textContent = 'Sending…';
    try {
      const r = await fetch('/api/otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: m }) });
      const j = await r.json();
      if (!r.ok && !j.resendIn) { setErr('mobile', j.error || 'Could not send OTP.'); return false; }
      $('#otpBox').hidden = false;
      $('#otpSentTo').textContent = `Sent to +91 ${m.slice(0, 5)} ${m.slice(5)}`;
      $('#otpErr').textContent = r.ok ? '' : j.error;
      $('#otpDemo').hidden = !j.demoOtp;
      if (j.demoOtp) $('#otpDemo').textContent = `Test mode: no SMS is sent. Your OTP is ${j.demoOtp}`;
      otpInputs.forEach((i) => { i.value = ''; });
      otpInputs[0].focus();
      startTimer(j.resendIn || 30);
      return true;
    } catch { setErr('mobile', 'Network problem — please try again.'); return false; }
    finally { vb.disabled = false; vb.textContent = 'Verify'; refreshVerifyUi(); }
  }
  $('#resendBtn').addEventListener('click', () => sendOtp());
  $('#changeNum').addEventListener('click', () => {
    clearInterval(otp.timer); $('#otpBox').hidden = true; otp.token = null; otp.mobile = null;
    mobileEl.readOnly = false; refreshVerifyUi(); mobileEl.focus(); mobileEl.select();
  });

  otpInputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && i < 5) otpInputs[i + 1].focus();
      if (otpInputs.every((x) => x.value)) verifyOtp();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) otpInputs[i - 1].focus(); });
    inp.addEventListener('paste', (e) => {
      const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (d.length === 6) { e.preventDefault(); d.split('').forEach((c, k) => { otpInputs[k].value = c; }); verifyOtp(); }
    });
  });
  async function verifyOtp() {
    const code = otpInputs.map((x) => x.value).join(''), m = mobileEl.value;
    $('#otpErr').textContent = 'Verifying…';
    try {
      const r = await fetch('/api/otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: m, otp: code }) });
      const j = await r.json();
      if (!r.ok) {
        $('#otpErr').textContent = j.error || 'Incorrect OTP.';
        const box = $('#otpInputs'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        otpInputs.forEach((x) => { x.value = ''; }); otpInputs[0].focus();
        if (j.expired) { $('#resendBtn').disabled = false; clearInterval(otp.timer); $('#otpTimer').textContent = ''; }
        return;
      }
      otp.token = j.token; otp.mobile = m; clearInterval(otp.timer);
      $('#otpBox').hidden = true; $('#otpErr').textContent = '';
      refreshVerifyUi();
      if (otp.submitAfter) { otp.submitAfter = false; form.requestSubmit(); }
      else $('#city').focus();
    } catch { $('#otpErr').textContent = 'Network problem — please try again.'; }
  }

  // ---------- validation & submit ----------
  function setErr(field, msg) {
    const el = form.querySelector(`.err[data-for="${field}"]`);
    if (el) el.textContent = msg || '';
    const inp = form.querySelector(`[name="${field}"]`);
    if (inp && inp.type !== 'radio' && inp.type !== 'checkbox') inp.classList.toggle('invalid', !!msg);
  }
  function validate(d) {
    const e = {};
    if (!/^[A-Za-zऀ-ॿ .'-]{2,80}$/.test(d.student_name.trim())) e.student_name = 'Please enter your full name (letters only).';
    if (!isMobile(d.mobile)) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Enter a valid email address.';
    if (d.city.trim().length < 2) e.city = 'Please enter your city or district.';
    if (!d.programme) e.course = 'Please choose your preferred programme.';
    else if (!programmeChosen()) e.course = `Please choose your ${d.programme} branch.`;
    if (!d.consent) e.consent = 'Please tick the box so our team can contact you.';
    return e;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = {
      student_name: $('#student_name').value, mobile: mobileEl.value, email: $('#email').value.trim(), city: $('#city').value.trim(),
      level, programme: sel.programme || '', branch: sel.branch || '', course: sel.programme ? courseText() : '',
      consent: $('#consent').checked, website: form.website.value, ref: REF, src: SRC, otpToken: otp.mobile === mobileEl.value ? otp.token : null,
    };
    ['student_name', 'mobile', 'email', 'city', 'course', 'consent'].forEach((f) => setErr(f, ''));
    $('#formMsg').textContent = '';
    const errs = validate(d);
    if (Object.keys(errs).length) {
      Object.entries(errs).forEach(([k, v]) => setErr(k, v));
      const first = form.querySelector('.invalid') || form.querySelector('.err:not(:empty)');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (OTP_REQUIRED && !d.otpToken) {
      // Not verified yet: send the OTP and submit automatically once it is verified.
      otp.submitAfter = true;
      if ($('#otpBox').hidden) await sendOtp();
      $('#otpBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#formMsg').textContent = 'One last step — verify your mobile number with the OTP we sent.';
      return;
    }
    const btn = $('#submitBtn');
    btn.disabled = true; btn.querySelector('.cta-txt').textContent = 'Submitting…';
    try {
      const r = await fetch('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const j = await r.json();
      if (!r.ok) {
        if (j.needOtp) { otp.token = null; refreshVerifyUi(); otp.submitAfter = true; await sendOtp(); }
        if (j.fields) Object.entries(j.fields).forEach(([k, v]) => setErr(k, v));
        $('#formMsg').textContent = j.error || 'Could not submit. Please try again.';
        return;
      }
      showSuccess(j, d);
    } catch {
      $('#formMsg').textContent = 'Network problem — please check your connection and try again.';
    } finally {
      btn.disabled = false; btn.querySelector('.cta-txt').textContent = 'Start my journey';
    }
  });

  function showSuccess(j, d) {
    const first = (j.name || d.student_name).trim().split(' ')[0];
    $('#successTitle').textContent = j.duplicate ? `Welcome back, ${first}!` : `You're on your way, ${first}!`;
    $('#successMsg').textContent = j.duplicate
      ? `We already have your enquiry for ${d.course}. Our counsellor will be in touch soon.`
      : `Thank you for choosing ${d.course}. Our admission counsellor will contact you shortly.`;
    $('#refNo').textContent = j.ref_no;
    $('#smsNote').hidden = !j.smsSent || j.duplicate;
    $('#smsNote').textContent = `📱 A confirmation message (WhatsApp / SMS) is on its way to +91 ${d.mobile.slice(0, 5)} ${d.mobile.slice(5)}`;
    $('#formCard').classList.add('hidden');
    $('#successCard').classList.remove('hidden');
    window.scrollTo({ top: $('#successCard').offsetTop - 20, behavior: 'smooth' });
    confetti();
  }

  $('#againBtn').addEventListener('click', () => {
    form.reset(); sel.programme = null; sel.branch = null; setLevel('UG'); $('#regionBadge').hidden = true;
    otp.token = null; otp.mobile = null; $('#otpBox').hidden = true; refreshVerifyUi();
    $('#successCard').classList.add('hidden'); $('#formCard').classList.remove('hidden');
  });

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('#confetti'), ctx = c.getContext('2d');
    const W = (c.width = c.offsetWidth * devicePixelRatio), H = (c.height = c.offsetHeight * devicePixelRatio);
    const cols = ['#F08A24', '#0B1F4B', '#ffb347', '#3b82f6', '#16a34a'];
    const ps = Array.from({ length: 120 }, () => ({ x: W / 2, y: H * 0.25, vx: (Math.random() - 0.5) * 18, vy: Math.random() * -16 - 4,
      s: (Math.random() * 6 + 4) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0] }));
    let t = 0;
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      ps.forEach((p) => { p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      if (++t < 160) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })();
  }

  // let the chatbot's "Request a call back" focus the form
  window.addEventListener('adypu:callback', () => { $('#student_name').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('#student_name').focus(), 400); });
})();
