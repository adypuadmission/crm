// CRM 3.0: student panel (timeline, WhatsApp / email templates, duplicates & merge), counsellor → caller hierarchy,
// online admission form + fee payment, and the AI caller.
const crypto = require('crypto');
const path = require('path');
const FORM = require('./appform');
const tenant = require('./tenant');
const { LEVELS, isValid, tuitionFee, feeYear, FEE_TABLE, courseLabel } = require('./courses');

module.exports = function plus(app, C) {
  const { db, sec, audit } = C;
  const now = () => new Date().toISOString();
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const rs = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN'); // the PDF font has no ₹ sign
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const base = (req) => C.siteUrl(req);
  const istDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  const fmtIST = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const actorName = (u) => (u.role === 'admin' ? C.ADMIN_NAME() : u.name);
  const parseId = (v) => parseInt(v, 10) || 0;

  // admin OR team member (counsellor / caller)
  function requireAny(req, res, next) {
    const t = C.readToken(req);
    if (t && (t.role || 'admin') === 'admin') return C.requireAdmin(req, res, next);
    return C.requireSub(req, res, next);
  }
  const canSee = (u, row) => !!row && (u.role === 'admin' || C.teamRow(row, u));
  async function canDial(u, row) {
    if (u.role === 'admin') return true;
    if (row.caller_id === u.id && (await db.getSetting('assigned_calling', true))) return true;
    if (u.kind === 'counsellor' && (u.team || []).includes(row.caller_id) && (await db.getSetting('assigned_calling', true))) return true;
    return !!(await db.getSetting('allow_reveal', false));
  }
  const view = (u, row) => (u.role === 'admin' ? row : C.masked(row));
  async function loadRow(req, res) {
    const row = await db.getEnquiry(parseId(req.params.id));
    if (!canSee(req.user, row)) { if (row) audit(req, 'student_panel_denied', `id ${req.params.id}`, 'high'); res.status(404).json({ error: 'Not found' }); return null; }
    return row;
  }

  // ---------- email relay capability (Google Apps Script v2 can email students) ----------
  let relay = { at: 0, ok: false };
  async function studentEmailReady() {
    const m = C.getMailer(); if (!m) return false;
    if (!process.env.MAIL_WEBHOOK_URL) return true; // SMTP can send anywhere
    if (Date.now() - relay.at < 10 * 60 * 1000) return relay.ok;
    try { const r = await fetch(process.env.MAIL_WEBHOOK_URL, { redirect: 'follow', signal: AbortSignal.timeout(8000) }); relay = { at: Date.now(), ok: /adypu-mailer v2/.test(await r.text()) }; }
    catch { relay = { at: Date.now(), ok: false }; }
    return relay.ok;
  }
  async function emailStudent(row, subject, text, fromName) {
    if (!row.email) throw new Error('This student has no email address.');
    if (!(await studentEmailReady())) throw new Error('Student email is not switched on yet (the Google mailer script needs version 2 — see Admissions tab).');
    const s = await db.getSetting('admission_settings', {});
    const safe = String(text).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c])).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
    await C.getMailer().sendMail({ to: row.email, subject, text, name: fromName || 'ADYPU Admissions', replyTo: s.replyTo || undefined,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px"><div style="background:#0B1F4B;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><b>Ajeenkya DY Patil University, Pune</b><div style="font-size:12px;color:#FFD8A8">Admissions ${C.ACADEMIC_YEAR()}</div></div><div style="border:1px solid #e2e8f0;border-top:0;padding:18px;border-radius:0 0 10px 10px;font-size:14.5px;line-height:1.6;color:#0f172a">${safe}</div></div>` });
  }

  // ---------- student panel ----------
  async function appsFor(enquiryId, req, withLink) {
    const apps = await db.all('SELECT * FROM applications WHERE enquiry_id = $1 ORDER BY id DESC', [enquiryId]);
    const out = [];
    for (const a of apps) {
      const pays = await db.all('SELECT id, amount, mode, reference, status, receipt_no, created_at, verified_at FROM payments WHERE application_id = $1 ORDER BY id DESC', [a.id]);
      out.push({ id: a.id, app_no: a.app_no, type: a.admission_type, status: a.status, programme: a.programme, fee: a.fee_amount, paid: a.paid_amount || 0,
        created_at: a.created_at, submitted_at: a.submitted_at, created_by: a.created_by, payments: pays, link: withLink ? `${base(req)}/apply/${sec.decrypt(a.token_enc)}` : undefined });
    }
    return out;
  }
  app.get('/api/student/:id', requireAny, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    const [calls, events, apps] = await Promise.all([db.listCalls(row.id), db.listEvents(row.id), appsFor(row.id, req, true)]);
    let dup = null;
    const firstId = row.dup_of || row.id;
    const group = (await db.all('SELECT id, ref_no, created_by_name, counsellor_name, created_at, course, status FROM enquiries WHERE id = $1 OR dup_of = $1 ORDER BY id', [firstId]));
    if (group.length > 1) dup = { first: firstId, list: group.map((g) => ({ id: g.id, ref: g.ref_no, by: g.created_by_name || 'Website / QR', course: g.course, status: g.status, at: new Date(g.created_at).toISOString() })) };
    const fee = tuitionFee(row.level, row.programme, row.branch);
    res.json({ outcomes: C.CALL_OUTCOMES, statuses: C.STATUSES, provisionalFee: (await admSettings()).provisionalFee, row: view(req.user, row), calls, events: events.map((e) => ({ ...e, at: new Date(e.at).toISOString() })), apps, dup, fee, feeYear: feeYear(),
      canDial: await canDial(req.user, row), emailReady: !!row.email && (await studentEmailReady()), hasEmail: !!row.email, me: { role: req.user.role, name: actorName(req.user) } });
  });
  // WhatsApp (opens the sender's own WhatsApp with the text ready) — the number is released only for allowed users
  app.post('/api/student/:id/whatsapp', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    if (!(await canDial(req.user, row))) { audit(req, 'whatsapp_denied', row.ref_no, 'medium'); return res.status(403).json({ error: 'You can WhatsApp only students assigned to you for calling. Ask the admin, or send the message by email.' }); }
    const text = String(req.body.text || '').slice(0, 1500);
    await db.addEvent(row.id, actorName(req.user), 'whatsapp', `WhatsApp: ${String(req.body.template || 'message')}`);
    audit(req, 'whatsapp_opened', `${row.ref_no} · ${req.body.template || 'message'}`, 'info');
    res.json({ url: `https://wa.me/91${row.mobile}?text=${encodeURIComponent(text)}` });
  });
  // One-tap calling: normal phone call or WhatsApp call. The number is released only to allowed users, rate-limited and audited.
  const dialCount = new Map();
  app.post('/api/student/:id/dial', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    if (!(await canDial(req.user, row))) { audit(req, 'dial_denied', row.ref_no, 'medium'); return res.status(403).json({ error: 'You can call only students assigned to you for calling. Ask the admin.' }); }
    const key = actorName(req.user), hour = Math.floor(Date.now() / 3600e3), c = dialCount.get(key);
    const n = c && c.hour === hour ? c.n + 1 : 1; dialCount.set(key, { hour, n });
    if (n > 80 && req.user.role !== 'admin') { audit(req, 'dial_limit', `${key}: ${n} numbers in an hour`, 'high'); return res.status(429).json({ error: 'Too many numbers opened in one hour. Please wait.' }); }
    const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'phone';
    audit(req, channel === 'whatsapp' ? 'whatsapp_call_started' : 'phone_call_started', row.ref_no, 'info');
    res.json({ tel: `tel:+91${row.mobile}`, wa: `https://wa.me/91${row.mobile}`, channel });
  });
  // Log the result of a call (phone / WhatsApp) from the student panel — works for admin, counsellors and callers
  app.post('/api/student/:id/call', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    const b = req.body || {};
    if (!C.CALL_OUTCOMES.includes(b.outcome)) return res.status(400).json({ error: 'Choose the call result.' });
    if (b.status && !C.STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
    const next = C.validDate(b.next_action_date);
    const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'call';
    await db.logCall({ enquiry_id: row.id, user_id: req.user.id || null, user_name: actorName(req.user), channel, outcome: b.outcome, feedback: String(b.feedback || '').slice(0, 600), status_after: b.status || row.status, next_action_date: next });
    const upd = { next_action_date: next }; if (b.status && b.status !== row.status) upd.status = b.status;
    await db.updateEnquiry(row.id, upd);
    await db.addEvent(row.id, actorName(req.user), 'call', `${channel === 'whatsapp' ? 'WhatsApp call' : 'Call'}: ${b.outcome}${upd.status ? ' · status → ' + upd.status : ''}`);
    audit(req, 'call_logged', `${row.ref_no}: ${b.outcome}`, 'info');
    res.json({ ok: true });
  });
  app.post('/api/student/:id/email', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    const subject = C.clean(req.body.subject, 140) || `ADYPU Admissions ${C.ACADEMIC_YEAR()}`, text = String(req.body.text || '').slice(0, 4000);
    if (text.trim().length < 5) return res.status(400).json({ error: 'Please write the message.' });
    try { await emailStudent(row, subject, text, req.user.role === 'admin' ? 'ADYPU Admissions' : `${req.user.name} · ADYPU Admissions`); }
    catch (e) { return res.status(400).json({ error: e.message.slice(0, 200) }); }
    await db.addEvent(row.id, actorName(req.user), 'email', `Email: ${subject}`);
    audit(req, 'student_emailed', `${row.ref_no} · ${subject}`, 'info');
    res.json({ ok: true });
  });
  app.post('/api/student/:id/note', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    const text = C.clean(req.body.text, 400); if (!text) return res.status(400).json({ error: 'Write a note' });
    await db.addEvent(row.id, actorName(req.user), 'note', text); res.json({ ok: true });
  });

  // ---------- duplicates (admin) ----------
  app.post('/api/admin/students/:id/merge', C.requireAdmin, C.requireXhr, async (req, res) => {
    const drop = await db.getEnquiry(parseId(req.params.id)), keep = await db.getEnquiry(parseId(req.body.into));
    if (!drop || !keep || drop.id === keep.id) return res.status(400).json({ error: 'Choose the entry to keep.' });
    const order = C.STATUSES.filter((s) => s !== 'Not Interested');
    const best = order.indexOf(drop.status) > order.indexOf(keep.status) ? drop.status : keep.status;
    const notes = [keep.notes, drop.notes && drop.notes !== keep.notes ? `[from ${drop.ref_no}] ${drop.notes}` : ''].filter(Boolean).join(' | ').slice(0, 500);
    await db.mergeInto(keep.id, drop.id);
    await db.updateEnquiry(keep.id, { status: best, notes, ...(keep.email ? {} : {}), ...(!keep.data_source && drop.data_source ? { data_source: drop.data_source, data_location: drop.data_location } : {}),
      ...(!keep.caller_id && drop.caller_id ? {} : {}) });
    if (!keep.caller_id && drop.caller_id) await db.assignMany([keep.id], { id: drop.caller_id, name: drop.caller_name });
    await db.addEvent(keep.id, C.ADMIN_NAME(), 'merge', `Merged duplicate ${drop.ref_no} (${drop.course}, added by ${drop.created_by_name || 'website'}) into this entry`);
    await db.relinkDuplicates();
    audit(req, 'duplicate_merged', `${drop.ref_no} → ${keep.ref_no}`, 'medium');
    res.json({ ok: true, keep: keep.ref_no });
  });
  app.post('/api/admin/students/:id/not-duplicate', C.requireAdmin, C.requireXhr, async (req, res) => {
    const row = await db.getEnquiry(parseId(req.params.id)); if (!row) return res.status(404).json({ error: 'Not found' });
    await db.updateEnquiry(row.id, { dup_of: null }); await db.run("UPDATE enquiries SET email_hash = '-' WHERE id = $1 AND email_hash IS NOT NULL", [row.id]);
    await db.addEvent(row.id, C.ADMIN_NAME(), 'merge', 'Marked as not a duplicate'); res.json({ ok: true });
  });

  // ---------- counsellor → own calling team ----------
  const requireCounsellor = (req, res, next) => C.requireSub(req, res, () => (req.user.kind === 'counsellor' ? next() : res.status(403).json({ error: 'Only counsellors can manage a calling team.' })));
  async function myCallers(me) { return (await db.listUsers()).filter((u) => u.kind === 'caller' && u.parent_id === me.id); }
  app.get('/api/team/my-team', requireCounsellor, async (req, res) => {
    const callers = await myCallers(req.user), rows = await db.listEnquiries({ scopeUser: req.user.id, scopeCallers: callers.map((c) => c.id) }), t = C.istToday();
    const ai = await aiUser(); const aiOn = (await aiSettings()).enabled;
    res.json({ aiCaller: aiOn ? { id: ai.id, name: ai.name, connected: provider() !== 'none' } : null, callers: callers.map((u) => { const mine = rows.filter((r) => r.caller_id === u.id);
      return { id: u.id, name: u.name, username: u.username, active: u.active, last_login: u.last_login, mobile: sec.maskMobile(u.mobile), assigned: mine.length, called: mine.filter((r) => r.call_count > 0).length,
        untouched: mine.filter((r) => !r.call_count && r.status === 'New').length, overdue: mine.filter((r) => r.next_action_date && r.next_action_date < t && !['Admitted', 'Not Interested'].includes(r.status)).length,
        interested: mine.filter((r) => ['Interested', 'Counselling Done', 'Form Sent', 'Applied', 'Admitted'].includes(r.status)).length }; }) });
  });
  app.post('/api/team/my-team', requireCounsellor, C.requireXhr, async (req, res) => {
    const name = C.clean(req.body.name, 60), username = C.clean(req.body.username, 30).toLowerCase(), mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10);
    const password = String(req.body.password || '') || C.genPassword();
    if (name.length < 2) return res.status(400).json({ error: 'Please enter the full name.' });
    if (!/^[a-z0-9._-]{3,30}$/.test(username) || username === C.ADMIN_USER().toLowerCase()) return res.status(400).json({ error: 'Username: 3–30 letters, numbers, dot, dash or underscore.' });
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a 10-digit mobile number.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if ((await myCallers(req.user)).length >= 25) return res.status(400).json({ error: 'You can have at most 25 callers. Ask the admin for more.' });
    if (await db.getUserAuth(username)) return res.status(409).json({ error: 'That username is already taken.' });
    const user = await db.createUser({ name, username, mobile, kind: 'caller', parent_id: req.user.id, pass_hash: await C.bcrypt.hash(password, 12) });
    audit(req, 'caller_created_by_counsellor', `${name} (@${username}) in the team of ${req.user.name}`, 'medium');
    res.json({ ok: true, user: { ...user, mobile: sec.maskMobile(user.mobile) }, password });
  });
  app.patch('/api/team/my-team/:id', requireCounsellor, C.requireXhr, async (req, res) => {
    const u = await db.getUser(parseId(req.params.id));
    if (!u || u.parent_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const upd = {}; let password;
    if (req.body.active !== undefined) { upd.active = !!req.body.active; audit(req, upd.active ? 'account_enabled' : 'account_disabled', `${u.name} (by ${req.user.name})`, 'info'); }
    if (req.body.resetPassword) { password = C.genPassword(); upd.pass_hash = await C.bcrypt.hash(password, 12); audit(req, 'password_reset', `${u.name} (by ${req.user.name})`, 'info'); }
    const user = await db.updateUser(u.id, upd);
    res.json({ ok: true, user: { ...user, mobile: sec.maskMobile(user.mobile) }, password });
  });
  // counsellor assigns their own students to one of their callers (or the AI caller), or shares them fairly
  app.post('/api/team/assign', requireCounsellor, C.requireXhr, async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(parseId).filter(Boolean))].slice(0, 2000);
    const callers = await myCallers(req.user), ai = await aiUser(), aiOn = (await aiSettings()).enabled;
    const allowed = new Map(callers.filter((c) => c.active).map((c) => [c.id, c])); if (aiOn) allowed.set(ai.id, ai);
    const targets = (Array.isArray(req.body.callers) ? req.body.callers : [req.body.caller_id]).map(parseId).filter((id) => allowed.has(id)).map((id) => allowed.get(id));
    const unassign = req.body.caller_id === null || req.body.caller_id === '';
    if (!ids.length) return res.status(400).json({ error: 'Select at least one student.' });
    if (!targets.length && !unassign) return res.status(400).json({ error: 'Choose a caller from your team.' });
    const rows = [];
    for (const id of ids) { const r = await db.getEnquiry(id); if (r && C.teamRow(r, req.user)) rows.push(r); }
    if (!rows.length) return res.status(400).json({ error: 'None of those students are yours.' });
    if (unassign) { await db.assignMany(rows.map((r) => r.id), null); rows.forEach((r) => db.addEvent(r.id, req.user.name, 'assign', 'Caller removed').catch(() => {})); return res.json({ ok: true, assigned: rows.length, result: [] }); }
    const plan = new Map(targets.map((t) => [t.id, []]));
    rows.forEach((r, i) => plan.get(targets[i % targets.length].id).push(r.id));
    const result = [];
    for (const t of targets) { const list = plan.get(t.id); if (!list.length) continue; await db.assignMany(list, t); list.forEach((id) => db.addEvent(id, req.user.name, 'assign', `Calling → ${t.name}`).catch(() => {})); result.push({ name: t.name, count: list.length }); }
    audit(req, 'calls_assigned', `${rows.length} students by ${req.user.name}: ${result.map((x) => `${x.name} ${x.count}`).join(', ')}`, 'info');
    res.json({ ok: true, assigned: rows.length, result });
  });

  // ---------- admission settings ----------
  const DEF_SETTINGS = { provisionalFee: 25000, permanentMode: 'tuition', permanentFee: 0, upiId: '', payee: 'Ajeenkya DY Patil University', bankName: '', accountName: '', accountNo: '', ifsc: '', bankBranch: '',
    campusNote: 'Cash / Demand Draft / Cheque at the Admission Office, D Y Patil Knowledge City, Charholi Bk., Pune', replyTo: '', online: true };
  const admSettings = async () => ({ ...JSON.parse(tenant.brand(JSON.stringify(DEF_SETTINGS))), ...(await db.getSetting('admission_settings', {})) });
  const razor = () => (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? { key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET } : null);
  app.get('/api/admin/admission-settings', C.requireAdmin, async (_req, res) => res.json({ settings: await admSettings(), razorpay: !!razor(), emailReady: await studentEmailReady(),
    whatsappApi: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID), aiReady: provider() !== 'none',
    relaySecret: !!process.env.MAIL_WEBHOOK_SECRET, feeYear: feeYear(), feeTable: FEE_TABLE }));
  app.put('/api/admin/admission-settings', C.requireAdmin, C.requireXhr, async (req, res) => {
    const b = req.body || {}, cur = await admSettings(), s = { ...cur };
    for (const k of ['upiId', 'payee', 'bankName', 'accountName', 'accountNo', 'ifsc', 'bankBranch', 'campusNote', 'replyTo']) if (b[k] !== undefined) s[k] = C.clean(b[k], k === 'campusNote' ? 200 : 80);
    for (const k of ['provisionalFee', 'permanentFee']) if (b[k] !== undefined) s[k] = Math.max(0, Math.min(5000000, parseInt(b[k], 10) || 0));
    if (b.permanentMode !== undefined) s.permanentMode = b.permanentMode === 'fixed' ? 'fixed' : 'tuition';
    if (b.online !== undefined) s.online = !!b.online;
    if (s.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(s.upiId)) return res.status(400).json({ error: 'UPI ID looks wrong (example: adypu@sbi).' });
    if (s.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.replyTo)) return res.status(400).json({ error: 'Reply-to email looks wrong.' });
    await db.setSetting('admission_settings', s);
    audit(req, 'setting_changed', 'admission & payment settings updated', 'medium');
    res.json({ ok: true, settings: s });
  });
  async function feeFor(type, level, programme, branch) {
    const s = await admSettings();
    if (type === 'Provisional') return s.provisionalFee;
    if (s.permanentMode === 'fixed' && s.permanentFee) return s.permanentFee;
    return tuitionFee(level, programme, branch) || s.permanentFee || 0;
  }

  // ---------- applications: create / send ----------
  const TYPES = ['Provisional', 'Permanent'];
  async function createApplication(row, type, by) {
    const open = await db.get("SELECT * FROM applications WHERE enquiry_id = $1 AND status NOT IN ('Cancelled', 'Paid') ORDER BY id DESC LIMIT 1", [row.id]);
    if (open) {
      if (open.status === 'Sent' || open.status === 'Opened') {
        const data = JSON.parse(sec.decrypt(open.data) || '{}');
        await db.updateRow('applications', open.id, { admission_type: type, fee_amount: await feeFor(type, data.level || row.level, data.programme || row.programme, data.branch ?? row.branch), updated_at: now() });
      }
      return { app: await db.get('SELECT * FROM applications WHERE id = $1', [open.id]), reused: true };
    }
    const token = crypto.randomBytes(18).toString('base64url');
    const id = await db.insertRow('applications', { enquiry_id: row.id, token_hash: sha(token), token_enc: sec.encrypt(token), admission_type: type, status: 'Sent',
      programme: row.course, created_by: by, created_at: now(), updated_at: now(), fee_amount: await feeFor(type, row.level, row.programme, row.branch), paid_amount: 0,
      data: sec.encrypt(JSON.stringify({ level: row.level, programme: row.programme, branch: row.branch || '', email: row.email || '', first_name: row.student_name.split(' ')[0], last_name: row.student_name.split(' ').slice(1).join(' ') })) });
    const pre = ['New', 'Contacted', 'Interested', 'Counselling Done'];
    await db.updateEnquiry(row.id, { app_status: 'Form sent', admission_type: type, ...(pre.includes(row.status) ? { status: 'Form Sent' } : {}) });
    await db.addEvent(row.id, by, 'form', `${type} admission form link created`);
    return { app: await db.get('SELECT * FROM applications WHERE id = $1', [id]), reused: false };
  }
  app.post('/api/student/:id/application', requireAny, C.requireXhr, async (req, res) => {
    const row = await loadRow(req, res); if (!row) return;
    const type = TYPES.includes(req.body.type) ? req.body.type : 'Provisional';
    const { app: a, reused } = await createApplication(row, type, actorName(req.user));
    const link = `${base(req)}/apply/${sec.decrypt(a.token_enc)}`;
    audit(req, 'admission_form_link', `${row.ref_no} · ${type}${reused ? ' (existing link)' : ''}`, 'info');
    let emailed = false;
    if (req.body.email) {
      try { await emailStudent(row, `Your ADYPU admission form – ${row.course}`, formMessage(row, link, type, actorName(req.user)), 'ADYPU Admissions'); emailed = true; await db.addEvent(row.id, actorName(req.user), 'email', 'Admission form link emailed'); }
      catch (e) { return res.json({ ok: true, link, reused, emailError: e.message }); }
    }
    res.json({ ok: true, link, reused, emailed, fee: a.fee_amount, type: a.admission_type });
  });
  const formMessage = (row, link, type, by) => tenant.brand(`Dear ${row.student_name.split(' ')[0]},\n\nGreetings from Ajeenkya DY Patil University, Pune!\n\nPlease fill your ${type.toLowerCase()} admission form for ${row.course} here:\n${link}\n\nIt takes about 10 minutes. Keep your marksheets and a passport-size photo ready. After submitting, you can pay the admission fee online, by UPI, bank transfer or at the campus.\n\nFor any help, reply to this message.\n\nRegards,\n${by}\nAdmission Office, ADYPU`);

  // ---------- public: the student's application ----------
  const appLimiter = C.rateLimit({ windowMs: 10 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });
  async function appByToken(token) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ''))) return null;
    return db.get('SELECT * FROM applications WHERE token_hash = $1', [sha(token)]);
  }
  app.get('/apply/:token', async (req, res) => C.sendView(res, 'apply.html'));
  app.get('/apply/:token/receipt/:pid.pdf', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a) return res.status(404).send('Not found');
    const p = await db.get('SELECT * FROM payments WHERE id = $1 AND application_id = $2', [parseId(req.params.pid), a.id]);
    if (!p || !['Verified', 'Paid online'].includes(p.status)) return res.status(404).send('Receipt not available yet');
    receiptPdf(res, a, p);
  });
  async function publicState(a) {
    const row = await db.getEnquiry(a.enquiry_id);
    const data = JSON.parse(sec.decrypt(a.data) || '{}');
    const files = (await db.all('SELECT id, kind, name, mime, size FROM app_files WHERE application_id = $1', [a.id]));
    const pays = await db.all('SELECT id, amount, mode, reference, status, receipt_no, created_at FROM payments WHERE application_id = $1 ORDER BY id DESC', [a.id]);
    const s = await admSettings();
    const pay = ['Submitted', 'Payment pending', 'Part paid', 'Paid'].includes(a.status) ? { upi: !!s.upiId, upiId: s.upiId, payee: s.payee,
      bank: s.accountNo ? { bankName: s.bankName, accountName: s.accountName, accountNo: s.accountNo, ifsc: s.ifsc, branch: s.bankBranch } : null,
      campus: s.campusNote, online: !!razor() && s.online } : null;
    const c = row ? await C.counsellorOf(row) : null;
    return { app: { app_no: a.app_no, status: a.status, type: a.admission_type, fee: a.fee_amount || 0, paid: a.paid_amount || 0, submitted_at: a.submitted_at },
      student: row ? { name: row.student_name, mobile: sec.maskMobile(row.mobile), ref: row.ref_no } : {}, data, files, payments: pays, pay, counsellor: c,
      contacts: C.CONTACTS(), schema: JSON.parse(tenant.brand(JSON.stringify({ sections: FORM.SECTIONS, docs: FORM.DOCS }))), brand: { name: tenant.cur().name, short: tenant.cur().short, city: tenant.cur().city, logo: tenant.cur().slug && tenant.cur().hasLogo ? tenant.base() + '/logo' : '' }, levels: LEVELS, feeTable: FEE_TABLE, feeYear: feeYear(), year: C.ACADEMIC_YEAR() };
  }
  app.get('/api/apply/:token', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a) return res.status(404).json({ error: 'This admission link is not valid. Please ask your counsellor for a new link.' });
    if (a.status === 'Cancelled') return res.status(410).json({ error: 'This admission link was cancelled. Please contact your counsellor.' });
    if (a.status === 'Sent') {
      await db.updateRow('applications', a.id, { status: 'Opened', opened_at: now() }); a.status = 'Opened';
      const row = await db.getEnquiry(a.enquiry_id); if (row && row.app_status === 'Form sent') await db.updateEnquiry(row.id, { app_status: 'Form opened' });
      await db.addEvent(a.enquiry_id, 'Student', 'form', 'Opened the admission form');
    }
    res.json(await publicState(a));
  });
  const editable = (a) => ['Sent', 'Opened'].includes(a.status);
  app.put('/api/apply/:token/draft', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a || !editable(a)) return res.status(400).json({ error: 'This form can no longer be edited.' });
    const { data } = FORM.check(req.body.data || {});
    const fee = await feeFor(a.admission_type, data.level, data.programme, data.branch);
    await db.updateRow('applications', a.id, { data: sec.encrypt(JSON.stringify(data)), updated_at: now(), ...(isValid(data.level, data.programme, data.branch || '') ? { fee_amount: fee, programme: courseLabel(data.programme, data.branch) } : {}) });
    res.json({ ok: true, fee });
  });
  const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  app.post('/api/apply/:token/file', appLimiter, C.express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
    const a = await appByToken(req.params.token); if (!a || !editable(a)) return res.status(400).json({ error: 'This form can no longer be edited.' });
    const kind = String(req.query.kind || ''), doc = FORM.DOCS.find((d) => d.k === kind);
    const mime = String(req.get('content-type') || '').split(';')[0];
    if (!doc) return res.status(400).json({ error: 'Unknown document' });
    if (!MIME[mime]) return res.status(400).json({ error: 'Please upload a JPG, PNG or PDF file.' });
    const buf = req.body; if (!Buffer.isBuffer(buf) || buf.length < 200) return res.status(400).json({ error: 'The file looks empty.' });
    const sig = buf.subarray(0, 4).toString('hex');
    if ((mime === 'application/pdf' && !buf.subarray(0, 4).equals(Buffer.from('%PDF'))) || (mime === 'image/png' && sig !== '89504e47') || (mime === 'image/jpeg' && !sig.startsWith('ffd8'))) return res.status(400).json({ error: 'That file is not a real JPG / PNG / PDF.' });
    const count = Number((await db.get('SELECT COUNT(*) AS n FROM app_files WHERE application_id = $1', [a.id])).n);
    if (count >= 14) return res.status(400).json({ error: 'Too many files.' });
    await db.run('DELETE FROM app_files WHERE application_id = $1 AND kind = $2', [a.id, kind]);
    const name = C.clean(req.query.name, 80).replace(/[^\w .()-]/g, '') || `${kind}.${MIME[mime]}`;
    const id = await db.insertRow('app_files', { application_id: a.id, kind, name, mime, size: buf.length, data: sec.encrypt(buf.toString('base64')), at: now() });
    res.json({ ok: true, file: { id, kind, name, mime, size: buf.length } });
  });
  app.get('/api/apply/:token/file/:fid', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a) return res.status(404).end();
    sendFile(res, await db.get('SELECT * FROM app_files WHERE id = $1 AND application_id = $2', [parseId(req.params.fid), a.id]), true);
  });
  function sendFile(res, f, inline) {
    if (!f) return res.status(404).end();
    res.set('Content-Type', f.mime).set('Cache-Control', 'no-store, private').set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/"/g, '')}"`);
    res.send(Buffer.from(sec.decrypt(f.data), 'base64'));
  }
  app.post('/api/apply/:token/submit', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a || !editable(a)) return res.status(400).json({ error: 'This form was already submitted.' });
    const { data, errors } = FORM.check(req.body.data || {}, { final: true, isValid });
    const files = await db.all('SELECT kind FROM app_files WHERE application_id = $1', [a.id]);
    FORM.DOCS.filter((d) => d.req && !files.some((f) => f.kind === d.k)).forEach((d) => { errors['doc_' + d.k] = `Please upload: ${d.label}`; });
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please complete the highlighted fields.', fields: errors });
    const yr = C.ACADEMIC_YEAR().replace('–', '-').replace(/^20(\d\d)-(\d\d)$/, '$1-$2');
    const app_no = `${tenant.cur().short}/${yr}/${String(a.id).padStart(5, '0')}`;
    const fee = await feeFor(a.admission_type, data.level, data.programme, data.branch);
    await db.updateRow('applications', a.id, { data: sec.encrypt(JSON.stringify(data)), status: 'Submitted', submitted_at: now(), updated_at: now(), app_no, fee_amount: fee, programme: courseLabel(data.programme, data.branch) });
    const row = await db.getEnquiry(a.enquiry_id);
    if (row) {
      await db.updateEnquiry(row.id, { app_status: 'Form submitted', ...(['Admitted'].includes(row.status) ? {} : { status: 'Applied' }) });
      await db.addEvent(row.id, 'Student', 'form', `Submitted the ${a.admission_type.toLowerCase()} admission form · ${app_no} · ${courseLabel(data.programme, data.branch)}`);
      C.notifyAdmin(`New ${a.admission_type.toLowerCase()} admission form submitted: ${app_no} · ${courseLabel(data.programme, data.branch)} (${row.ref_no})`, `appsub:${a.id}`);
    }
    res.json({ ok: true, ...(await publicState(await db.get('SELECT * FROM applications WHERE id = $1', [a.id]))) });
  });

  // ---------- payment ----------
  const payable = (a) => ['Submitted', 'Payment pending', 'Part paid'].includes(a.status);
  app.get('/api/apply/:token/upi.svg', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); const s = await admSettings();
    if (!a || !s.upiId || !payable(a)) return res.status(404).end();
    const due = Math.max(0, (a.fee_amount || 0) - (a.paid_amount || 0));
    const uri = `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(s.payee)}&am=${due}.00&cu=INR&tn=${encodeURIComponent('Admission ' + (a.app_no || ''))}`;
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await C.QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B1F4B', light: '#FFFFFF' } }));
  });
  app.get('/api/apply/:token/upi-link', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); const s = await admSettings();
    if (!a || !s.upiId || !payable(a)) return res.status(404).json({});
    const due = Math.max(0, (a.fee_amount || 0) - (a.paid_amount || 0));
    res.json({ uri: `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(s.payee)}&am=${due}.00&cu=INR&tn=${encodeURIComponent('Admission ' + (a.app_no || ''))}` });
  });
  const MODES = ['UPI', 'Bank transfer (NEFT / RTGS / IMPS)', 'At campus (cash / DD / cheque)'];
  app.post('/api/apply/:token/payment', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token); if (!a || !payable(a)) return res.status(400).json({ error: 'Payment is not open for this application.' });
    const mode = MODES.includes(req.body.mode) ? req.body.mode : null; if (!mode) return res.status(400).json({ error: 'Choose how you paid.' });
    const amount = parseInt(req.body.amount, 10) || 0, ref = C.clean(req.body.reference, 40);
    if (amount < 1 || amount > 5000000) return res.status(400).json({ error: 'Enter the amount you paid.' });
    if (!mode.startsWith('At campus') && !/^[A-Za-z0-9-]{6,40}$/.test(ref)) return res.status(400).json({ error: 'Enter the UTR / transaction reference number (6 or more letters / digits).' });
    if (ref && await db.get("SELECT id FROM payments WHERE reference = $1 AND status <> 'Rejected'", [ref])) return res.status(409).json({ error: 'This transaction reference was already submitted.' });
    let proof = null;
    if (req.body.proof_file_id) { const f = await db.get('SELECT id FROM app_files WHERE id = $1 AND application_id = $2', [parseId(req.body.proof_file_id), a.id]); proof = f ? f.id : null; }
    await db.insertRow('payments', { application_id: a.id, amount, mode, reference: ref || null, proof_file_id: proof, status: 'Pending verification', created_at: now() });
    await db.updateRow('applications', a.id, { status: 'Payment pending', updated_at: now() });
    await db.updateEnquiry(a.enquiry_id, { app_status: 'Payment submitted' });
    await db.addEvent(a.enquiry_id, 'Student', 'payment', `Payment details submitted: ${inr(amount)} by ${mode}${ref ? ' · ref ' + ref : ''} (to be verified)`);
    C.notifyAdmin(`Fee payment to verify: ${inr(amount)} by ${mode} for ${a.app_no}`, `pay:${a.id}:${Date.now()}`);
    res.json({ ok: true, ...(await publicState(await db.get('SELECT * FROM applications WHERE id = $1', [a.id]))) });
  });
  // payment proof (screenshot) goes in as a document of kind 'payment'
  app.post('/api/apply/:token/proof', appLimiter, C.express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
    const a = await appByToken(req.params.token); if (!a || !payable(a)) return res.status(400).json({ error: 'Payment is not open.' });
    const mime = String(req.get('content-type') || '').split(';')[0]; if (!MIME[mime] || !Buffer.isBuffer(req.body) || req.body.length < 200) return res.status(400).json({ error: 'Upload a JPG, PNG or PDF.' });
    const id = await db.insertRow('app_files', { application_id: a.id, kind: 'payment', name: `payment-proof.${MIME[mime]}`, mime, size: req.body.length, data: sec.encrypt(req.body.toString('base64')), at: now() });
    res.json({ ok: true, id });
  });
  // Online payment through Razorpay (card / UPI / net banking) — active once RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are set
  app.post('/api/apply/:token/rzp/order', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token), r = razor(); if (!a || !payable(a) || !r) return res.status(400).json({ error: 'Online payment is not available.' });
    const due = Math.max(0, (a.fee_amount || 0) - (a.paid_amount || 0)); if (!due) return res.status(400).json({ error: 'Nothing is due.' });
    const resp = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${r.key}:${r.secret}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: due * 100, currency: 'INR', receipt: String(a.app_no || a.id).slice(0, 40), notes: { application: a.app_no || String(a.id) } }), signal: AbortSignal.timeout(15000) }).catch(() => null);
    const j = resp ? await resp.json().catch(() => ({})) : {};
    if (!resp || !resp.ok || !j.id) return res.status(502).json({ error: 'Could not start the online payment. Please try UPI / bank transfer.' });
    const row = await db.getEnquiry(a.enquiry_id);
    res.json({ key: r.key, order_id: j.id, amount: j.amount, name: tenant.brand('Ajeenkya DY Patil University'), description: `${a.admission_type} admission · ${a.app_no}`, prefill: { name: row ? row.student_name : '' } });
  });
  app.post('/api/apply/:token/rzp/verify', appLimiter, async (req, res) => {
    const a = await appByToken(req.params.token), r = razor(); if (!a || !r) return res.status(400).json({ error: 'Not available' });
    const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
    const good = o && p && s && crypto.timingSafeEqual(Buffer.from(crypto.createHmac('sha256', r.secret).update(`${o}|${p}`).digest('hex')), Buffer.from(String(s).padEnd(64).slice(0, 64)));
    if (!good) { audit(req, 'payment_signature_invalid', a.app_no || '', 'high'); return res.status(400).json({ error: 'Payment could not be verified.' }); }
    if (await db.get('SELECT id FROM payments WHERE gateway_payment = $1', [p])) return res.json({ ok: true, ...(await publicState(a)) });
    // amount actually captured, from Razorpay
    const pr = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(p)}`, { headers: { Authorization: 'Basic ' + Buffer.from(`${r.key}:${r.secret}`).toString('base64') }, signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => ({}));
    const amount = Math.round((pr.amount || 0) / 100) || Math.max(0, (a.fee_amount || 0) - (a.paid_amount || 0));
    const pid = await db.insertRow('payments', { application_id: a.id, amount, mode: 'Online (Razorpay)', reference: p, status: 'Paid online', gateway_order: o, gateway_payment: p, created_at: now(), verified_by: 'Razorpay', verified_at: now() });
    await confirmPayment(a, pid, amount, 'Razorpay');
    res.json({ ok: true, ...(await publicState(await db.get('SELECT * FROM applications WHERE id = $1', [a.id]))) });
  });
  async function confirmPayment(a, pid, amount, by) {
    const receipt_no = `${tenant.cur().short}-RCPT-${new Date().getFullYear()}-${String(pid).padStart(6, '0')}`;
    await db.updateRow('payments', pid, { receipt_no });
    const paid = (a.paid_amount || 0) + amount, full = paid >= (a.fee_amount || 0);
    await db.updateRow('applications', a.id, { paid_amount: paid, status: full ? 'Paid' : 'Part paid', updated_at: now() });
    await db.updateEnquiry(a.enquiry_id, { app_status: full ? 'Fees paid' : 'Part paid', status: 'Admitted', next_action_date: null });
    await db.addEvent(a.enquiry_id, by, 'payment', `${inr(amount)} received · receipt ${receipt_no} · ${a.admission_type} admission ${full ? 'confirmed' : '(part payment)'}`);
    C.notifyAdmin(`Fee received ${inr(amount)} · ${a.app_no} · ${a.admission_type} admission ${full ? 'confirmed' : 'part paid'}`, `paid:${pid}`);
  }

  // ---------- admin: Admissions tab ----------
  app.get('/api/admin/applications', C.requireAdmin, async (req, res) => {
    const list = await db.all('SELECT * FROM applications ORDER BY id DESC LIMIT 2000');
    const out = [];
    for (const a of list) {
      const row = await db.getEnquiry(a.enquiry_id);
      const pays = await db.all('SELECT id, amount, mode, reference, status, receipt_no, proof_file_id, created_at FROM payments WHERE application_id = $1 ORDER BY id DESC', [a.id]);
      out.push({ id: a.id, app_no: a.app_no, type: a.admission_type, status: a.status, programme: a.programme, fee: a.fee_amount || 0, paid: a.paid_amount || 0, created_at: a.created_at, created_by: a.created_by,
        submitted_at: a.submitted_at, opened_at: a.opened_at, student: row ? { id: row.id, name: row.student_name, ref: row.ref_no, mobile: row.mobile, counsellor: row.counsellor_name, caller: row.caller_name } : null, payments: pays,
        link: `${base(req)}/apply/${sec.decrypt(a.token_enc)}` });
    }
    const sum = (k) => out.reduce((x, a) => x + (a[k] || 0), 0);
    res.json({ apps: out, totals: { sent: out.length, submitted: out.filter((a) => a.submitted_at).length, toVerify: out.reduce((x, a) => x + a.payments.filter((p) => p.status === 'Pending verification').length, 0),
      paid: out.filter((a) => a.status === 'Paid').length, collected: sum('paid'), due: out.filter((a) => a.submitted_at && a.status !== 'Cancelled').reduce((x, a) => x + Math.max(0, a.fee - a.paid), 0) } });
  });
  app.get('/api/admin/applications/:id', C.requireAdmin, async (req, res) => {
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [parseId(req.params.id)]); if (!a) return res.status(404).json({ error: 'Not found' });
    const data = JSON.parse(sec.decrypt(a.data) || '{}');
    audit(req, 'application_viewed', a.app_no || `#${a.id}`, 'info');
    res.json({ rows: FORM.rows(data), files: await db.all('SELECT id, kind, name, mime, size FROM app_files WHERE application_id = $1', [a.id]),
      payments: await db.all('SELECT * FROM payments WHERE application_id = $1 ORDER BY id DESC', [a.id]), app: { id: a.id, app_no: a.app_no, status: a.status, type: a.admission_type, fee: a.fee_amount, paid: a.paid_amount } });
  });
  app.get('/api/admin/applications/:id/file/:fid', C.requireAdmin, async (req, res) => {
    const f = await db.get('SELECT * FROM app_files WHERE id = $1 AND application_id = $2', [parseId(req.params.fid), parseId(req.params.id)]);
    if (f) audit(req, 'document_downloaded', `${f.kind} · application #${req.params.id}`, 'high');
    sendFile(res, f, req.query.dl !== '1');
  });
  app.get('/api/admin/applications/:id/pdf', C.requireAdmin, async (req, res) => {
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [parseId(req.params.id)]); if (!a) return res.status(404).send('Not found');
    audit(req, 'export_application_pdf', `${a.app_no || '#' + a.id} downloaded from IP ${req.ip}`, 'high');
    await applicationPdf(res, a, req);
  });
  app.get('/api/admin/applications/:id/receipt/:pid.pdf', C.requireAdmin, async (req, res) => {
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [parseId(req.params.id)]);
    const p = a && await db.get('SELECT * FROM payments WHERE id = $1 AND application_id = $2', [parseId(req.params.pid), a.id]);
    if (!p || !p.receipt_no) return res.status(404).send('Not found'); receiptPdf(res, a, p);
  });
  app.post('/api/admin/payments/:pid/verify', C.requireAdmin, C.requireXhr, async (req, res) => {
    const p = await db.get('SELECT * FROM payments WHERE id = $1', [parseId(req.params.pid)]); if (!p || p.status !== 'Pending verification') return res.status(400).json({ error: 'Nothing to verify.' });
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [p.application_id]);
    if (req.body.ok) {
      const amount = parseInt(req.body.amount, 10) || p.amount;
      await db.updateRow('payments', p.id, { status: 'Verified', amount, verified_by: C.ADMIN_NAME(), verified_at: now(), note: C.clean(req.body.note, 200) || null });
      await confirmPayment(a, p.id, amount, C.ADMIN_NAME());
      audit(req, 'payment_verified', `${a.app_no} · ${inr(amount)} · ${p.mode}`, 'medium');
    } else {
      await db.updateRow('payments', p.id, { status: 'Rejected', verified_by: C.ADMIN_NAME(), verified_at: now(), note: C.clean(req.body.note, 200) || 'Not received' });
      await db.updateRow('applications', a.id, { status: (a.paid_amount || 0) > 0 ? 'Part paid' : 'Submitted', updated_at: now() });
      await db.updateEnquiry(a.enquiry_id, { app_status: 'Payment rejected' });
      await db.addEvent(a.enquiry_id, C.ADMIN_NAME(), 'payment', `Payment of ${inr(p.amount)} rejected: ${C.clean(req.body.note, 200) || 'not received'}`);
      audit(req, 'payment_rejected', `${a.app_no} · ${inr(p.amount)}`, 'medium');
    }
    res.json({ ok: true });
  });
  // admin records a payment received at the counter
  app.post('/api/admin/applications/:id/payment', C.requireAdmin, C.requireXhr, async (req, res) => {
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [parseId(req.params.id)]); if (!a || !a.submitted_at) return res.status(400).json({ error: 'The student must submit the form first.' });
    const amount = parseInt(req.body.amount, 10) || 0; if (amount < 1) return res.status(400).json({ error: 'Enter the amount.' });
    const mode = C.clean(req.body.mode, 40) || 'Cash at campus';
    const pid = await db.insertRow('payments', { application_id: a.id, amount, mode, reference: C.clean(req.body.reference, 40) || null, status: 'Verified', created_at: now(), verified_by: C.ADMIN_NAME(), verified_at: now() });
    await confirmPayment(a, pid, amount, C.ADMIN_NAME());
    audit(req, 'payment_recorded', `${a.app_no} · ${inr(amount)} · ${mode}`, 'medium');
    res.json({ ok: true });
  });
  app.patch('/api/admin/applications/:id', C.requireAdmin, C.requireXhr, async (req, res) => {
    const a = await db.get('SELECT * FROM applications WHERE id = $1', [parseId(req.params.id)]); if (!a) return res.status(404).json({ error: 'Not found' });
    const upd = { updated_at: now() };
    if (req.body.fee !== undefined) { upd.fee_amount = Math.max(0, parseInt(req.body.fee, 10) || 0); await db.addEvent(a.enquiry_id, C.ADMIN_NAME(), 'payment', `Fee for ${a.app_no || 'application'} set to ${inr(upd.fee_amount)}`); }
    if (req.body.cancel) { upd.status = 'Cancelled'; await db.updateEnquiry(a.enquiry_id, { app_status: 'Form cancelled' }); await db.addEvent(a.enquiry_id, C.ADMIN_NAME(), 'form', 'Admission form cancelled'); }
    if (req.body.reopen && a.status === 'Submitted') { upd.status = 'Opened'; await db.addEvent(a.enquiry_id, C.ADMIN_NAME(), 'form', 'Form re-opened for corrections'); }
    await db.updateRow('applications', a.id, upd);
    audit(req, 'application_updated', `${a.app_no || '#' + a.id}: ${Object.keys(upd).filter((k) => k !== 'updated_at').join(', ')}`, 'info');
    res.json({ ok: true });
  });

  // ---------- PDFs ----------
  function pdfHead(doc, title, sub) {
    const W = doc.page.width;
    doc.rect(0, 0, W, 70).fill('#0B1F4B'); doc.rect(0, 70, W, 4).fill('#F08A24');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text('Ajeenkya DY Patil University, Pune', 40, 18);
    doc.fillColor('#FFD8A8').font('Helvetica').fontSize(10).text(title, 40, 42);
    if (sub) doc.fillColor('#FFFFFF').fontSize(9).text(sub, 40, 26, { width: W - 80, align: 'right' });
  }
  async function applicationPdf(res, a, req) {
    const data = JSON.parse(sec.decrypt(a.data) || '{}'), row = await db.getEnquiry(a.enquiry_id);
    const doc = new C.PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Application ${a.app_no || ''}`, Author: 'ADYPU Admission Office' } });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="Application_${String(a.app_no || a.id).replace(/\//g, '-')}.pdf"`);
    doc.pipe(res);
    pdfHead(doc, `Application Form · ${a.admission_type} admission · ${C.ACADEMIC_YEAR()}`, `Application No: ${a.app_no || '—'}`);
    const W = doc.page.width, L = 40, R = W - 40;
    let y = 90;
    const photo = await db.get("SELECT * FROM app_files WHERE application_id = $1 AND kind = 'photo'", [a.id]);
    doc.fillColor('#0B1F4B').font('Helvetica-Bold').fontSize(13).text(`${data.title || ''} ${data.first_name || ''} ${data.last_name || ''}`.trim(), L, y);
    doc.fillColor('#475569').font('Helvetica').fontSize(9.5).text(`Programme: ${courseLabel(data.programme, data.branch)} (${data.level})\nEnquiry ref: ${row ? row.ref_no : '—'}   ·   Submitted: ${a.submitted_at ? fmtIST(a.submitted_at) : 'not yet'}\nFee: ${rs(a.fee_amount)}   ·   Paid: ${rs(a.paid_amount)}   ·   Status: ${a.status}`, L, y + 18, { width: R - L - 110 });
    if (photo && /image/.test(photo.mime)) { try { doc.image(Buffer.from(sec.decrypt(photo.data), 'base64'), R - 90, y - 4, { fit: [90, 110] }); } catch {} }
    y = 210;
    for (const s of FORM.rows(data)) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
      doc.rect(L, y, R - L, 18).fill('#FFF4E6'); doc.fillColor('#9A3412').font('Helvetica-Bold').fontSize(10).text(s.title.toUpperCase(), L + 6, y + 5); y += 22;
      for (let i = 0; i < s.items.length; i += 2) {
        const pair = s.items.slice(i, i + 2), hh = Math.max(...pair.map(([k, v]) => Math.max(doc.font('Helvetica-Bold').fontSize(9).heightOfString(v, { width: (R - L) / 2 - 134 }), doc.font('Helvetica').fontSize(8.5).heightOfString(k, { width: 120 }))), 12) + 6;
        if (y + hh > doc.page.height - 60) { doc.addPage(); y = 50; }
        pair.forEach(([k, v], j) => { const x = L + j * ((R - L) / 2);
          doc.fillColor('#64748B').font('Helvetica').fontSize(8.5).text(k, x + 6, y, { width: 120 });
          doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9).text(v, x + 128, y, { width: (R - L) / 2 - 134 }); });
        y += hh;
      }
      y += 6;
    }
    const files = await db.all('SELECT kind, name, size FROM app_files WHERE application_id = $1', [a.id]);
    if (y > doc.page.height - 140) { doc.addPage(); y = 50; }
    doc.rect(L, y, R - L, 18).fill('#FFF4E6'); doc.fillColor('#9A3412').font('Helvetica-Bold').fontSize(10).text('DOCUMENTS UPLOADED', L + 6, y + 5); y += 24;
    doc.fillColor('#0F172A').font('Helvetica').fontSize(9).text(FORM.DOCS.map((d) => `${files.some((f) => f.kind === d.k) ? '[x]' : '[  ]'} ${d.label}`).join('     '), L + 6, y, { width: R - L - 12 });
    const sig = await db.get("SELECT * FROM app_files WHERE application_id = $1 AND kind = 'signature'", [a.id]);
    y = doc.y + 30; if (y > doc.page.height - 110) { doc.addPage(); y = 60; }
    if (sig && /image/.test(sig.mime)) { try { doc.image(Buffer.from(sec.decrypt(sig.data), 'base64'), R - 160, y, { fit: [150, 45] }); } catch {} }
    doc.strokeColor('#94A3B8').moveTo(R - 170, y + 50).lineTo(R, y + 50).stroke().fillColor('#475569').fontSize(8.5).text('Signature of the applicant', R - 170, y + 54, { width: 170, align: 'center' });
    doc.text(`Place: ${data.place || ''}   Date: ${a.submitted_at ? istDate(a.submitted_at) : ''}`, L, y + 54);
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) { doc.switchToPage(p); doc.page.margins.bottom = 0;
      doc.fillColor('#B91C1C').fontSize(7).text(`CONFIDENTIAL · downloaded by main admin · ${fmtIST(now())} IST · IP ${req.ip}   ·   Page ${p + 1} of ${range.count}`, L, doc.page.height - 26, { width: R - L, align: 'center', lineBreak: false }); }
    doc.end();
  }
  async function receiptPdf(res, a, p) {
    const data = JSON.parse(sec.decrypt(a.data) || '{}');
    const doc = new C.PDFDocument({ size: 'A5', layout: 'landscape', margin: 36, info: { Title: `Receipt ${p.receipt_no}` } });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${p.receipt_no}.pdf"`);
    doc.pipe(res);
    pdfHead(doc, 'Fee receipt', p.receipt_no);
    const L = 40, R = doc.page.width - 40; let y = 92;
    const line = (k, v, bold) => { doc.fillColor('#64748B').font('Helvetica').fontSize(10).text(k, L, y, { width: 170 }); doc.fillColor('#0F172A').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 10.5).text(v, L + 175, y - (bold ? 2 : 0), { width: R - L - 175 }); y += bold ? 24 : 19; };
    line('Receipt No.', p.receipt_no); line('Date', istDate(p.verified_at || p.created_at)); line('Received from', `${data.title || ''} ${data.first_name || ''} ${data.last_name || ''}`.trim());
    line('Application No.', a.app_no || '—'); line('Programme', `${courseLabel(data.programme, data.branch)} (${data.level})`); line('Admission type', `${a.admission_type} admission`);
    line('Payment mode', `${p.mode}${p.reference ? ' · Ref ' + p.reference : ''}`); line('Amount received', `${rs(p.amount)} (Rupees ${words(p.amount)} only)`, true);
    doc.fillColor('#64748B').font('Helvetica').fontSize(8.5).text(`Total fee ${rs(a.fee_amount)} · Paid till date ${rs(a.paid_amount)} · Balance ${rs(Math.max(0, (a.fee_amount || 0) - (a.paid_amount || 0)))}`, L, y + 4);
    doc.fillColor('#94A3B8').fontSize(8).text('This is a computer-generated receipt and does not need a signature. Fees once paid are subject to the University refund policy.', L, doc.page.height - 50, { width: R - L, align: 'center' });
    doc.end();
  }
  function words(n) {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
    const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
    n = Math.floor(n); if (!n) return 'Zero';
    const cr = Math.floor(n / 1e7), lk = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1000), rest = n % 1000;
    return [cr && `${two(cr)} Crore`, lk && `${two(lk)} Lakh`, th && `${two(th)} Thousand`, rest && three(rest)].filter(Boolean).join(' ');
  }

  // ---------- AI caller ----------
  const AI_DEF = { enabled: false, startHour: 10, endHour: 19, dailyLimit: 60, maxAttempts: 3, concurrency: 2, handoffId: null, autoForm: false, days: [1, 2, 3, 4, 5, 6] };
  const aiSettings = async () => ({ ...AI_DEF, ...(await db.getSetting('ai_caller', {})) });
  const aiSecret = () => process.env.AI_CALLER_SECRET || crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update('ai-caller').digest('base64url').slice(0, 24);
  const provider = () => (process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID && process.env.VAPI_PHONE_NUMBER_ID ? 'vapi' : process.env.AI_CALLER_WEBHOOK_URL ? 'webhook' : 'none');
  const AIC = new Map(); // per college
  async function aiUser() {
    const key = tenant.cur().slug; if (AIC.has(key)) return AIC.get(key);
    let u = await db.getUserAuth('ai-caller');
    if (!u) { await db.createUser({ name: 'AI Caller', username: 'ai-caller', mobile: '', kind: 'ai', pass_hash: await C.bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10) }); u = await db.getUserAuth('ai-caller'); }
    const ai = await db.getUser(u.id); AIC.set(key, ai); return ai;
  }
  const istHour = () => new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
  const istDow = () => new Date(Date.now() + 5.5 * 3600e3).getUTCDay();
  async function aiQueue() {
    const ai = await aiUser(), t = C.istToday(), s = await aiSettings();
    const rows = await db.listEnquiries({ caller: String(ai.id) });
    const open = rows.filter((r) => !['Admitted', 'Not Interested', 'Applied'].includes(r.status));
    const due = open.filter((r) => !r.ai_pending_at && (r.ai_attempts || 0) < s.maxAttempts && (!r.next_action_date || r.next_action_date <= t));
    return { rows, open, due, inProgress: rows.filter((r) => r.ai_pending_at) };
  }
  app.get('/api/admin/ai-caller', C.requireAdmin, async (req, res) => {
    const s = await aiSettings(), ai = await aiUser(), q = await aiQueue();
    const since = new Date(Date.now() - 864e5 * 7).toISOString();
    const recent = await db.all("SELECT c.*, e.ref_no FROM calls c JOIN enquiries e ON e.id = c.enquiry_id WHERE c.channel = 'ai' AND c.at >= $1 ORDER BY c.id DESC LIMIT 40", [since]);
    const today = (await db.all("SELECT outcome FROM calls WHERE channel = 'ai' AND at >= $1", [new Date(new Date(C.istToday() + 'T00:00:00+05:30')).toISOString()]));
    res.json({ settings: s, provider: provider(), ai: { id: ai.id, name: ai.name }, webhook: `${base(req)}/api/ai-caller/${provider() === 'vapi' ? 'vapi' : 'callback'}?secret=${aiSecret()}`,
      queue: { assigned: q.rows.length, waiting: q.due.length, inProgress: q.inProgress.length, open: q.open.length, today: today.length, connectedToday: today.filter((x) => x.outcome === 'Connected').length,
        interested: q.rows.filter((r) => ['Interested', 'Counselling Done', 'Form Sent', 'Applied', 'Admitted'].includes(r.status)).length },
      recent: recent.map((c) => ({ ref: c.ref_no, at: new Date(c.at).toISOString(), outcome: c.outcome, summary: sec.decrypt(c.feedback) || '', status: c.status_after })), prompt: tenant.brand(AI_PROMPT) });
  });
  app.put('/api/admin/ai-caller', C.requireAdmin, C.requireXhr, async (req, res) => {
    const b = req.body || {}, s = await aiSettings();
    if (b.enabled !== undefined) s.enabled = !!b.enabled;
    for (const [k, lo, hi] of [['startHour', 6, 21], ['endHour', 7, 22], ['dailyLimit', 1, 2000], ['maxAttempts', 1, 6], ['concurrency', 1, 10]]) if (b[k] !== undefined) s[k] = Math.max(lo, Math.min(hi, parseInt(b[k], 10) || lo));
    if (b.handoffId !== undefined) { const u = b.handoffId ? await db.getUser(parseId(b.handoffId)) : null; s.handoffId = u && u.kind === 'caller' ? u.id : null; }
    if (b.autoForm !== undefined) s.autoForm = !!b.autoForm;
    if (s.endHour <= s.startHour) return res.status(400).json({ error: 'The end hour must be after the start hour.' });
    await db.setSetting('ai_caller', s);
    audit(req, 'setting_changed', `AI caller ${s.enabled ? 'ON' : 'OFF'} · ${s.startHour}:00–${s.endHour}:00 · ${s.dailyLimit}/day`, 'medium');
    res.json({ ok: true, settings: s });
  });
  async function placeAiCall(row) {
    const s = await aiSettings(), first = row.student_name.split(' ')[0], c = await C.counsellorOf(row);
    const vars = { student_name: first, full_name: row.student_name, programme: row.course, city: row.city || '', ref: row.ref_no, university: tenant.brand('Ajeenkya DY Patil University, Pune'),
      fee: (() => { const f = tuitionFee(row.level, row.programme, row.branch); return f ? inr(f) + ' per year (' + feeYear() + ')' : 'shared by the counsellor'; })(), counsellor: c ? c.name : 'the admission team' };
    let callId = null;
    if (provider() === 'vapi') {
      const r = await fetch('https://api.vapi.ai/call', { method: 'POST', headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ assistantId: process.env.VAPI_ASSISTANT_ID, phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, customer: { number: `+91${row.mobile}`, name: first }, metadata: { college: tenant.cur().slug || '' }, assistantOverrides: { variableValues: vars } }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw new Error(`Vapi ${r.status}: ${JSON.stringify(j).slice(0, 160)}`); callId = 'vapi:' + j.id;
    } else if (provider() === 'webhook') {
      callId = 'wh:' + (tenant.cur().slug ? tenant.cur().slug + ':' : '') + crypto.randomBytes(9).toString('hex');
      const r = await fetch(process.env.AI_CALLER_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ call_ref: callId, student: { ...vars, mobile: `+91${row.mobile}` }, callback_url: `${C.PUBLIC_URL() || ''}/api/ai-caller/callback`, secret: aiSecret() }) });
      if (!r.ok) throw new Error(`webhook ${r.status}`);
    } else throw new Error('No AI calling provider configured');
    await db.updateEnquiry(row.id, { ai_pending_at: now(), ai_call_id: callId, ai_attempts: (row.ai_attempts || 0) + 1 });
    await db.addEvent(row.id, 'AI Caller', 'ai', `🤖 AI call started (attempt ${(row.ai_attempts || 0) + 1} of ${s.maxAttempts})`);
  }
  let aiBusy = false;
  async function aiTick() {
    if (aiBusy) return; aiBusy = true;
    try {
      const s = await aiSettings(); if (!s.enabled || provider() === 'none') return;
      const h = istHour(); if (h < s.startHour || h >= s.endHour || !s.days.includes(istDow())) return;
      const q = await aiQueue();
      // calls that never reported back within 30 min are released for a retry
      for (const r of q.inProgress) if (Date.now() - new Date(r.ai_pending_at).getTime() > 30 * 60000) await db.updateEnquiry(r.id, { ai_pending_at: null });
      const startedToday = Number((await db.get("SELECT COUNT(*) AS n FROM timeline WHERE kind = 'ai' AND text LIKE '%call started%' AND at >= $1", [new Date(C.istToday() + 'T00:00:00+05:30').toISOString()])).n);
      let slots = Math.min(s.concurrency - q.inProgress.length, s.dailyLimit - startedToday);
      const list = q.due.sort((a, b) => (a.call_count - b.call_count) || (new Date(a.created_at) - new Date(b.created_at)));
      for (const r of list) { if (slots-- <= 0) break; try { await placeAiCall(r); } catch (e) { console.error('AI call', r.ref_no, e.message); await db.addEvent(r.id, 'AI Caller', 'ai', `🤖 Could not place call: ${e.message.slice(0, 120)}`); break; } }
    } catch (e) { console.error('AI tick', e.message); } finally { aiBusy = false; }
  }
  setInterval(() => C.forEachCollege(aiTick), 60 * 1000);

  // Result of an AI call → call log, status, next follow-up, hand-over to a human
  async function applyAiResult(row, r) {
    const s = await aiSettings();
    const outcome = r.outcome || 'Connected';
    const interest = String(r.interested ?? '').toLowerCase();
    let status = row.status, next = null, note = r.summary || '';
    if (outcome !== 'Connected') { next = (row.ai_attempts || 0) < s.maxAttempts ? addDays(1) : null; if (!next) note = (note ? note + ' · ' : '') + 'AI attempts finished — needs a human call'; }
    else if (/^(yes|true|interested|hot)/.test(interest)) { status = ['New', 'Contacted'].includes(row.status) ? 'Interested' : row.status; next = C.istToday(); }
    else if (/^(no|false|not)/.test(interest)) status = 'Not Interested';
    else { status = row.status === 'New' ? 'Contacted' : row.status; next = C.validDate(r.callback_date) || addDays(3); }
    if (C.validDate(r.callback_date)) next = r.callback_date;
    await db.logCall({ enquiry_id: row.id, user_id: row.caller_id, user_name: 'AI Caller', channel: 'ai', outcome, feedback: String(note).slice(0, 600), status_after: status, next_action_date: next });
    await db.updateEnquiry(row.id, { status, next_action_date: next, ai_pending_at: null });
    await db.addEvent(row.id, 'AI Caller', 'ai', `🤖 ${outcome}${interest ? ' · interested: ' + interest : ''}${note ? ' · ' + note.slice(0, 200) : ''}`);
    const hot = outcome === 'Connected' && /^(yes|true|interested|hot)/.test(interest);
    const giveUp = outcome !== 'Connected' && !next;
    if ((hot || giveUp) && s.handoffId) { const u = await db.getUser(s.handoffId); if (u && Number(u.active)) { await db.assignMany([row.id], u); await db.addEvent(row.id, 'AI Caller', 'assign', `🤖 Handed over to ${u.name} for a human call${hot ? ' (interested)' : ''}`); } }
    if (hot && s.autoForm && /^(yes|true)/.test(String(r.wants_form || ''))) { try { const { app: a } = await createApplication(row, 'Provisional', 'AI Caller'); if (row.email) await emailStudent(row, `Your ADYPU admission form – ${row.course}`, formMessage(row, `${C.PUBLIC_URL() || ''}/apply/${sec.decrypt(a.token_enc)}`, 'Provisional', 'ADYPU Admission Office')); } catch (e) { console.error('AI auto form', e.message); } }
  }
  const addDays = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const secretOk = (req) => { const g = String(req.get('x-vapi-secret') || req.query.secret || req.body.secret || ''), e = aiSecret(); return g.length === e.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(e)); };
  const VAPI_MAP = { 'customer-did-not-answer': 'Not picked', 'customer-busy': 'Busy', 'voicemail': 'Not picked', 'silence-timed-out': 'Not reachable', 'twilio-failed-to-connect-call': 'Not reachable',
    'customer-ended-call': 'Connected', 'assistant-ended-call': 'Connected', 'assistant-said-end-call-phrase': 'Connected', 'exceeded-max-duration': 'Connected' };
  app.post('/api/ai-caller/vapi', C.express.json({ limit: '1mb' }), async (req, res) => {
    if (!secretOk(req)) return res.status(401).json({});
    const m = (req.body || {}).message || {};
    if (m.type !== 'end-of-call-report') return res.json({ ok: true });
    const col = m.call && m.call.metadata && m.call.metadata.college;
    if (col && !tenant.als.getStore()) { const ctx = await C.loadCollege(String(col)).catch(() => null); if (ctx) return tenant.als.run(ctx, () => vapiReport(m, res)); }
    return vapiReport(m, res);
  });
  async function vapiReport(m, res) {
    const id = m.call && m.call.id; const row = id && await db.get('SELECT id FROM enquiries WHERE ai_call_id = $1', ['vapi:' + id]);
    if (!row) return res.json({ ok: true, unknown: true });
    const sd = (m.analysis && m.analysis.structuredData) || {};
    const outcome = VAPI_MAP[m.endedReason] || (/fail|error|unreach|invalid/.test(String(m.endedReason)) ? 'Not reachable' : 'Connected');
    await applyAiResult(await db.getEnquiry(row.id), { outcome, summary: (m.analysis && m.analysis.summary) || m.summary || '', interested: sd.interested ?? sd.interest, callback_date: sd.callback_date, wants_form: sd.wants_admission_form });
    res.json({ ok: true });
  }
  app.post('/api/ai-caller/callback', C.express.json({ limit: '1mb' }), async (req, res) => {
    if (!secretOk(req)) return res.status(401).json({});
    const b = req.body || {}; const col = String(b.call_ref || '').split(':').length === 3 ? String(b.call_ref).split(':')[1] : '';
    if (col && !tenant.als.getStore()) { const ctx = await C.loadCollege(col).catch(() => null); if (ctx) return tenant.als.run(ctx, () => whReport(b, res)); }
    return whReport(b, res);
  });
  async function whReport(b, res) {
    const row = b.call_ref && await db.get('SELECT id FROM enquiries WHERE ai_call_id = $1', [String(b.call_ref)]);
    if (!row) return res.status(404).json({ error: 'unknown call_ref' });
    await applyAiResult(await db.getEnquiry(row.id), { outcome: C.CALL_OUTCOMES.includes(b.outcome) ? b.outcome : 'Connected', summary: C.clean(b.summary, 600), interested: b.interested, callback_date: b.callback_date, wants_form: b.wants_admission_form });
    res.json({ ok: true });
  }
  if (!C.IS_PROD) app.post('/api/admin/ai-caller/simulate', C.requireAdmin, C.requireXhr, async (req, res) => { // local testing only
    const row = await db.getEnquiry(parseId(req.body.id)); if (!row) return res.status(404).json({});
    if (!row.ai_call_id) await db.updateEnquiry(row.id, { ai_call_id: 'sim:' + row.id, ai_attempts: 1 });
    await applyAiResult(await db.getEnquiry(row.id), req.body); res.json({ ok: true });
  });
  aiUser().catch(() => {}); // make sure the AI caller account exists
  setTimeout(() => aiUser().catch(() => {}), 5000);

  const AI_PROMPT = `You are Riya, a polite admission counsellor calling on behalf of Ajeenkya DY Patil University (ADYPU), Pune.
Speak in simple English; switch to Hindi or Marathi if the student prefers. Keep the call under 3 minutes.
1. Greet {{student_name}} and say you are calling about their enquiry for {{programme}} (ref {{ref}}). Ask if it is a good time; if not, ask when to call back.
2. Ask: are they still looking for admission for ${C.ACADEMIC_YEAR()}? Which programme / specialisation? Have they appeared for any entrance exam? Do they need a hostel?
3. Share only facts you were given: annual tuition fee {{fee}}; a counsellor ({{counsellor}}) will guide them in detail. Never promise scholarships, placements or seats.
4. If interested, offer to send the online admission form link and to book a campus visit.
5. Thank them and end politely.
At the end, fill the structured data: interested (yes / no / maybe), callback_date (YYYY-MM-DD or empty), wants_admission_form (yes / no), programme_confirmed, needs_hostel, notes.`;
};
