// ❓ Simple in-app guide — a floating button on every staff screen
(() => {
  const GUIDE = {
    admin: ['👑 Admin', [
      ['📱', 'Get enquiries', 'Print the <b>QR poster</b> (top bar) or share the website link. Every enquiry arrives here instantly. The same mobile number is never saved twice.'],
      ['📂', 'Open a student', 'Click any <b>student name</b>. You see everything about them and a <b>Suggested next step</b> — just press <b>Do it →</b>.'],
      ['📞', 'Call or WhatsApp', 'In the student panel: <b>📞 Call</b>, <b>📲 WhatsApp call</b> or <b>💬 WhatsApp message</b> (ready-made texts). After the call, tap the result — it takes 10 seconds.'],
      ['👥', 'Give calls to the team', 'Tick students in the table → choose a caller → <b>Assign</b>. Or share a whole region fairly, or give them to the 🤖 AI caller.'],
      ['🎓', 'Send the admission form', 'Panel → <b>🎓 Admission form</b> → Provisional / Permanent → <b>Create link</b> → send on WhatsApp or email.'],
      ['💳', 'Confirm the fee', '<b>Admissions</b> tab → check the payment in your bank → <b>✓ Verify</b>. The student becomes <b>Admitted</b> and gets a receipt.'],
      ['⬇', 'Download data', '<b>⬇ Download</b> → tick the columns → Excel or PDF. You get an alert email for every download.'],
    ]],
    counsellor: ['👤 Counsellor', [
      ['➕', 'Add students', 'Add one student, or upload an Excel / CSV list. Type the <b>Source</b> (e.g. "School fair – Podar") and <b>Location</b> first — they are saved on every student.'],
      ['👥', 'Make your calling team', '<b>My calling team</b> → create a caller (name, username, mobile). Share the login details with them.'],
      ['📋', 'Give students to callers', 'In <b>My students</b> tick students → choose a caller → <b>Assign selected</b>, or <b>Share among all my callers</b>.'],
      ['📂', 'Open a student', 'Click the name → follow the <b>Suggested next step</b>: call, WhatsApp, send the admission form.'],
    ]],
    caller: ['📞 Caller', [
      ['📅', 'See who to call', '<b>Due today</b> and <b>Overdue</b> come first. Numbers are hidden until you press Call.'],
      ['📞', 'Call', 'Press <b>📞 Call</b> (phone) or <b>📲 WhatsApp</b>. Then choose the result (✅ Connected, 📵 Not picked …), the status and the next follow-up date.'],
      ['🎓', 'Interested student?', 'Open the student (name) → <b>🎓 Admission form</b> → create the link → send it on WhatsApp.'],
    ]],
  };
  const STAGES = ['New', 'Contacted', 'Interested', 'Counselling Done', 'Form Sent', 'Applied', 'Admitted'];
  let role = location.pathname.startsWith('/admin') ? 'admin' : 'counsellor';
  const detect = () => { const c = document.getElementById('callSec'); if (c && !c.hidden) role = 'caller'; return role; };
  const html = `<button class="help-fab" id="helpFab" type="button" aria-label="Help">❓ <span>Help</span></button>
    <div class="modal" id="helpModal" hidden><div class="modal-box wide help-box">
      <header class="modal-h"><b>❓ How to use the Admission CRM</b><button class="icon" data-close type="button" aria-label="Close">✕</button></header>
      <div class="modal-b"><div class="help-tabs">${Object.entries(GUIDE).map(([k, g]) => `<button type="button" data-r="${k}" class="${k === role ? 'on' : ''}">${g[0]}</button>`).join('')}</div>
        <div id="helpSteps"></div>
        <div class="help-stages"><b>A student's journey</b><div>${STAGES.map((s, i) => `<span>${s}</span>${i < STAGES.length - 1 ? '<i>→</i>' : ''}`).join('')}</div>
          <small>🔥 Hot · 🌤 Warm · ❄ Cold — the colour tag on each student shows how likely they are to join.</small></div>
        <p class="small muted">🔒 Everything you do is recorded. Phone numbers are shown only to the people allowed to call. Never share your password.</p>
      </div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const show = (r) => {
    document.querySelectorAll('#helpModal .help-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.r === r));
    document.getElementById('helpSteps').innerHTML = `<ol class="help-steps">${GUIDE[r][1].map(([i, t, d], n) => `<li><span class="hs-n">${n + 1}</span><span class="hs-i">${i}</span><div><b>${t}</b><p>${d}</p></div></li>`).join('')}</ol>`;
  };
  document.getElementById('helpFab').addEventListener('click', () => { show(detect()); document.getElementById('helpModal').hidden = false; });
  document.getElementById('helpModal').addEventListener('click', (e) => {
    const b = e.target.closest('.help-tabs button'); if (b) return show(b.dataset.r);
    if (e.target.matches('[data-close]') || e.target.id === 'helpModal') document.getElementById('helpModal').hidden = true;
  });
  // first visit: open the guide once
  try { if (!localStorage.getItem('crmHelpSeen')) { localStorage.setItem('crmHelpSeen', '1'); setTimeout(() => document.getElementById('helpFab').click(), 1200); } } catch {}
})();
