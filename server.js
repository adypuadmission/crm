require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('./db');
const { LEVELS, courseLabel, isValid } = require('./courses');
const sms = require('./sms');
const chat = require('./chat');
const { resolveRegion, CITY_SUGGESTIONS, REGIONS } = require('./regions');
const CONTACTS = require('./contacts');
const QRCode = require('qrcode');
const sec = require('./sec');
// Public address of the site, used inside QR codes. Set PUBLIC_URL (e.g. https://admissions.adypu.edu.in) once you have a domain.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const PORT = process.env.PORT || 3000;
const ACADEMIC_YEAR = process.env.ACADEMIC_YEAR || '2027–28';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const STATUSES = ['New', 'Contacted', 'Interested', 'Counselling Done', 'Applied', 'Admitted', 'Not Interested'];
const IS_PROD = process.env.NODE_ENV === 'production';
// OTP: on by default. OTP_DEMO_MODE=true shows the code on screen (testing only — never in production).
const OTP_REQUIRED = (process.env.OTP_REQUIRED || 'true') !== 'false';
const OTP_DEMO = process.env.OTP_DEMO_MODE === 'true';
const SEND_CONFIRMATION = (process.env.SEND_CONFIRMATION_SMS || 'true') !== 'false';
if (OTP_DEMO && IS_PROD) console.warn('⚠  OTP_DEMO_MODE is on in production — OTPs are shown on screen. Turn it off before going live!');
if (OTP_REQUIRED && sms.provider === 'console' && !OTP_DEMO) console.warn('⚠  SMS_PROVIDER=console: OTPs are only printed in this log, not sent. Configure an SMS provider before going live.');

// Admin password: prefer a bcrypt hash; fall back to a plain env password (hashed in memory).
let ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_HASH) {
  const pw = process.env.ADMIN_PASSWORD || 'ChangeMe@ADYPU2027';
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD not set — using the default. Set it before going live!');
  ADMIN_HASH = bcrypt.hashSync(pw, 12);
}
if (!process.env.SESSION_SECRET) console.warn('⚠  SESSION_SECRET not set — admin sessions reset on every restart.');
// Security alerts + admin two-step login go to this mobile (and optionally email)
const ADMIN_NAME = process.env.ADMIN_NAME || 'Dr. Atul Kathole';
const ADMIN_MOBILE = String(process.env.ADMIN_MOBILE || '9960889772').replace(/\D/g, '').slice(-10);
const ADMIN_2FA = !!ADMIN_MOBILE && process.env.ADMIN_2FA !== 'false';
if (!ADMIN_MOBILE) console.warn('⚠  ADMIN_MOBILE not set — security alerts will appear only in the dashboard and admin login has no OTP step.');
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || '';
let mailer = null;
if (ALERT_EMAIL_TO && process.env.SMTP_HOST) {
  try {
    mailer = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587), secure: +(process.env.SMTP_PORT || 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  } catch (e) { console.error('Email alerts disabled:', e.message); }
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '20kb' }));
// Never let browsers or proxies cache private pages, data or exports
app.use(['/admin', '/team', '/api/admin', '/api/team', '/api/security'], (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.set('Pragma', 'no-cache'); next(); });
if (IS_PROD) app.use((req, res, next) => (req.secure || req.get('x-forwarded-proto') === 'https' || req.path === '/healthz' ? next() : res.redirect(301, `https://${req.get('host')}${req.originalUrl}`)));

// ---------- signed session cookie (stateless, HttpOnly) ----------
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
// Token payload: { u: username, role: 'admin' | 'sub', id: sub-admin id, n: display name, exp }
// Sessions are bound to the browser (user-agent fingerprint) and, for sub-admins, to the current password.
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 6);
const devHash = (req) => crypto.createHash('sha256').update(String(req.get('user-agent') || '')).digest('base64url').slice(0, 16);
const passVer = (hash) => crypto.createHash('sha256').update(String(hash || '')).digest('base64url').slice(0, 10);
function issueToken(user, req) {
  const info = typeof user === 'string' ? { u: user, role: 'admin' } : user;
  const payload = Buffer.from(JSON.stringify({ ...info, d: req ? devHash(req) : undefined, exp: Date.now() + SESSION_HOURS * 3600 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)adm=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!(data.exp > Date.now())) return null;
    if (data.d && data.d !== devHash(req)) { req.sessionMismatch = data; return null; }
    return data;
  } catch { return null; }
}
const cookieOpts = `Path=/; HttpOnly; SameSite=Strict${IS_PROD ? '; Secure' : ''}`;

// ---------- audit log & alerts ----------
const ALERT_GAP = 10 * 60 * 1000;
const lastAlert = new Map();
async function notifyAdmin(text, key) {
  const k = key || text;
  if (Date.now() - (lastAlert.get(k) || 0) < ALERT_GAP) return; // throttle repeats
  lastAlert.set(k, Date.now());
  if (ADMIN_MOBILE) sms.send('alert', ADMIN_MOBILE, { text }).catch(() => {});
  if (mailer) mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ALERT_EMAIL_TO, subject: `⚠ ADYPU CRM security alert`,
    text: `${text}\n\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\nOpen the admin dashboard → Security tab for details.` }).catch((e) => console.error('alert email', e.message));
}
const SEVERE = new Set(['high', 'critical']);
async function audit(req, action, details = '', severity = 'info', who) {
  const t = who || req.user || readToken(req) || {};
  const actor = t.role === 'admin' || t.u === ADMIN_USER ? ADMIN_NAME : t.username || t.u || 'anonymous';
  const role = t.role === 'sub' ? 'sub-admin' : t.role === 'admin' ? 'admin' : t.username ? 'login attempt' : 'public';
  try { await db.insertAudit({ actor, role, user_id: t.id, ip: req.ip, ua: req.get('user-agent'), action, details, severity }); } catch (e) { console.error('audit', e.message); }
  if (SEVERE.has(severity)) notifyAdmin(`${actor} (${role}) - ${action.replace(/_/g, ' ')}${details ? ': ' + String(details).slice(0, 60) : ''}`, `${actor}:${action}`);
}

const deny = (req, res, msg = 'Please log in again.') => (req.path.startsWith('/api/') ? res.status(401).json({ error: msg }) : res.redirect('/admin/login'));
// Main admin only
function requireAdmin(req, res, next) {
  const t = readToken(req);
  if (t && (t.role || 'admin') === 'admin') { req.user = { role: 'admin', name: ADMIN_NAME, u: ADMIN_USER }; return next(); }
  if (t && t.role === 'sub') {
    audit(req, 'blocked_admin_access', `${req.method} ${req.originalUrl.split('?')[0]}`, 'high', { ...t, username: t.u });
    return req.originalUrl.startsWith('/api/') ? res.status(403).json({ error: 'You do not have permission for this. The admin has been notified.' }) : res.redirect('/team');
  }
  if (req.sessionMismatch) audit(req, 'session_used_from_other_device', `${req.sessionMismatch.u || ''}`, 'high', { ...req.sessionMismatch, username: req.sessionMismatch.u });
  return deny(req, res);
}
// Sub-admin (team member) only; re-checks that the account is still active
const activity = new Map();
async function requireSub(req, res, next) {
  const t = readToken(req);
  if (!t) { if (req.sessionMismatch) audit(req, 'session_used_from_other_device', req.sessionMismatch.u || '', 'high', { ...req.sessionMismatch, username: req.sessionMismatch.u }); return deny(req, res); }
  if ((t.role || 'admin') === 'admin') return req.path.startsWith('/api/') ? res.status(403).json({ error: 'This area is for sub-admin accounts.' }) : res.redirect('/admin');
  const u = await db.getUserAuth(t.u);
  if (!u || u.id !== t.id || !Number(u.active)) { res.setHeader('Set-Cookie', `adm=; Max-Age=0; ${cookieOpts}`); return deny(req, res, 'Your account has been disabled. Please contact the admin.'); }
  if (t.pv && t.pv !== passVer(u.pass_hash)) { res.setHeader('Set-Cookie', `adm=; Max-Age=0; ${cookieOpts}`); return deny(req, res, 'Your password was changed. Please log in again.'); }
  req.user = { role: 'sub', id: u.id, name: u.name, username: u.username };
  // Unusual volume of requests (possible scraping) → alert
  const k = `rate:${u.id}`, now = Date.now(), w = (activity.get(k) || []).filter((x) => now - x < 10 * 60 * 1000);
  w.push(now); activity.set(k, w);
  if (w.length === 150) audit(req, 'unusual_activity', `${w.length} requests in 10 minutes`, 'high');
  next();
}
// Extra CSRF guard for state-changing admin calls (on top of SameSite=Strict).
function requireXhr(req, res, next) {
  if (req.get('X-Requested-With') === 'fetch') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// ---------- validation ----------
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
function validateEnquiry(body) {
  const errors = {};
  const student_name = clean(body.student_name, 80);
  let mobile = String(body.mobile ?? '').replace(/[\s-]/g, '');
  mobile = mobile.replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  const email = clean(body.email, 120).toLowerCase();
  const level = clean(body.level, 4);
  const programme = clean(body.programme, 30);
  const branch = clean(body.branch, 60);
  const city = clean(body.city, 60).replace(/[^A-Za-z\u0900-\u097F .'()-]/g, '');

  if (!/^[A-Za-zऀ-ॿ .'-]{2,80}$/.test(student_name)) errors.student_name = 'Please enter a valid full name.';
  if (!/^[6-9]\d{9}$/.test(mobile)) errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!isValid(level, programme, branch || '')) errors.course = branch || !/Tech/.test(programme) ? 'Please choose a programme.' : 'Please choose your branch.';
  if (city.length < 2) errors.city = 'Please enter your city or district.';
  if (!body.consent) errors.consent = 'Please accept to be contacted.';
  const { region } = resolveRegion(city);
  return { errors, data: { student_name, mobile, email: email || null, level, programme, branch: branch || '', course: courseLabel(programme, branch), city, region } };
}

// ---------- public routes ----------
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'] }));

app.post('/', (_req, res) => res.redirect(303, '/'));
// ---------- QR codes ("scan to fill on your phone") ----------
const refSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
function formUrl(req, ref) {
  const u = new URL((PUBLIC_URL || `${req.protocol}://${req.get('host')}`) + '/');
  u.searchParams.set('src', 'qr');
  if (ref) u.searchParams.set('ref', ref);
  return u.toString();
}
app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(formUrl(req, refSlug(req.query.ref)), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B1F4B', light: '#FFFFFF' } });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
});
// Name of the counsellor behind a personal QR (only active accounts, only the display name)
app.get('/api/ref', async (req, res) => {
  const u = req.query.u ? await db.getUserAuth(refSlug(req.query.u)) : null;
  res.json(u && Number(u.active) ? { name: u.name } : {});
});
// Printable A4 poster with the QR code
app.get('/qr-poster.pdf', async (req, res) => {
  const ref = refSlug(req.query.ref);
  const owner = ref ? await db.getUserAuth(ref) : null;
  const url = formUrl(req, owner && Number(owner.active) ? ref : '');
  const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 900, color: { dark: '#0B1F4B', light: '#FFFFFF' } });
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'ADYPU Admission Enquiry - Scan QR', Author: 'ADYPU Admission Desk' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ADYPU_Admission_QR_Poster${owner ? '_' + ref : ''}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width, H = doc.page.height, NAVY = '#0B1F4B', ORANGE = '#F08A24';
  doc.rect(0, 0, W, 200).fill(NAVY);
  doc.circle(W - 30, 20, 120).fillOpacity(0.28).fill(ORANGE).fillOpacity(1);
  doc.circle(20, 110, 70).fillOpacity(0.14).fill('#3B82F6').fillOpacity(1);
  doc.fillColor('#FFD8A8').font('Helvetica-Bold').fontSize(12).text('AJEENKYA DY PATIL UNIVERSITY  ·  PUNE', 0, 46, { width: W, align: 'center', characterSpacing: 2 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(34).text('Your next chapter', 0, 78, { width: W, align: 'center' });
  doc.fillColor(ORANGE).text('begins here.', 0, 118, { width: W, align: 'center' });
  doc.fillColor('#DBE4FF').font('Helvetica').fontSize(13).text(`Admissions ${ACADEMIC_YEAR.replace('–', '-')}  ·  UG & PG  ·  Free counselling`, 0, 164, { width: W, align: 'center' });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(24).text('Scan to enquire in 30 seconds', 0, 236, { width: W, align: 'center' });
  doc.fillColor('#64748B').font('Helvetica').fontSize(12).text('Open your phone camera, point it at the code and fill the short form.', 0, 268, { width: W, align: 'center' });
  const qs = 230, qx = (W - qs) / 2, qy = 300;
  doc.roundedRect(qx - 16, qy - 16, qs + 32, qs + 32, 18).lineWidth(4).strokeColor(ORANGE).stroke();
  doc.image(png, qx, qy, { width: qs, height: qs });
  doc.fillColor('#94A3B8').font('Helvetica').fontSize(9).text(url, 40, qy + qs + 26, { width: W - 80, align: 'center' });
  let y = qy + qs + 46;
  if (owner && Number(owner.active)) {
    doc.roundedRect(W / 2 - 170, y, 340, 30, 15).fill('#FFF4E6');
    doc.fillColor('#9A3412').font('Helvetica-Bold').fontSize(12.5).text(`Your counsellor: ${owner.name}${owner.mobile ? '  ·  ' + owner.mobile : ''}`, W / 2 - 170, y + 9, { width: 340, align: 'center' });
    y += 42;
  } else y += 6;
  doc.moveTo(50, y).lineTo(W - 50, y).lineWidth(0.6).strokeColor('#E2E8F0').stroke();
  y += 12;
  const head = (x, t) => doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(t, x, y);
  const list = (x, items, w, size = 10.5) => doc.fillColor('#334155').font('Helvetica').fontSize(size).text(items.join('\n'), x, y + 18, { width: w, lineGap: 2.5 });
  head(50, 'UG'); list(50, LEVELS.UG.map((p) => p.name), 110);
  head(165, 'PG'); list(165, LEVELS.PG.map((p) => p.name), 80);
  const br = (LEVELS.UG.find((p) => p.branches) || { branches: [] }).branches.map((b) => b.replace(/^Computer Science & Engineering$/, 'Computer Science & Engg.').replace(/^Electronics & Computer Engineering$/, 'Electronics & Computer Engg.'));
  head(255, 'B.Tech / M.Tech branches');
  const half = Math.ceil(br.length / 2);
  list(255, br.slice(0, half), 150, 9.8); list(410, br.slice(half), 150, 9.8);
  doc.rect(0, H - 92, W, 92).fill(NAVY);
  doc.rect(0, H - 96, W, 4).fill(ORANGE);
  doc.fillColor('#FFD8A8').font('Helvetica-Bold').fontSize(11).text('For further connection & queries', 0, H - 78, { width: W, align: 'center' });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(12).text(CONTACTS.map((c) => `${c.name}  ${c.phone.slice(0, 5)} ${c.phone.slice(5)}`).join('     |     '), 0, H - 58, { width: W, align: 'center' });
  doc.fillColor('#CBD5F5').fontSize(9).text('D Y Patil Knowledge City, Charholi Bk., Via Lohegaon, Pune - 411081', 0, H - 34, { width: W, align: 'center' });
  doc.end();
});

app.get('/api/config', (_req, res) => res.json({ levels: LEVELS, academicYear: ACADEMIC_YEAR, cities: CITY_SUGGESTIONS, otpRequired: OTP_REQUIRED, chips: chat.CHIPS, contacts: CONTACTS }));
app.get('/api/region', (req, res) => res.json(resolveRegion(String(req.query.city || '').slice(0, 60))));

// ---------- mobile OTP ----------
const normMobile = (m) => String(m ?? '').replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
const otpHash = (mobile, code) => crypto.createHmac('sha256', SESSION_SECRET).update(`otp:${mobile}:${code}`).digest('hex');
const OTP_TTL = 5 * 60 * 1000, RESEND_GAP = 30 * 1000, MAX_SENDS = 5, SEND_WINDOW = 60 * 60 * 1000, MAX_TRIES = 5;
function verifiedToken(mobile) {
  const payload = Buffer.from(JSON.stringify({ m: mobile, exp: Date.now() + 20 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign('v:' + payload)}`;
}
function checkVerifiedToken(token, mobile) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const exp = sign('v:' + payload);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return false;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return d.m === mobile && d.exp > Date.now(); } catch { return false; }
}
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many OTP requests from this network. Please try again later.' } });

app.post('/api/otp/send', otpLimiter, async (req, res) => {
  try {
    const mobile = normMobile(req.body.mobile);
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    const now = Date.now();
    const prev = await db.getOtp(mobile);
    if (prev && now - prev.last_sent < RESEND_GAP) return res.status(429).json({ error: 'Please wait a few seconds before requesting another OTP.', resendIn: Math.ceil((RESEND_GAP - (now - prev.last_sent)) / 1000) });
    const inWindow = prev && now - prev.window_start < SEND_WINDOW;
    if (inWindow && prev.sends >= MAX_SENDS) return res.status(429).json({ error: 'OTP limit reached for this number. Please try again after an hour or call the admissions office.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.saveOtp({ mobile, code_hash: otpHash(mobile, code), expires_at: now + OTP_TTL, attempts: 0,
      sends: inWindow ? prev.sends + 1 : 1, window_start: inWindow ? prev.window_start : now, last_sent: now });
    const sent = OTP_DEMO ? { ok: true } : await sms.send('otp', mobile, { otp: code });
    if (!sent.ok) return res.status(502).json({ error: 'Could not send the OTP right now. Please try again in a minute.' });
    res.json({ ok: true, resendIn: RESEND_GAP / 1000, expiresIn: OTP_TTL / 1000, ...(OTP_DEMO ? { demoOtp: code } : {}) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

app.post('/api/otp/verify', otpLimiter, async (req, res) => {
  try {
    const mobile = normMobile(req.body.mobile);
    const code = String(req.body.otp || '').replace(/\D/g, '');
    const rec = await db.getOtp(mobile);
    if (!rec || !rec.code_hash || rec.expires_at < Date.now()) return res.status(400).json({ error: 'OTP expired. Please request a new one.', expired: true });
    if (rec.attempts >= MAX_TRIES) return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.', expired: true });
    const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(otpHash(mobile, code)), Buffer.from(rec.code_hash));
    if (!ok) { await db.bumpOtpAttempts(mobile); return res.status(400).json({ error: `Incorrect OTP. ${MAX_TRIES - rec.attempts - 1} attempt(s) left.` }); }
    await db.clearOtp(mobile);
    res.json({ ok: true, token: verifiedToken(mobile) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// ---------- chatbot ----------
const chatLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { reply: 'You are sending messages very fast. Please wait a minute and try again.' } });
app.post('/api/chat', chatLimiter, async (req, res) => {
  const text = String(req.body.message || '').slice(0, 500).trim();
  if (!text) return res.json({ reply: 'Please type a question.', chips: chat.CHIPS });
  res.json(await chat.answer(text, Array.isArray(req.body.history) ? req.body.history : []));
});

async function sendConfirmation(row) {
  if (!SEND_CONFIRMATION) return;
  const r = await sms.send('confirm', row.mobile, { first: row.student_name.split(' ')[0].slice(0, 20), course: row.course.slice(0, 45), ref: row.ref_no });
  await db.updateEnquiry(row.id, { sms_status: r.ok ? (r.via === 'console' ? 'logged' : r.via === 'whatsapp' ? 'whatsapp' : 'sent') : 'failed' });
}

const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions from this network. Please try again after some time.' } });

app.post('/api/enquiry', submitLimiter, async (req, res) => {
  try {
    if (req.body.website) return res.json({ ok: true, ref_no: 'ADYPU-OK' }); // honeypot: silently drop bots
    const { errors, data } = validateEnquiry(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: errors });
    const verified = checkVerifiedToken(req.body.otpToken, data.mobile);
    if (OTP_REQUIRED && !verified) return res.status(401).json({ error: 'Please verify your mobile number with the OTP.', needOtp: true });
    const dup = await db.findRecentDuplicate(data.mobile, data.course);
    if (dup) return res.json({ ok: true, ref_no: dup.ref_no, duplicate: true, name: dup.student_name });
    // Came from a counsellor's personal QR? Credit the enquiry to them.
    const refUser = req.body.ref ? await db.getUserAuth(refSlug(req.body.ref)) : null;
    const attribution = refUser && Number(refUser.active)
      ? { source: 'qr-ref', created_by_id: refUser.id, created_by_name: refUser.name, counsellor_id: refUser.id, counsellor_name: refUser.name }
      : { source: req.body.src === 'qr' ? 'qr' : 'web' };
    const row = await db.insertEnquiry({ ...data, ...attribution, mobile_verified: verified });
    sendConfirmation(row).catch((e) => console.error('confirmation SMS', e.message));
    res.json({ ok: true, ref_no: row.ref_no, name: row.student_name, smsSent: SEND_CONFIRMATION });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- admin auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

app.get('/admin/login', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
const fails = new Map(); // username → { n, until }
const LOCK_AFTER = 5, LOCK_MIN = 15;
const challenges = new Map(); // admin OTP challenges
function setSession(res, data, req) { res.setHeader('Set-Cookie', `adm=${issueToken(data, req)}; Max-Age=${SESSION_HOURS * 3600}; ${cookieOpts}`); }
app.post('/api/admin/login', loginLimiter, requireXhr, async (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().slice(0, 40), key = uname.toLowerCase();
  const f = fails.get(key);
  if (f && f.until > Date.now()) {
    audit(req, 'login_while_locked', uname, 'medium', { username: uname });
    return res.status(429).json({ error: `Too many wrong attempts. This account is locked for ${Math.ceil((f.until - Date.now()) / 60000)} more minutes.` });
  }
  const failed = async () => {
    const r = fails.get(key) || { n: 0, until: 0 }; r.n += 1;
    if (r.n >= LOCK_AFTER) { r.until = Date.now() + LOCK_MIN * 60000; r.n = 0; audit(req, 'account_locked', `${uname} after ${LOCK_AFTER} wrong passwords`, 'critical', { username: uname }); }
    else audit(req, 'login_failed', uname, r.n >= 3 ? 'medium' : 'low', { username: uname });
    fails.set(key, r);
    return res.status(401).json({ error: 'Invalid username or password.' });
  };
  const isMain = uname.length === ADMIN_USER.length && crypto.timingSafeEqual(Buffer.from(uname), Buffer.from(ADMIN_USER));
  if (isMain) {
    if (!(await bcrypt.compare(String(password || ''), ADMIN_HASH))) return failed();
    fails.delete(key);
    if (ADMIN_2FA) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), id = crypto.randomBytes(16).toString('base64url');
      challenges.set(id, { hash: sign('2fa:' + code), exp: Date.now() + 5 * 60000, tries: 0, d: devHash(req) });
      const sent = OTP_DEMO ? { ok: true } : await sms.send('otp', ADMIN_MOBILE, { otp: code });
      if (!sent.ok) return res.status(502).json({ error: 'Could not send the login OTP. Please try again.' });
      return res.json({ ok: true, otp: true, challenge: id, sentTo: sec.maskMobile(ADMIN_MOBILE), ...(OTP_DEMO ? { demoOtp: code } : {}) });
    }
    setSession(res, { u: ADMIN_USER, role: 'admin' }, req);
    audit(req, 'admin_login', 'password', 'info', { role: 'admin', u: ADMIN_USER });
    return res.json({ ok: true, role: 'admin', redirect: '/admin' });
  }
  const u = await db.getUserAuth(uname);
  const ok = await bcrypt.compare(String(password || ''), u ? u.pass_hash : ADMIN_HASH); // compare anyway: same timing
  if (!u || !ok) return failed();
  if (!Number(u.active)) { audit(req, 'disabled_account_login', uname, 'medium', { username: uname, id: u.id, role: 'sub' }); return res.status(403).json({ error: 'This account is disabled. Please contact the admin.' }); }
  fails.delete(key);
  await db.touchLogin(u.id);
  setSession(res, { u: u.username, role: 'sub', id: u.id, n: u.name, pv: passVer(u.pass_hash) }, req);
  audit(req, 'sub_admin_login', '', 'info', { role: 'sub', id: u.id, username: u.username });
  res.json({ ok: true, role: 'sub', redirect: '/team' });
});
app.post('/api/admin/login/verify', loginLimiter, requireXhr, async (req, res) => {
  const c = challenges.get(String(req.body.challenge || ''));
  if (!c || c.exp < Date.now() || c.d !== devHash(req)) return res.status(400).json({ error: 'This code has expired. Please sign in again.', restart: true });
  const code = String(req.body.otp || '').replace(/\D/g, '');
  const good = code.length === 6 && crypto.timingSafeEqual(Buffer.from(sign('2fa:' + code)), Buffer.from(c.hash));
  if (!good) {
    c.tries += 1;
    if (c.tries >= 5) { challenges.delete(String(req.body.challenge)); audit(req, 'admin_otp_failed', '5 wrong login codes', 'critical', { role: 'admin', u: ADMIN_USER }); return res.status(429).json({ error: 'Too many wrong codes. Please sign in again.', restart: true }); }
    return res.status(400).json({ error: `Incorrect code. ${5 - c.tries} attempt(s) left.` });
  }
  challenges.delete(String(req.body.challenge));
  setSession(res, { u: ADMIN_USER, role: 'admin' }, req);
  audit(req, 'admin_login', 'password + mobile OTP', 'info', { role: 'admin', u: ADMIN_USER });
  res.json({ ok: true, role: 'admin', redirect: '/admin' });
});
app.post('/api/admin/logout', (req, res) => {
  const t = readToken(req); if (t) audit(req, 'logout', '', 'info', { ...t, username: t.u });
  res.setHeader('Set-Cookie', `adm=; Max-Age=0; ${cookieOpts}`);
  res.json({ ok: true });
});

// Who is signed in (for the on-screen watermark)
app.get('/api/security/whoami', (req, res) => {
  const t = readToken(req); if (!t) return res.status(401).json({});
  res.json({ role: t.role === 'sub' ? 'sub' : 'admin', name: t.role === 'sub' ? t.n : ADMIN_NAME, username: t.u, ip: req.ip, idleMinutes: Number(process.env.IDLE_MINUTES || 15) });
});
// Copy / print / screenshot / right-click attempts reported by the dashboards
const EVENTS = { copy: 'copy_attempt', cut: 'copy_attempt', paste: 'paste_attempt', print: 'print_attempt', screenshot: 'screenshot_attempt', contextmenu: 'right_click',
  selectall: 'select_all_attempt', devtools: 'developer_tools_opened', save: 'save_page_attempt', drag: 'drag_data_attempt' };
const eventLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: false, legacyHeaders: false });
app.post('/api/security/event', eventLimiter, requireXhr, async (req, res) => {
  const t = readToken(req); if (!t) return res.status(401).json({});
  const action = EVENTS[req.body.type]; if (!action) return res.status(400).json({});
  const isSub = t.role === 'sub';
  const sev = isSub ? (['copy_attempt', 'print_attempt', 'screenshot_attempt', 'developer_tools_opened', 'save_page_attempt', 'drag_data_attempt', 'select_all_attempt'].includes(action) ? 'high' : 'medium') : 'info';
  await audit(req, action, `${String(req.body.page || '').slice(0, 40)}${req.body.detail ? ' · ' + String(req.body.detail).slice(0, 80) : ''}`, sev, { ...t, username: t.u });
  res.json({ ok: true, notified: SEVERE.has(sev) });
});

app.get('/admin', requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/admin/admin.js', requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.js')));
app.get('/team', requireSub, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'team.html')));
app.get('/team/team.js', requireSub, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'team.js')));

// ---------- sub-admin (team) API ----------
const teamRow = (row, me) => row && (row.created_by_id === me.id || row.counsellor_id === me.id);
// Sub-admins never receive full contact details — only masked values.
const masked = (r) => r && ({ ...r, mobile: sec.maskMobile(r.mobile), email: r.email ? sec.maskEmail(r.email) : '', mobile_masked: true });
function teamData(body) {
  const { errors, data } = validateEnquiry({ ...body, consent: true });
  const status = STATUSES.includes(body.status) ? body.status : 'New';
  return { errors, data: { ...data, status, notes: String(body.notes || '').slice(0, 500) } };
}
async function pushStudent(body, me, sendSms) {
  const { errors, data } = teamData(body);
  if (Object.keys(errors).length) return { errors };
  const existing = await db.findExisting(data.mobile, data.course);
  if (existing) return { duplicate: existing };
  const row = await db.insertEnquiry({ ...data, source: 'subadmin', created_by_id: me.id, created_by_name: me.name, counsellor_id: me.id, counsellor_name: me.name });
  if (sendSms) await sendConfirmation(row).catch((e) => console.error('confirmation SMS', e.message));
  return { row };
}
const teamFilters = (q, me) => ({ q: q.q, level: q.level, programme: q.programme, branch: q.branch, status: q.status, from: q.from, to: q.to, sort: q.sort, dir: q.dir, scopeUser: me.id });

app.get('/api/team/me', requireSub, (req, res) => res.json({ user: req.user, statuses: STATUSES, levels: LEVELS, cities: CITY_SUGGESTIONS, smsProvider: sms.provider }));
app.get('/api/team/enquiries', requireSub, async (req, res) => {
  const f = teamFilters(req.query, req.user);
  // searching by a full mobile number would let someone confirm numbers — only names, refs and cities are searchable here
  if (f.q && /\d{4,}/.test(f.q)) { audit(req, 'mobile_number_search', 'searched by digits', 'medium'); f.q = f.q.replace(/\d/g, ''); }
  res.json({ rows: (await db.listEnquiries(f)).map(masked), allowReveal: await db.getSetting('allow_reveal', false) });
});
// Optional, admin-controlled: let a counsellor see ONE student's number to call them (every reveal is logged and alerted)
app.post('/api/team/enquiries/:id/reveal', requireSub, requireXhr, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10));
  if (!teamRow(row, req.user)) { audit(req, 'reveal_other_student', `id ${req.params.id}`, 'high'); return res.status(404).json({ error: 'Not found' }); }
  if (!(await db.getSetting('allow_reveal', false))) { audit(req, 'reveal_denied', row.ref_no, 'medium'); return res.status(403).json({ error: 'Viewing contact numbers is switched off by the admin.' }); }
  audit(req, 'contact_number_viewed', `${row.ref_no}`, 'medium');
  res.json({ mobile: row.mobile });
});
app.post('/api/team/enquiries', requireSub, requireXhr, async (req, res) => {
  try {
    const r = await pushStudent(req.body, req.user, req.body.sendSms !== false);
    if (r.errors) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: r.errors });
    if (r.duplicate) return res.status(409).json({ error: `This student is already registered (${r.duplicate.ref_no}). Please contact the admin if you need it assigned to you.` });
    audit(req, 'student_added', r.row.ref_no, 'info');
    res.json({ ok: true, row: masked(await db.getEnquiry(r.row.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.patch('/api/team/enquiries/:id', requireSub, requireXhr, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10));
  if (!teamRow(row, req.user)) return res.status(404).json({ error: 'Not found' });
  const upd = {};
  if (req.body.status !== undefined) { if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' }); upd.status = req.body.status; }
  if (req.body.notes !== undefined) upd.notes = String(req.body.notes).slice(0, 500);
  res.json({ row: masked(await db.updateEnquiry(row.id, upd)) });
});

// Bulk upload: .xlsx or .csv, first row = headers. Columns are matched by name, in any order.
const HEAD = { student_name: /^(student )?name|full ?name/, mobile: /mobile|phone|contact/, email: /e-?mail/, city: /city|district/, level: /^level|ug ?\/ ?pg/,
  programme: /programme|program|course/, branch: /branch|specialis|specializ/, status: /status/, notes: /note|remark/ };
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
async function readSheet(buf, name) {
  if (/\.csv$/i.test(name)) return parseCsv(buf.toString('utf8').replace(/^\uFEFF/, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const out = [];
  ws.eachRow({ includeEmpty: false }, (r) => out.push((r.values || []).slice(1).map((v) => (v && typeof v === 'object' ? (v.text || v.result || (v.richText ? v.richText.map((t) => t.text).join('') : '')) : v ?? ''))));
  return out;
}
const importLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many uploads. Please wait a few minutes.' } });
app.post('/api/team/import', requireSub, requireXhr, importLimiter, express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
  try {
    const name = String(req.query.name || 'upload.xlsx');
    if (!/\.(xlsx|csv)$/i.test(name)) return res.status(400).json({ error: 'Please upload an .xlsx or .csv file.' });
    const grid = await readSheet(req.body, name);
    const hi = grid.findIndex((r) => r.some((c) => /name/i.test(String(c))) && r.some((c) => /mobile|phone/i.test(String(c))));
    if (hi < 0) return res.status(400).json({ error: 'Could not find the header row. Please use the template (Student Name, Mobile, …).' });
    const head = grid[hi].map((h) => String(h).toLowerCase().trim());
    const col = Object.fromEntries(Object.entries(HEAD).map(([k, re]) => [k, head.findIndex((h) => re.test(h))]));
    const body = grid.slice(hi + 1).filter((r) => r.some((c) => String(c).trim()));
    if (body.length > 1000) return res.status(400).json({ error: 'Please upload at most 1000 students at a time.' });
    const sendSms = req.query.sms === '1';
    const result = { added: [], duplicates: [], errors: [] };
    for (let i = 0; i < body.length; i++) {
      const r = body[i], g = (k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
      let level = g('level').toUpperCase(), programme = g('programme'), branch = g('branch');
      // friendly matching: "btech" → "B.Tech", "Mechanical" → "Mechanical Engineering", missing level inferred
      const allProgs = [...LEVELS.UG.map((p) => ['UG', p]), ...LEVELS.PG.map((p) => ['PG', p])];
      const pm = allProgs.find(([, p]) => p.name.toLowerCase().replace(/[^a-z]/g, '') === programme.toLowerCase().replace(/[^a-z]/g, ''));
      if (pm) { programme = pm[1].name; if (!level) level = pm[0]; }
      if (pm && pm[1].branches && branch) { const bm = pm[1].branches.find((b) => b.toLowerCase().startsWith(branch.toLowerCase().replace(/ engineering$/, '')) || b.toLowerCase() === branch.toLowerCase()); if (bm) branch = bm; }
      const st = STATUSES.find((s) => s.toLowerCase() === g('status').toLowerCase());
      const out = await pushStudent({ student_name: g('student_name'), mobile: g('mobile'), email: g('email'), city: g('city'), level, programme, branch, status: st || 'New', notes: g('notes') }, req.user, sendSms);
      const line = hi + i + 2;
      if (out.errors) result.errors.push({ line, name: g('student_name'), problems: Object.values(out.errors) });
      else if (out.duplicate) result.duplicates.push({ line, name: g('student_name'), ref: out.duplicate.ref_no });
      else result.added.push({ line, name: out.row.student_name, ref: out.row.ref_no });
    }
    audit(req, 'bulk_upload', `${name}: ${result.added.length} added, ${result.duplicates.length} duplicates, ${result.errors.length} errors`, 'info');
    res.json({ ok: true, total: body.length, ...result });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Could not read that file. Please use the template.' }); }
});
app.get('/api/team/template.xlsx', requireSub, async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.columns = [['Student Name', 26], ['Mobile', 14], ['Email', 28], ['City', 16], ['Level', 8], ['Programme', 16], ['Branch', 34], ['Status', 18], ['Notes', 30]].map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }; });
  // Examples live on their own sheet so they are never uploaded by mistake (only the first sheet is read).
  const ex = wb.addWorksheet('Example');
  ex.columns = ws.columns.map((c) => ({ header: c.header, width: c.width }));
  ex.getRow(1).font = { bold: true };
  ex.addRow(['Aarya Patil', '9876543210', 'aarya@example.com', 'Pune', 'UG', 'B.Tech', 'Mechanical Engineering', 'New', 'Met at school fair']);
  ex.addRow(['Rohan Deshmukh', '8123456789', '', 'Nashik', 'PG', 'MBA', '', 'Contacted', 'Branch is only needed for B.Tech / M.Tech']);
  const lists = wb.addWorksheet('Lists');
  const progs = [...LEVELS.UG.map((p) => p.name), ...LEVELS.PG.map((p) => p.name)];
  const branches = (LEVELS.UG.find((p) => p.branches) || { branches: [] }).branches;
  lists.getColumn(1).values = ['Level', 'UG', 'PG']; lists.getColumn(2).values = ['Programme', ...progs];
  lists.getColumn(3).values = ['Branch (B.Tech / M.Tech only)', ...branches]; lists.getColumn(4).values = ['Status', ...STATUSES];
  [1, 2, 3, 4].forEach((i) => { lists.getColumn(i).width = 34; lists.getCell(1, i).font = { bold: true }; });
  for (let r = 2; r <= 1001; r++) {
    ws.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$A$2:$A$3'] };
    ws.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$B$2:$B$${progs.length + 1}`] };
    ws.getCell(`G${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$C$2:$C$${branches.length + 1}`] };
    ws.getCell(`H${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$D$2:$D$${STATUSES.length + 1}`] };
    ws.getCell(`B${r}`).numFmt = '@';
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ADYPU_Student_Upload_Template.xlsx"');
  await wb.xlsx.write(res); res.end();
});

// ---------- main admin: team management ----------
const genPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; return Array.from(crypto.randomBytes(10), (b) => a[b % a.length]).join(''); };
// ---------- main admin: Security centre ----------
app.get('/api/admin/security', requireAdmin, async (req, res) => {
  const [events, unseen, allowReveal, raw] = await Promise.all([db.listAudit({ limit: Math.min(1000, +req.query.limit || 400), severity: req.query.severity || undefined }),
    db.countUnseenAlerts(), db.getSetting('allow_reveal', false), db.rawSample(3)]);
  res.json({ events, unseen, settings: { allowReveal },
    status: { adminName: ADMIN_NAME, encryption: 'AES-256-GCM (name, mobile, email, notes)', dataKey: !!process.env.DATA_KEY, twoFA: ADMIN_2FA, alertMobile: ADMIN_MOBILE ? sec.maskMobile(ADMIN_MOBILE) : '', alertEmail: !!mailer,
      smsProvider: sms.provider, https: IS_PROD, sessionHours: SESSION_HOURS, idleMinutes: Number(process.env.IDLE_MINUTES || 15) },
    // what someone opening the database directly would see
    rawSample: raw.map((r) => ({ ref_no: r.ref_no, student_name: String(r.student_name || '').slice(0, 30) + '…', mobile: String(r.mobile || '').slice(0, 30) + '…' })) });
});
app.post('/api/admin/security/seen', requireAdmin, requireXhr, async (_req, res) => { await db.markAlertsSeen(); res.json({ ok: true }); });
app.patch('/api/admin/security/settings', requireAdmin, requireXhr, async (req, res) => {
  if (req.body.allowReveal !== undefined) { await db.setSetting('allow_reveal', !!req.body.allowReveal); audit(req, 'setting_changed', `counsellors can view numbers: ${!!req.body.allowReveal ? 'ON' : 'OFF'}`, 'medium'); }
  res.json({ ok: true, settings: { allowReveal: await db.getSetting('allow_reveal', false) } });
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const [users, rows] = await Promise.all([db.listUsers(), db.listEnquiries({})]);
  const wk = Date.now() - 7 * 864e5;
  res.json({ users: users.map((u) => {
    const pushed = rows.filter((r) => r.created_by_id === u.id), assigned = rows.filter((r) => r.counsellor_id === u.id);
    return { ...u, pushed: pushed.length, pushedWeek: pushed.filter((r) => new Date(r.created_at) > wk).length, assigned: assigned.length,
      admitted: assigned.filter((r) => r.status === 'Admitted').length, pending: assigned.filter((r) => r.status === 'New').length };
  }) });
});
app.post('/api/admin/users', requireAdmin, requireXhr, async (req, res) => {
  const name = clean(req.body.name, 60), username = clean(req.body.username, 30).toLowerCase(), mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10);
  const password = String(req.body.password || '') || genPassword();
  if (name.length < 2) return res.status(400).json({ error: 'Please enter the full name.' });
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || username === ADMIN_USER.toLowerCase()) return res.status(400).json({ error: 'Username: 3–30 letters, numbers, dot, dash or underscore.' });
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await db.getUserAuth(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const user = await db.createUser({ name, username, mobile, pass_hash: await bcrypt.hash(password, 12) });
  audit(req, 'sub_admin_created', `${name} (@${username})`, 'info');
  res.json({ ok: true, user, password });
});
app.patch('/api/admin/users/:id', requireAdmin, requireXhr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await db.getUser(id))) return res.status(404).json({ error: 'Not found' });
  const upd = {}; let password;
  if (req.body.name !== undefined) upd.name = clean(req.body.name, 60);
  if (req.body.mobile !== undefined) upd.mobile = String(req.body.mobile).replace(/\D/g, '').slice(-10);
  if (req.body.active !== undefined) upd.active = !!req.body.active;
  if (req.body.resetPassword) { password = genPassword(); upd.pass_hash = await bcrypt.hash(password, 12); audit(req, 'password_reset', `user #${id} (old sessions signed out)`, 'info'); }
  if (req.body.active !== undefined) audit(req, req.body.active ? 'account_enabled' : 'account_disabled', `user #${id}`, 'info');
  res.json({ ok: true, user: await db.updateUser(id, upd), password });
});

// ---------- admin API ----------
const pickFilters = (q) => ({ pushedBy: q.pushedBy, counsellor: q.counsellor, q: q.q, level: q.level, programme: q.programme, branch: q.branch, status: q.status, region: q.region, verified: q.verified, from: q.from, to: q.to, sort: q.sort, dir: q.dir });

app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  const rows = await db.listEnquiries(pickFilters(req.query));
  const team = (await db.listUsers()).map((u) => ({ id: u.id, name: u.name, active: u.active }));
  res.json({ rows, statuses: STATUSES, levels: LEVELS, regions: REGIONS, smsProvider: sms.provider, team, unseenAlerts: await db.countUnseenAlerts() });
});

app.patch('/api/admin/enquiries/:id', requireAdmin, requireXhr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const upd = {};
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    upd.status = req.body.status;
  }
  if (req.body.notes !== undefined) upd.notes = String(req.body.notes).slice(0, 500);
  if (req.body.counsellor_id !== undefined) {
    if (req.body.counsellor_id === null || req.body.counsellor_id === '') { upd.counsellor_id = null; upd.counsellor_name = null; }
    else { const u = await db.getUser(parseInt(req.body.counsellor_id, 10)); if (!u) return res.status(400).json({ error: 'Unknown counsellor' }); upd.counsellor_id = u.id; upd.counsellor_name = u.name; }
  }
  res.json({ row: await db.updateEnquiry(id, upd) });
});

app.post('/api/admin/enquiries/:id/sms', requireAdmin, requireXhr, async (req, res) => {
  const row = (await db.listEnquiries({})).find((r) => r.id === parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const r = await sms.send('confirm', row.mobile, { first: row.student_name.split(' ')[0].slice(0, 20), course: row.course.slice(0, 45), ref: row.ref_no });
  const out = await db.updateEnquiry(row.id, { sms_status: r.ok ? (r.via === 'console' ? 'logged' : r.via === 'whatsapp' ? 'whatsapp' : 'sent') : 'failed' });
  res.status(r.ok ? 200 : 502).json({ row: out, ok: r.ok });
});

app.delete('/api/admin/enquiries/:id', requireAdmin, requireXhr, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10)); if (row) audit(req, 'enquiry_deleted', row.ref_no, 'medium');
  await db.deleteEnquiry(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ---------- exports ----------
const fmtIST = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const stamp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function filterLabel(f) {
  const parts = [];
  if (f.level) parts.push(`Level: ${f.level}`);
  if (f.programme) parts.push(`Programme: ${f.programme}`);
  if (f.branch) parts.push(`Branch: ${f.branch}`);
  if (f.status) parts.push(`Status: ${f.status}`);
  if (f.region) parts.push(`Region: ${f.region}`);
  if (f.verified) parts.push(`Mobile verified: ${f.verified}`);
  if (f.pushedByName) parts.push(`Pushed by: ${f.pushedByName}`);
  if (f.counsellorName) parts.push(`Counsellor: ${f.counsellorName}`);
  if (f.from || f.to) parts.push(`Dates: ${f.from || '…'} to ${f.to || '…'}`);
  if (f.q) parts.push(`Search: "${f.q}"`);
  const SORTN = { pushed: 'Pushed by', counsellor: 'Counsellor', date: 'Date', name: 'Name', programme: 'Programme', branch: 'Branch', level: 'Level', region: 'Region', city: 'City', course: 'Course', status: 'Status' };
  const sortTxt = `Sorted by ${SORTN[f.sort] || 'Date'} (${f.dir === 'asc' ? 'ascending' : 'descending'})`;
  return (parts.length ? parts.join('  |  ') : 'All enquiries') + '  |  ' + sortTxt;
}
const pushedLabel = (r) => (r.source === 'qr-ref' ? `${r.created_by_name} (QR)` : r.created_by_name || (r.source === 'qr' ? 'QR scan' : 'Website form'));
async function exportFilters(q) {
  const f = pickFilters(q);
  if (f.pushedBy) f.pushedByName = f.pushedBy === 'web' ? 'Website form' : ((await db.getUser(parseInt(f.pushedBy, 10))) || {}).name;
  if (f.counsellor) f.counsellorName = f.counsellor === 'none' ? 'Unassigned' : ((await db.getUser(parseInt(f.counsellor, 10))) || {}).name;
  return f;
}
function countBy(rows, key) {
  const m = {};
  rows.forEach((r) => { m[r[key]] = (m[r[key]] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
const istDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function countByDate(rows) {
  const m = {};
  rows.forEach((r) => { const d = istDay(r.created_at); m[d] = (m[d] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]));
}

const stampLine = (req) => `CONFIDENTIAL · Downloaded by main admin · ${fmtIST(new Date().toISOString())} IST · IP ${req.ip} · Do not share`;
app.get('/api/admin/export.xlsx', requireAdmin, async (req, res) => {
  const f = await exportFilters(req.query);
  const rows = await db.listEnquiries(f);
  audit(req, 'export_excel', `${rows.length} rows · ${filterLabel(f).slice(0, 120)}`, 'info');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ADYPU Admission Desk';
  wb.subject = 'CONFIDENTIAL student data - authorised use only';
  wb.keywords = `downloaded ${new Date().toISOString()} ip ${req.ip}`;
  const ws = wb.addWorksheet('Enquiries', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const cols = [['Sr.', 6], ['Reference No.', 17], ['Student Name', 26], ['Mobile', 14], ['Verified', 9], ['Email', 28], ['City', 16], ['Region', 24], ['Level', 7], ['Programme', 14], ['Branch', 30], ['Status', 17], ['Pushed By', 20], ['Counsellor', 20], ['Notes', 28], ['Submitted On (IST)', 21]];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell('A1').value = `Ajeenkya DY Patil University, Pune — Admission Enquiries ${ACADEMIC_YEAR}`;
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getCell('A2').value = `${filterLabel(f)}   •   Total records: ${rows.length}   •   ${stampLine(req)}`;
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };
  const head = ws.getRow(4);
  head.values = cols.map(([h]) => h);
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF08A24' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF0B1F4B' } } };
  });
  head.height = 22;
  rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, r.ref_no, r.student_name, r.mobile, r.mobile_verified ? 'Yes' : 'No', r.email || '', r.city || '', r.region || '', r.level, r.programme, r.branch || '—', r.status, pushedLabel(r), r.counsellor_name || 'Unassigned', r.notes || '', fmtIST(r.created_at)]);
    row.getCell(4).numFmt = '@';
    row.eachCell((c) => {
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FB' } };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 36 }, { width: 12 }];
  sum.addRow(['Admission Enquiry Summary']).font = { bold: true, size: 14 };
  sum.addRow([filterLabel(f)]).font = { italic: true, color: { argb: 'FF475569' } };
  sum.addRow([]);
  const section = (title, data) => {
    const h = sum.addRow([title, 'Count']);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }; });
    data.forEach(([k, v]) => sum.addRow([k, v]));
    sum.addRow([]);
  };
  section('By level (UG / PG)', countBy(rows, 'level'));
  section('By programme', countBy(rows, 'programme'));
  section('By engineering branch', countBy(rows.filter((r) => r.branch), 'branch'));
  section('By status', countBy(rows, 'status'));
  section('By pushed by', countBy(rows.map((r) => ({ k: pushedLabel(r) })), 'k'));
  section('By counsellor', countBy(rows.map((r) => ({ k: r.counsellor_name || 'Unassigned' })), 'k'));
  section('By region', countBy(rows.map((r) => ({ ...r, region: r.region || 'Not given' })), 'region'));
  section('By date (IST)', countByDate(rows));
  section('Mobile verified', countBy(rows.map((r) => ({ v: r.mobile_verified ? 'Verified' : 'Not verified' })), 'v'));
  sum.addRow(['Total', rows.length]).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ADYPU_Admission_Enquiries_${stamp()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/admin/export.pdf', requireAdmin, async (req, res) => {
  const f = await exportFilters(req.query);
  const rows = await db.listEnquiries(f);
  audit(req, 'export_pdf', `${rows.length} rows · ${filterLabel(f).slice(0, 120)}`, 'info');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: 'ADYPU Admission Enquiries', Author: 'ADYPU Admission Desk' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ADYPU_Admission_Enquiries_${stamp()}.pdf"`);
  doc.pipe(res);

  const NAVY = '#0B1F4B', ORANGE = '#F08A24', GREY = '#475569';
  const W = doc.page.width, L = 36, R = W - 36;
  const header = () => {
    doc.rect(0, 0, W, 64).fill(NAVY);
    doc.rect(0, 64, W, 4).fill(ORANGE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('Ajeenkya DY Patil University, Pune', L, 16);
    doc.font('Helvetica').fontSize(10).fillColor('#FFD8A8').text(`Admission Enquiry Report  •  Academic Year ${ACADEMIC_YEAR}`, L, 38);
    doc.fillColor('#FFFFFF').fontSize(9).text(`Generated: ${fmtIST(new Date().toISOString())}`, L, 22, { width: R - L, align: 'right' });
  };
  header();
  doc.y = 82;
  doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(9).text(filterLabel(f), L, doc.y);

  // summary tiles
  const tiles = [['Total enquiries', rows.length], ['UG', rows.filter((r) => r.level === 'UG').length],
    ['PG', rows.filter((r) => r.level === 'PG').length], ['Admitted', rows.filter((r) => r.status === 'Admitted').length]];
  const tw = (R - L - 30) / 4, ty = doc.y + 8;
  tiles.forEach(([k, v], i) => {
    const x = L + i * (tw + 10);
    doc.roundedRect(x, ty, tw, 40, 6).fill('#F1F5F9');
    doc.rect(x, ty, 4, 40).fill(ORANGE);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(String(v), x + 14, ty + 6);
    doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(k, x + 14, ty + 26);
  });
  doc.y = ty + 54;

  const cols = [['#', 22], ['Ref. No.', 74], ['Student Name', 112], ['Mobile', 72], ['City / Region', 118], ['Programme', 112], ['Status', 70], ['Pushed by / Counsellor', 110], ['Submitted (IST)', 80]];
  const drawHead = () => {
    const y = doc.y;
    doc.rect(L, y, R - L, 20).fill(NAVY);
    let x = L;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
    cols.forEach(([h, w]) => { doc.text(h, x + 4, y + 6, { width: w - 8 }); x += w; });
    doc.y = y + 20;
  };
  drawHead();
  doc.font('Helvetica').fontSize(8.5);
  rows.forEach((r, i) => {
    const vals = [i + 1, r.ref_no, r.student_name, `${r.mobile}${r.mobile_verified ? '  (verified)' : ''}`, r.city ? `${r.city}\n${r.region || ''}` : '—', `${r.level} · ${r.programme}${r.branch ? '\n' + r.branch : ''}`, r.status, `${pushedLabel(r)}\n→ ${r.counsellor_name || 'Unassigned'}`, fmtIST(r.created_at)];
    const h = Math.max(18, ...vals.map((v, k) => doc.heightOfString(String(v), { width: cols[k][1] - 8 }) + 8));
    if (doc.y + h > doc.page.height - 50) { doc.addPage(); header(); doc.y = 82; drawHead(); doc.font('Helvetica').fontSize(8.5); }
    const y = doc.y;
    if (i % 2) doc.rect(L, y, R - L, h).fill('#F5F7FB');
    let x = L;
    doc.fillColor('#0F172A');
    vals.forEach((v, k) => { doc.text(String(v), x + 4, y + 4, { width: cols[k][1] - 8 }); x += cols[k][1]; });
    doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.3).strokeColor('#CBD5E1').stroke();
    doc.y = y + h;
  });
  if (!rows.length) doc.fillColor(GREY).text('No enquiries match the selected filters.', L, doc.y + 10);

  // region-wise and date-wise summary, side by side
  if (rows.length) {
    const regions = countBy(rows.map((r) => ({ region: r.region || 'Not given' })), 'region').slice(0, 12);
    const dates = countByDate(rows).slice(0, 12);
    const need = 40 + Math.max(regions.length, dates.length) * 15;
    if (doc.y + need > doc.page.height - 120) { doc.addPage(); header(); doc.y = 90; }
    const y0 = doc.y + 18, half = (R - L - 30) / 2;
    const block = (x, title, data) => {
      doc.rect(x, y0, half, 18).fill(NAVY);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9).text(title, x + 6, y0 + 5, { width: half - 60 }).text('Count', x + half - 50, y0 + 5, { width: 44, align: 'right' });
      const max = Math.max(...data.map((d) => d[1]), 1);
      data.forEach(([k, v], i) => {
        const y = y0 + 22 + i * 15;
        doc.rect(x + half - 150, y + 2, 92 * (v / max), 8).fill('#F6B26B');
        doc.fillColor('#0F172A').font('Helvetica').fontSize(8.5).text(k, x + 6, y + 1, { width: half - 170, lineBreak: false, ellipsis: true })
          .text(String(v), x + half - 50, y + 1, { width: 44, align: 'right' });
      });
    };
    block(L, 'Region-wise enquiries', regions);
    block(L + half + 30, 'Date-wise enquiries (IST)', dates);
    doc.y = y0 + 26 + Math.max(regions.length, dates.length) * 15;
  }

  // signature block on last page
  if (doc.y + 70 > doc.page.height - 50) { doc.addPage(); header(); doc.y = 90; }
  const sy = doc.y + 36;
  doc.strokeColor('#94A3B8').lineWidth(0.6).moveTo(L, sy).lineTo(L + 170, sy).stroke().moveTo(R - 170, sy).lineTo(R, sy).stroke();
  doc.fillColor(GREY).fontSize(9).text('Prepared by (Admission Desk)', L, sy + 4, { width: 170 })
    .text('Verified by (Authorised Signatory)', R - 170, sy + 4, { width: 170, align: 'right' });

  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0;
    // diagonal watermark: traces any leaked printout back to this download
    doc.save().rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] }).fillOpacity(0.06).fillColor('#0B1F4B').font('Helvetica-Bold').fontSize(64)
      .text('CONFIDENTIAL', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false }).restore().fillOpacity(1);
    doc.fillColor('#B91C1C').font('Helvetica').fontSize(7.5).text(stampLine(req), L, doc.page.height - 42, { width: R - L, align: 'center', lineBreak: false });
    doc.fillColor('#94A3B8').fontSize(8).text(`D Y Patil Knowledge City, Charholi Bk., Via Lohegaon, Pune – 411081   •   Page ${p + 1} of ${range.count}`,
      L, doc.page.height - 30, { width: R - L, align: 'center', lineBreak: false });
  }
  doc.end();
});

app.get('/healthz', (_req, res) => res.send('ok'));
app.use((_req, res) => res.redirect('/'));

db.init().then(() => app.listen(PORT, () => console.log(`ADYPU admission portal running on http://localhost:${PORT}`)))
  .catch((e) => { console.error('DB init failed', e); process.exit(1); });
