require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
// PDFs made inside a college carry that college's name instead of ADYPU
{ const t0 = PDFDocument.prototype.text; PDFDocument.prototype.text = function (str, ...a) { return t0.call(this, typeof str === 'string' && require('./tenant').als.getStore() ? require('./tenant').brand(str) : str, ...a); }; }
const db = require('./db');
const { LEVELS, courseLabel, isValid } = require('./courses');
const sms = require('./sms');
const chat = require('./chat');
const { resolveRegion, CITY_SUGGESTIONS, REGIONS } = require('./regions');
const DEF_CONTACTS = require('./contacts');
const tenant = require('./tenant');
const T = () => tenant.als.getStore();
const QRCode = require('qrcode');
const sec = require('./sec');
const fs = require('fs');
// Cache-busting: every deploy gets a new version, so browsers always load the latest CSS/JS.
const ASSET_V = (process.env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 8);
const viewCache = {};
function sendView(res, name) {
  if (!viewCache[name] || !IS_PROD_CACHE) {
    viewCache[name] = fs.readFileSync(path.join(__dirname, 'views', name), 'utf8')
      .replace(/(href|src)="(\/[^"?]+\.(?:css|js))"/g, `$1="$2?v=${ASSET_V}"`);
  }
  res.set('Cache-Control', 'no-cache').type('html').send(T() && CC.brandHtml ? CC.brandHtml(viewCache[name]) : viewCache[name]);
}
// Public address of the site, used inside QR codes. Set PUBLIC_URL() (e.g. https://admissions.adypu.edu.in) once you have a domain.
const DEF_PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const PORT = process.env.PORT || 3000;
const DEF_ACADEMIC_YEAR = process.env.ACADEMIC_YEAR || '2027–28';
const DEF_ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const STATUSES = ['New', 'Contacted', 'Interested', 'Counselling Done', 'Form Sent', 'Applied', 'Admitted', 'Not Interested'];
const CALL_OUTCOMES = ['Connected', 'Not picked', 'Busy', 'Switched off', 'Not reachable', 'Wrong number', 'Call back later'];
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const validDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_PROD_CACHE = IS_PROD;
// OTP: on by default. OTP_DEMO_MODE=true shows the code on screen (testing only — never in production).
const OTP_REQUIRED = (process.env.OTP_REQUIRED || 'true') !== 'false'; // default; the admin can switch it in the Security tab
const otpOn = async () => !!(await db.getSetting('otp_required', require('./tenant').als.getStore() ? false : OTP_REQUIRED)); // colleges: off until their own SMS sender is set up
const OTP_DEMO = process.env.OTP_DEMO_MODE === 'true';
const SEND_CONFIRMATION = (process.env.SEND_CONFIRMATION_SMS || 'true') !== 'false';
// Student confirmation messages (SMS / WhatsApp) — admin switch in the Security tab; OFF until an official SMS pack / WhatsApp is ready
const studentMsgs = async () => (await db.getSetting('student_msgs', false)) === true && SEND_CONFIRMATION;
if (OTP_DEMO && IS_PROD) console.warn('⚠  OTP_DEMO_MODE is on in production — OTPs are shown on screen. Turn it off before going live!');
if (OTP_REQUIRED && sms.provider === 'console' && !OTP_DEMO) console.warn('⚠  SMS_PROVIDER=console: OTPs are only printed in this log, not sent. Configure an SMS provider before going live.');

// Admin password: prefer a bcrypt hash; fall back to a plain env password (hashed in memory).
let DEF_ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!DEF_ADMIN_HASH) {
  const pw = process.env.ADMIN_PASSWORD || 'ChangeMe@ADYPU2027';
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD not set — using the default. Set it before going live!');
  DEF_ADMIN_HASH = bcrypt.hashSync(pw, 12);
}
if (!process.env.SESSION_SECRET) console.warn('⚠  SESSION_SECRET not set — admin sessions reset on every restart.');
// Security alerts + admin two-step login go to this mobile (and optionally email)
const DEF_ADMIN_NAME = process.env.ADMIN_NAME || 'Dr. Atul Kathole';
const DEF_ADMIN_MOBILE = String(process.env.ADMIN_MOBILE || '9960889772').replace(/\D/g, '').slice(-10);
const DEF_ADMIN_2FA = !!DEF_ADMIN_MOBILE && process.env.ADMIN_2FA !== 'false';
// Admin login code + security alerts: 'email' (default) or 'sms' (also email). Switchable in the Security tab.
const adminSms = async () => (await db.getSetting('admin_sms', process.env.ADMIN_SMS === 'true')) === true;
if (!DEF_ADMIN_MOBILE) console.warn('⚠  ADMIN_MOBILE() not set — security alerts will appear only in the dashboard and admin login has no OTP step.');
const DEF_ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || '';
// ---- values that differ for each college (the original ADYPU values when no college is selected) ----
const ADMIN_USER = () => (T() ? T().admin.user : DEF_ADMIN_USER);
const ADMIN_HASH = () => (T() ? T().admin.hash : DEF_ADMIN_HASH);
const ADMIN_NAME = () => (T() ? T().admin.name : DEF_ADMIN_NAME);
const ADMIN_MOBILE = () => (T() ? T().admin.mobile || '' : DEF_ADMIN_MOBILE);
const ADMIN_2FA = () => (T() ? !!(T().admin.email && mailer) : DEF_ADMIN_2FA);
const ALERT_EMAIL_TO = () => (T() ? T().admin.email || '' : DEF_ALERT_EMAIL_TO);
const ACADEMIC_YEAR = () => (T() && T().academicYear) || DEF_ACADEMIC_YEAR;
const CONTACTS = () => (T() ? T().contacts || [] : DEF_CONTACTS);
const PUBLIC_URL = () => (DEF_PUBLIC_URL ? DEF_PUBLIC_URL + tenant.base() : '');
const siteUrl = (req) => (PUBLIC_URL() || `${req.protocol}://${req.get('host')}${tenant.base()}`);
let mailer = null;
// Email alerts: the alert mailbox can send to itself. SMTP_USER defaults to ALERT_EMAIL_TO(); SMTP_PASS is that mailbox's App Password.
const SMTP_USER = process.env.SMTP_USER || DEF_ALERT_EMAIL_TO;
// Hosts like Render's free plan block SMTP ports. MAIL_WEBHOOK_URL = a Google Apps Script web app (see google-apps-script/alert-mailer.gs)
// that sends the email from the admin's Gmail over HTTPS. It is used first when set.
const MAIL_WEBHOOK_URL = process.env.MAIL_WEBHOOK_URL || '';
// Emails to anyone other than the admin carry a one-time code; the mailer script asks this server (/api/mail/verify)
// whether the CRM really sent it — so a leaked mailer link cannot be used to email other people.
const mailNonces = new Map();
if (MAIL_WEBHOOK_URL) {
  mailer = { sendMail: async (m) => {
    let nonce;
    if (String(m.to || '').toLowerCase() !== String(DEF_ALERT_EMAIL_TO).toLowerCase()) {
      nonce = crypto.randomBytes(18).toString('base64url');
      mailNonces.set(nonce, { to: String(m.to).toLowerCase(), exp: Date.now() + 2 * 60 * 1000 });
    }
    const r = await fetch(MAIL_WEBHOOK_URL, { method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: process.env.MAIL_WEBHOOK_SECRET || '', nonce, to: m.to, subject: tenant.brand(m.subject || ''), text: tenant.brand(m.text || ''), html: m.html && tenant.brand(m.html), name: m.name && tenant.brand(m.name), replyTo: m.replyTo }) });
    const body = await r.text();
    if (!r.ok || !/^ok/.test(body.trim())) throw new Error(`mail relay replied ${r.status}: ${body.replace(/<[^>]+>/g, ' ').trim().slice(0, 100)}`);
  } };
} else if (DEF_ALERT_EMAIL_TO && process.env.SMTP_PASS) {
  try {
    mailer = require('nodemailer').createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: +(process.env.SMTP_PORT || 587), secure: +(process.env.SMTP_PORT || 587) === 465,
      auth: { user: SMTP_USER, pass: process.env.SMTP_PASS } });
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
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'], // Razorpay only loads on the fee-payment page, when online payment is set up
      frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
      connectSrc: ["'self'", 'https://lumberjack.razorpay.com'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(require('compression')());
// Colleges platform: /c/<code>/… runs the same CRM for another college with its own database (see colleges.js)
const CC = { express, requireXhr };
const collegesApi = require('./colleges')(app, CC);
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
  const payload = Buffer.from(JSON.stringify({ ...info, tn: T() ? T().slug : '', d: req ? devHash(req) : undefined, exp: Date.now() + SESSION_HOURS * 3600 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${tenant.cookieName()}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!(data.exp > Date.now())) return null;
    if ((data.tn || '') !== (T() ? T().slug : '')) return null; // a login for one college never works for another
    if (data.d && data.d !== devHash(req)) { req.sessionMismatch = data; return null; }
    return data;
  } catch { return null; }
}
const cookieOpts = () => `Path=${tenant.base() || '/'}; HttpOnly; SameSite=Strict${IS_PROD ? '; Secure' : ''}`;

// ---------- audit log & alerts ----------
const ALERT_GAP = 10 * 60 * 1000;
const lastAlert = new Map();
function sendAlertEmail(text) {
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return mailer.sendMail({ from: `"ADYPU CRM Security" <${process.env.SMTP_FROM || SMTP_USER}>`, to: ALERT_EMAIL_TO(), subject: `⚠ ADYPU CRM security alert`,
    text: `${text}\n\nTime: ${when} IST\nOpen the admin dashboard → Security tab for details.\n\n— ADYPU Admission CRM (automatic message)`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><div style="background:#0B1F4B;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><b>⚠ ADYPU CRM security alert</b></div><div style="border:1px solid #e2e8f0;border-top:0;padding:18px;border-radius:0 0 10px 10px"><p style="font-size:15px;margin:0 0 12px">${String(text).replace(/[<&>]/g, '')}</p><p style="color:#64748b;font-size:13px;margin:0">Time: ${when} IST<br>Open the admin dashboard → <b>Security</b> tab for details.</p></div></div>` });
}
async function notifyAdmin(text, key) {
  const k = key || text;
  if (Date.now() - (lastAlert.get(k) || 0) < ALERT_GAP) return; // throttle repeats
  lastAlert.set(k, Date.now());
  if (ADMIN_MOBILE() && (await adminSms())) sms.send('alert', ADMIN_MOBILE(), { text }).catch(() => {});
  // WhatsApp alert too (works when the WhatsApp sending number is the office number, not the admin's own)
  const waTo = String(process.env.ALERT_WHATSAPP_TO || ADMIN_MOBILE() || '').replace(/\D/g, '').slice(-10);
  if (waTo) require('./whatsapp').send('alert', waTo, { text }).catch(() => {});
  if (mailer) sendAlertEmail(text).catch((e) => console.error('alert email', e.message));
}
const SEVERE = new Set(['high', 'critical']);
async function audit(req, action, details = '', severity = 'info', who) {
  const t = who || req.user || readToken(req) || {};
  const actor = t.role === 'admin' || t.u === ADMIN_USER() ? ADMIN_NAME() : t.username || t.u || 'anonymous';
  const role = t.role === 'sub' ? 'sub-admin' : t.role === 'admin' ? 'admin' : t.username ? 'login attempt' : 'public';
  try { await db.insertAudit({ actor, role, user_id: t.id, ip: req.ip, ua: req.get('user-agent'), action, details, severity }); } catch (e) { console.error('audit', e.message); }
  if (SEVERE.has(severity)) notifyAdmin(`${actor} (${role}) - ${action.replace(/_/g, ' ')}${details ? ': ' + String(details).slice(0, 60) : ''}`,
    action.startsWith('export_') ? `${action}:${Date.now()}` : `${actor}:${action}`); // every download alerts; other repeats are throttled
}

const deny = (req, res, msg = 'Please log in again.') => (req.path.startsWith('/api/') ? res.status(401).json({ error: msg }) : res.redirect('/admin/login'));
// Main admin only
function requireAdmin(req, res, next) {
  const t = readToken(req);
  if (t && (t.role || 'admin') === 'admin') { req.user = { role: 'admin', name: ADMIN_NAME(), u: ADMIN_USER() }; return next(); }
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
  if (!u || u.id !== t.id || !Number(u.active)) { res.setHeader('Set-Cookie', `${tenant.cookieName()}=; Max-Age=0; ${cookieOpts()}`); return deny(req, res, 'Your account has been disabled. Please contact the admin.'); }
  if (t.pv && t.pv !== passVer(u.pass_hash)) { res.setHeader('Set-Cookie', `${tenant.cookieName()}=; Max-Age=0; ${cookieOpts()}`); return deny(req, res, 'Your password was changed. Please log in again.'); }
  req.user = { role: 'sub', id: u.id, name: u.name, username: u.username, kind: u.kind === 'caller' ? 'caller' : 'counsellor', parent_id: u.parent_id || null };
  // a counsellor also looks after the students given to the callers in their own team
  if (req.user.kind === 'counsellor') req.user.team = (await db.all("SELECT id FROM users WHERE parent_id = $1 AND kind = 'caller'", [u.id])).map((x) => x.id);
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
  const programme = clean(body.programme, 60);
  const branch = clean(body.branch, 60);
  const city = clean(body.city, 60).replace(/[^A-Za-z\u0900-\u097F .'()-]/g, '');

  if (!/^[A-Za-zऀ-ॿ .'-]{2,80}$/.test(student_name)) errors.student_name = 'Please enter a valid full name.';
  if (!/^[6-9]\d{9}$/.test(mobile)) errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!isValid(level, programme, branch || '')) errors.course = branch || !programme ? 'Please choose a programme.' : 'Please choose your branch / specialisation.';
  if (city.length < 2) errors.city = 'Please enter your city or district.';
  if (!body.consent) errors.consent = 'Please accept to be contacted.';
  const { region } = resolveRegion(city);
  return { errors, data: { student_name, mobile, email: email || null, level, programme, branch: branch || '', course: courseLabel(programme, branch), city, region } };
}

// ---------- public routes ----------
// Static files: compressed and cached by browsers (1 day) so repeat visits open instantly
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'], maxAge: '1d',
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));

app.post('/', (_req, res) => res.redirect(303, '/'));
// ---------- QR codes ("scan to fill on your phone") ----------
const refSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
function formUrl(req, ref) {
  const u = new URL(siteUrl(req) + '/');
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
  const c = u && Number(u.active) ? await counsellorOf({ counsellor_id: u.id }) : null;
  res.json(u && Number(u.active) ? { name: u.name, phone: c ? c.phone : '' } : {});
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
  doc.fillColor('#DBE4FF').font('Helvetica').fontSize(13).text(`Admissions ${ACADEMIC_YEAR().replace('–', '-')}  ·  UG & PG  ·  Free counselling`, 0, 164, { width: W, align: 'center' });
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
  head(50, 'Undergraduate (UG)'); list(50, LEVELS.UG.map((p) => p.name + (p.branches ? `  (${p.branches.length})` : '')), 250, 10);
  head(310, 'Postgraduate (PG)'); list(310, LEVELS.PG.map((p) => p.name + (p.branches ? `  (${p.branches.length})` : '')), 240, 10);
  doc.rect(0, H - 92, W, 92).fill(NAVY);
  doc.rect(0, H - 96, W, 4).fill(ORANGE);
  doc.fillColor('#FFD8A8').font('Helvetica-Bold').fontSize(11).text('For further connection & queries', 0, H - 78, { width: W, align: 'center' });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(12).text(CONTACTS().map((c) => `${c.name}  ${c.phone.slice(0, 5)} ${c.phone.slice(5)}`).join('     |     '), 0, H - 58, { width: W, align: 'center' });
  doc.fillColor('#CBD5F5').fontSize(9).text('D Y Patil Knowledge City, Charholi Bk., Via Lohegaon, Pune - 411081', 0, H - 34, { width: W, align: 'center' });
  doc.end();
});

app.get('/api/config', async (_req, res) => res.json({ levels: LEVELS, academicYear: ACADEMIC_YEAR(), cities: CITY_SUGGESTIONS, otpRequired: await otpOn(), chips: chat.CHIPS, contacts: CONTACTS() }));
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

// The student's own counsellor (for replies on WhatsApp / call). Falls back to the admission helpline contacts.
async function counsellorOf(row) {
  if (!row || !row.counsellor_id) return null;
  const u = await db.getUser(row.counsellor_id);
  return u && Number(u.active) && /^[6-9]\d{9}$/.test(u.mobile || '') ? { name: u.name, phone: u.mobile } : null;
}
// Region rule → counsellor (round-robin within the region)
async function autoAssign(row) {
  try {
    if (!(await db.getSetting('auto_assign', false))) return null;
    const ids = ((await db.getSetting('region_rules', {})) || {})[row.region]; if (!ids || !ids.length) return null;
    const key = 'rr_' + row.region, i = Number(await db.getSetting(key, 0)) || 0;
    for (let k = 0; k < ids.length; k++) {
      const u = await db.getUser(ids[(i + k) % ids.length]);
      if (u && Number(u.active)) { await db.setSetting(key, (i + k + 1) % ids.length); return u; }
    }
  } catch (e) { console.error('auto-assign', e.message); }
  return null;
}
async function sendConfirmation(row) {
  if (!(await studentMsgs())) return;
  const c = await counsellorOf(row);
  const r = await sms.send('confirm', row.mobile, { first: row.student_name.split(' ')[0].slice(0, 20), course: row.course.slice(0, 45), ref: row.ref_no,
    cname: c ? c.name.slice(0, 40) : '', cphone: c ? c.phone : '' });
  await db.updateEnquiry(row.id, { sms_status: r.ok ? (r.via === 'console' ? 'logged' : r.via === 'whatsapp' ? 'whatsapp' : 'sent') : 'failed' });
}

const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions from this network. Please try again after some time.' } });

// Lets the form warn early that a mobile number is already registered (yes/no only, rate-limited)
const checkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { exists: false } });
app.post('/api/enquiry/check', checkLimiter, async (req, res) => {
  const mobile = normMobile(req.body.mobile);
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.json({ exists: false });
  res.json({ exists: !!(await db.findSameStudent(mobile, null)) });
});
app.post('/api/enquiry', submitLimiter, async (req, res) => {
  try {
    if (req.body.website) return res.json({ ok: true, ref_no: 'ADYPU-OK' }); // honeypot: silently drop bots
    const { errors, data } = validateEnquiry(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: errors });
    const verified = checkVerifiedToken(req.body.otpToken, data.mobile);
    if ((await otpOn()) && !verified) return res.status(401).json({ error: 'Please verify your mobile number with the OTP.', needOtp: true });
    // One student = one entry: the same mobile number (or email) is never stored twice.
    // A new programme is added to the existing entry as a note + timeline event instead.
    const dup = await db.findSameStudent(data.mobile, null); // same email only flags a possible duplicate (siblings may share a parent's email)
    if (dup) {
      const note = dup.course === data.course ? '' : `Also interested in ${data.course}`;
      const when = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
      if (note && !String(dup.notes || '').includes(note)) await db.updateEnquiry(dup.id, { notes: [dup.notes, `${note} (${when})`].filter(Boolean).join(' | ').slice(0, 500) });
      await db.addEvent(dup.id, 'Student', 'created', `Submitted the enquiry form again${note ? ' · ' + note : ''} — not saved as a new entry`);
      audit(req, 'duplicate_enquiry_merged', dup.ref_no, 'info', { username: 'website' });
      return res.json({ ok: true, ref_no: dup.ref_no, duplicate: true, name: dup.student_name, otherCourse: !!note, counsellor: await counsellorOf(dup) });
    }
    // Came from a counsellor's personal QR? Credit the enquiry to them.
    const refUser = req.body.ref ? await db.getUserAuth(refSlug(req.body.ref)) : null;
    const attribution = refUser && Number(refUser.active)
      ? { source: 'qr-ref', created_by_id: refUser.id, created_by_name: refUser.name, counsellor_id: refUser.id, counsellor_name: refUser.name }
      : { source: req.body.src === 'qr' ? 'qr' : 'web' };
    let row = await db.insertEnquiry({ ...data, ...attribution, mobile_verified: verified });
    db.addEvent(row.id, attribution.created_by_name || 'Student', 'created', `Enquiry submitted (${attribution.source === 'qr-ref' ? 'counsellor QR' : attribution.source === 'qr' ? 'QR scan' : 'website'})${row.dup_of ? ' · same student already enquired before' : ''}`).catch(() => {});
    if (!row.caller_id) { const u = await autoAssign(row); if (u) { await db.assignMany([row.id], u); row = await db.getEnquiry(row.id); } }
    sendConfirmation(row).catch((e) => console.error('confirmation SMS', e.message));
    res.json({ ok: true, ref_no: row.ref_no, name: row.student_name, smsSent: await studentMsgs(), counsellor: await counsellorOf(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- admin auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

app.get('/admin/login', (_req, res) => sendView(res, 'login.html'));
const fails = new Map(); // username → { n, until }
const LOCK_AFTER = 5, LOCK_MIN = 15;
const challenges = new Map(); // admin OTP challenges
function setSession(res, data, req) { res.setHeader('Set-Cookie', `${tenant.cookieName()}=${issueToken(data, req)}; Max-Age=${SESSION_HOURS * 3600}; ${cookieOpts()}`); }
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
  const isMain = uname.length === ADMIN_USER().length && crypto.timingSafeEqual(Buffer.from(uname), Buffer.from(ADMIN_USER()));
  if (isMain) {
    if (!(await bcrypt.compare(String(password || ''), ADMIN_HASH()))) return failed();
    fails.delete(key);
    if (ADMIN_2FA()) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), id = crypto.randomBytes(16).toString('base64url');
      challenges.set(id, { hash: sign('2fa:' + code), exp: Date.now() + 5 * 60000, tries: 0, d: devHash(req), tn: T() ? T().slug : '' });
      const viaSms = !!ADMIN_MOBILE() && ((await adminSms()) || !mailer);
      let sent = { ok: true };
      if (!OTP_DEMO) {
        if (viaSms) sent = await sms.send('otp', ADMIN_MOBILE(), { otp: code });
        else {
          const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          sent = await mailer.sendMail({ to: ALERT_EMAIL_TO(), subject: `ADYPU CRM login code: ${code}`,
            text: `Your ADYPU CRM admin login code is ${code}\n\nIt is valid for 5 minutes. Requested ${when} IST from IP ${req.ip}.\nIf you did not try to sign in, change the admin password immediately.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:520px"><div style="background:#0B1F4B;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><b>ADYPU CRM - admin login code</b></div><div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 10px 10px"><p style="margin:0 0 8px">Your login code is</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 14px;color:#0B1F4B">${code}</p><p style="color:#64748b;font-size:13px;margin:0">Valid for 5 minutes. Requested ${when} IST from IP ${req.ip}.<br>If this was not you, change the admin password immediately.</p></div></div>` })
            .then(() => ({ ok: true })).catch((e) => { console.error('login code email', e.message); return { ok: false }; });
        }
      }
      if (!sent.ok) return res.status(502).json({ error: 'Could not send the login code. Please try again.' });
      const maskedEmail = sec.maskEmail(ALERT_EMAIL_TO());
      return res.json({ ok: true, otp: true, challenge: id, sentTo: viaSms ? `+91 ${sec.maskMobile(ADMIN_MOBILE())} by SMS` : `${maskedEmail} by email (check Inbox / Spam)`, ...(OTP_DEMO ? { demoOtp: code } : {}) });
    }
    setSession(res, { u: ADMIN_USER(), role: 'admin' }, req);
    audit(req, 'admin_login', 'password', 'info', { role: 'admin', u: ADMIN_USER() });
    return res.json({ ok: true, role: 'admin', redirect: tenant.base() + '/admin' });
  }
  const u = await db.getUserAuth(uname);
  const ok = await bcrypt.compare(String(password || ''), u ? u.pass_hash : ADMIN_HASH()); // compare anyway: same timing
  if (!u || !ok || u.kind === 'ai') return failed();
  if (!Number(u.active)) { audit(req, 'disabled_account_login', uname, 'medium', { username: uname, id: u.id, role: 'sub' }); return res.status(403).json({ error: 'This account is disabled. Please contact the admin.' }); }
  fails.delete(key);
  await db.touchLogin(u.id);
  setSession(res, { u: u.username, role: 'sub', id: u.id, n: u.name, pv: passVer(u.pass_hash) }, req);
  audit(req, 'sub_admin_login', '', 'info', { role: 'sub', id: u.id, username: u.username });
  res.json({ ok: true, role: 'sub', redirect: tenant.base() + '/team' });
});
app.post('/api/admin/login/verify', loginLimiter, requireXhr, async (req, res) => {
  const c = challenges.get(String(req.body.challenge || ''));
  if (!c || c.exp < Date.now() || c.d !== devHash(req) || c.tn !== (T() ? T().slug : '')) return res.status(400).json({ error: 'This code has expired. Please sign in again.', restart: true });
  const code = String(req.body.otp || '').replace(/\D/g, '');
  const good = code.length === 6 && crypto.timingSafeEqual(Buffer.from(sign('2fa:' + code)), Buffer.from(c.hash));
  if (!good) {
    c.tries += 1;
    if (c.tries >= 5) { challenges.delete(String(req.body.challenge)); audit(req, 'admin_otp_failed', '5 wrong login codes', 'critical', { role: 'admin', u: ADMIN_USER() }); return res.status(429).json({ error: 'Too many wrong codes. Please sign in again.', restart: true }); }
    return res.status(400).json({ error: `Incorrect code. ${5 - c.tries} attempt(s) left.` });
  }
  challenges.delete(String(req.body.challenge));
  setSession(res, { u: ADMIN_USER(), role: 'admin' }, req);
  audit(req, 'admin_login', 'password + mobile OTP', 'info', { role: 'admin', u: ADMIN_USER() });
  res.json({ ok: true, role: 'admin', redirect: tenant.base() + '/admin' });
});
app.post('/api/admin/logout', (req, res) => {
  const t = readToken(req); if (t) audit(req, 'logout', '', 'info', { ...t, username: t.u });
  res.setHeader('Set-Cookie', `${tenant.cookieName()}=; Max-Age=0; ${cookieOpts()}`);
  res.json({ ok: true });
});

// Who is signed in (for the on-screen watermark)
app.get('/api/security/whoami', (req, res) => {
  const t = readToken(req); if (!t) return res.status(401).json({});
  res.json({ role: t.role === 'sub' ? 'sub' : 'admin', name: t.role === 'sub' ? t.n : ADMIN_NAME(), username: t.u, ip: req.ip, idleMinutes: Number(process.env.IDLE_MINUTES || 15) });
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
  // Repeated attempts → the account is locked automatically and the admin is alerted
  let locked = false;
  if (isSub && sev === 'high') {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const n = Number((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = $1 AND role = 'sub-admin' AND severity = 'high' AND at >= $2 AND action IN ('copy_attempt','print_attempt','screenshot_attempt','developer_tools_opened','save_page_attempt','drag_data_attempt','select_all_attempt')", [t.id, since])).n);
    const limit = Number(await db.getSetting('auto_lock_after', 5));
    if (limit > 0 && n >= limit) {
      const u = await db.getUser(t.id);
      if (u && Number(u.active)) {
        await db.updateUser(u.id, { active: false });
        await audit(req, 'account_auto_locked', `${u.name} (@${u.username}) locked after ${n} copy / screenshot attempts in 1 hour`, 'critical', { ...t, username: t.u });
        res.setHeader('Set-Cookie', `${tenant.cookieName()}=; Max-Age=0; ${cookieOpts()}`);
      }
      locked = true;
    }
  }
  res.json({ ok: true, notified: SEVERE.has(sev), locked });
});

app.get('/admin', requireAdmin, (_req, res) => sendView(res, 'admin.html'));
app.get('/admin/admin.js', requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.js')));
app.get('/team', requireSub, (_req, res) => sendView(res, 'team.html'));
app.get('/team/team.js', requireSub, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'team.js')));

// ---------- sub-admin (team) API ----------
const teamRow = (row, me) => !!row && (me.kind === 'caller' ? row.caller_id === me.id : (row.created_by_id === me.id || row.counsellor_id === me.id || (!!row.caller_id && (me.team || []).includes(row.caller_id))));
// Sub-admins never receive full contact details — only masked values.
const masked = (r) => r && ({ ...r, mobile: sec.maskMobile(r.mobile), email: r.email ? sec.maskEmail(r.email) : '', mobile_masked: true });
function teamData(body) {
  const { errors, data } = validateEnquiry({ ...body, consent: true });
  const status = STATUSES.includes(body.status) ? body.status : 'New';
  return { errors, data: { ...data, status, notes: String(body.notes || '').slice(0, 500), data_source: clean(body.data_source, 80) || null, data_location: clean(body.data_location, 80) || null } };
}
const dupMessage = (d) => `Already registered as ${d.ref_no}${d.counsellor_name ? ' with ' + d.counsellor_name : d.created_by_name ? ' by ' + d.created_by_name : ' (website / QR)'} on ${new Date(d.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`;
async function pushStudent(body, me, sendSms) {
  if (!clean(body.city, 60) && body.data_location) body = { ...body, city: String(body.data_location).split(',')[0] };
  const { errors, data } = teamData(body);
  if (Object.keys(errors).length) return { errors };
  // Duplicate check: the same mobile number (any programme) is blocked; the same email is flagged as a possible duplicate
  const existing = await db.findSameStudent(data.mobile, null);
  if (existing) return { duplicate: existing };
  const row = await db.insertEnquiry({ ...data, source: 'subadmin', created_by_id: me.id, created_by_name: me.name, counsellor_id: me.id, counsellor_name: me.name });
  db.addEvent(row.id, me.name, 'created', `Added by ${me.name}${data.data_source ? ' · source: ' + data.data_source : ''}${data.data_location ? ' · ' + data.data_location : ''}`).catch(() => {});
  if (sendSms) await sendConfirmation(row).catch((e) => console.error('confirmation SMS', e.message));
  return { row };
}
const teamFilters = (q, me) => ({ dataSource: q.dataSource, appStatus: q.appStatus, caller: q.caller, follow: q.follow, q: q.q, level: q.level, programme: q.programme, branch: q.branch, status: q.status, from: q.from, to: q.to, sort: q.sort, dir: q.dir,
  ...(me.kind === 'caller' ? { scopeCaller: me.id } : { scopeUser: me.id, scopeCallers: me.team || [] }) });

app.get('/api/team/me', requireSub, async (req, res) => res.json({ kind: req.user.kind, outcomes: CALL_OUTCOMES, assignedCalling: await db.getSetting('assigned_calling', true), user: req.user, statuses: STATUSES, levels: LEVELS, cities: CITY_SUGGESTIONS, smsProvider: sms.provider, studentMsgs: await studentMsgs() }));
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
  audit(req, req.body.via === 'whatsapp' ? 'whatsapp_chat_opened' : 'contact_number_viewed', `${row.ref_no}`, 'medium');
  res.json({ mobile: row.mobile, first: String(row.student_name).split(' ')[0], course: row.course, ref: row.ref_no });
});
// Secure calling: a counsellor can dial / WhatsApp ONLY students the admin assigned to them (or all of theirs if the admin allows).
// The number is sent for a single tap, every dial is logged, and unusual dialling volume alerts the admin.
const dials = new Map();
app.post('/api/team/enquiries/:id/dial', requireSub, requireXhr, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10));
  if (!teamRow(row, req.user)) { audit(req, 'dial_other_student', `id ${req.params.id}`, 'high'); return res.status(404).json({ error: 'Not found' }); }
  const assigned = row.caller_id === req.user.id && (await db.getSetting('assigned_calling', true));
  if (!assigned && !(await db.getSetting('allow_reveal', false))) { audit(req, 'dial_denied', row.ref_no, 'medium'); return res.status(403).json({ error: 'You can call only students the admin assigned to you for calling.' }); }
  const now = Date.now(), w = (dials.get(req.user.id) || []).filter((t) => now - t < 3600e3); w.push(now); dials.set(req.user.id, w);
  if (w.length > 80) { audit(req, 'dial_limit_reached', `${w.length} numbers opened in 1 hour`, 'high'); return res.status(429).json({ error: 'Calling limit reached for this hour. The admin has been notified.' }); }
  const via = req.body.via === 'whatsapp' ? 'whatsapp' : 'call';
  audit(req, via === 'whatsapp' ? 'whatsapp_opened' : 'call_started', row.ref_no, 'info');
  res.json({ mobile: row.mobile, first: String(row.student_name).split(' ')[0], course: row.course, ref: row.ref_no, via });
});
app.get('/api/team/enquiries/:id/calls', requireSub, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10));
  if (!teamRow(row, req.user)) return res.status(404).json({ error: 'Not found' });
  res.json({ calls: await db.listCalls(row.id) });
});
app.post('/api/team/enquiries/:id/calls', requireSub, requireXhr, async (req, res) => {
  const row = await db.getEnquiry(parseInt(req.params.id, 10));
  if (!teamRow(row, req.user)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!CALL_OUTCOMES.includes(b.outcome)) return res.status(400).json({ error: 'Choose the call result.' });
  if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  const next = validDate(b.next_action_date);
  await db.logCall({ enquiry_id: row.id, user_id: req.user.id, user_name: req.user.name, channel: b.channel === 'whatsapp' ? 'whatsapp' : 'call',
    outcome: b.outcome, feedback: String(b.feedback || '').slice(0, 600), status_after: b.status || row.status, next_action_date: next });
  const upd = { next_action_date: next };
  if (b.status && b.status !== row.status) upd.status = b.status;
  const out = await db.updateEnquiry(row.id, upd);
  db.addEvent(row.id, req.user.name, 'call', `${b.channel === 'whatsapp' ? 'WhatsApp' : 'Call'}: ${b.outcome}${b.status && b.status !== row.status ? ' · status → ' + b.status : ''}`).catch(() => {});
  audit(req, 'call_logged', `${row.ref_no}: ${b.outcome}${b.status ? ' → ' + b.status : ''}`, 'info');
  res.json({ ok: true, row: masked(out) });
});
async function followCounts(me) {
  const scope = me && me.id, base = !me ? {} : me.kind === 'caller' ? { scopeCaller: me.id } : { scopeUser: me.id, scopeCallers: me.team || [] };
  const [today, overdue, untouched, all] = await Promise.all(['today', 'overdue', 'untouched', undefined].map((follow) => db.listEnquiries({ ...base, follow })));
  return { today: today.length, overdue: overdue.length, untouched: untouched.length, all: all.length, assigned: scope ? all.filter((r) => r.caller_id === scope).length : undefined };
}
app.get('/api/team/summary', requireSub, async (req, res) => res.json(await followCounts(req.user)));

app.post('/api/team/enquiries', requireSub, requireXhr, async (req, res) => {
  if (req.user.kind === 'caller') return res.status(403).json({ error: 'Calling-team accounts cannot add students.' });
  try {
    const r = await pushStudent(req.body, req.user, req.body.sendSms !== false);
    if (r.errors) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: r.errors });
    if (r.duplicate) { audit(req, 'duplicate_blocked', r.duplicate.ref_no, 'info'); return res.status(409).json({ error: `Duplicate: ${dupMessage(r.duplicate)}. Please contact the admin if it should be with you.` }); }
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
  if (upd.status && upd.status !== row.status) db.addEvent(row.id, req.user.name, 'status', `Status ${row.status} → ${upd.status}`).catch(() => {});
  res.json({ row: masked(await db.updateEnquiry(row.id, upd)) });
});

// Bulk upload: .xlsx or .csv, first row = headers. Columns are matched by name, in any order.
const HEAD = { student_name: /^(student )?name|full ?name/, mobile: /mobile|phone|contact/, email: /e-?mail/, city: /city|district/, level: /^level|ug ?\/ ?pg/,
  programme: /programme|program|course/, branch: /branch|specialis|specializ/, status: /status/, notes: /note|remark/, data_source: /^source|data source|lead source/, data_location: /^location|venue|place/ };
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
    const batchSource = clean(req.query.source, 80), batchLocation = clean(req.query.location, 80);
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
      const out = await pushStudent({ student_name: g('student_name'), mobile: g('mobile'), email: g('email'), city: g('city'), level, programme, branch, status: st || 'New', notes: g('notes'),
        data_source: g('data_source') || batchSource, data_location: g('data_location') || batchLocation }, req.user, sendSms);
      const line = hi + i + 2;
      if (out.errors) result.errors.push({ line, name: g('student_name'), problems: Object.values(out.errors) });
      else if (out.duplicate) result.duplicates.push({ line, name: g('student_name'), ref: out.duplicate.ref_no, owner: dupMessage(out.duplicate) });
      else result.added.push({ line, name: out.row.student_name, ref: out.row.ref_no });
    }
    audit(req, 'bulk_upload', `${name}${batchSource ? ' [' + batchSource + ']' : ''}: ${result.added.length} added, ${result.duplicates.length} duplicates, ${result.errors.length} errors`, 'info');
    res.json({ ok: true, total: body.length, ...result });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Could not read that file. Please use the template.' }); }
});
app.get('/api/team/template.xlsx', requireSub, async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.columns = [['Student Name', 26], ['Mobile', 14], ['Email', 28], ['City', 16], ['Level', 8], ['Programme', 16], ['Branch', 34], ['Status', 18], ['Notes', 30], ['Source', 24], ['Location', 22]].map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }; });
  // Examples live on their own sheet so they are never uploaded by mistake (only the first sheet is read).
  const ex = wb.addWorksheet('Example');
  ex.columns = ws.columns.map((c) => ({ header: c.header, width: c.width }));
  ex.getRow(1).font = { bold: true };
  ex.addRow(['Aarya Patil', '9876543210', 'aarya@example.com', 'Pune', 'UG', 'B.Tech', 'Mechanical Engineering', 'New', 'Met at school fair', 'School fair - Modern College', 'Shivajinagar, Pune']);
  ex.addRow(['Rohan Deshmukh', '8123456789', '', 'Nashik', 'PG', 'MBA', '', 'Contacted', 'Branch is only needed for B.Tech / M.Tech', '', '']);
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
  res.json({ events, unseen, settings: { autoLock: Number(await db.getSetting('auto_lock_after', 5)), allowReveal, otpRequired: await otpOn(), adminSms: await adminSms(), studentMsgs: await studentMsgs() },
    status: { adminName: ADMIN_NAME(), encryption: 'AES-256-GCM (name, mobile, email, notes)', dataKey: !!process.env.DATA_KEY, twoFA: ADMIN_2FA(), adminSms: await adminSms(), alertEmailTo: sec.maskEmail(ALERT_EMAIL_TO()), alertMobile: ADMIN_MOBILE() ? sec.maskMobile(ADMIN_MOBILE()) : '', alertEmail: !!mailer,
      smsProvider: sms.provider, https: IS_PROD, sessionHours: SESSION_HOURS, idleMinutes: Number(process.env.IDLE_MINUTES || 15) },
    // what someone opening the database directly would see
    rawSample: raw.map((r) => ({ ref_no: r.ref_no, student_name: String(r.student_name || '').slice(0, 30) + '…', mobile: String(r.mobile || '').slice(0, 30) + '…' })) });
});
app.post('/api/admin/security/test-alert', requireAdmin, requireXhr, async (req, res) => {
  const text = `Test alert from ${ADMIN_NAME()} - security alerts are working`;
  const smsOn = await adminSms();
  const out = { sms: !smsOn ? 'off (email only)' : ADMIN_MOBILE() ? 'sent to +91 ' + sec.maskMobile(ADMIN_MOBILE()) : 'no admin mobile set', email: 'not set up' };
  if (ADMIN_MOBILE() && smsOn) { const r = await sms.send('alert', ADMIN_MOBILE(), { text }); out.sms = r.ok ? out.sms : 'SMS failed - check the SMS account balance'; }
  if (mailer) { try { await sendAlertEmail(text); out.email = 'sent to ' + ALERT_EMAIL_TO(); } catch (e) { out.email = 'failed: ' + e.message.slice(0, 120); } }
  audit(req, 'test_alert', `SMS: ${out.sms} | Email: ${out.email}`, 'info');
  res.json(out);
});
app.post('/api/admin/security/seen', requireAdmin, requireXhr, async (_req, res) => { await db.markAlertsSeen(); res.json({ ok: true }); });
app.patch('/api/admin/security/settings', requireAdmin, requireXhr, async (req, res) => {
  if (req.body.autoLock !== undefined) { const n = [0, 3, 5, 10].includes(+req.body.autoLock) ? +req.body.autoLock : 5; await db.setSetting('auto_lock_after', n); audit(req, 'setting_changed', `auto-lock after copy / screenshot attempts: ${n || 'OFF'}`, 'medium'); }
  if (req.body.allowReveal !== undefined) { await db.setSetting('allow_reveal', !!req.body.allowReveal); audit(req, 'setting_changed', `counsellors can view numbers: ${!!req.body.allowReveal ? 'ON' : 'OFF'}`, 'medium'); }
  if (req.body.otpRequired !== undefined) { await db.setSetting('otp_required', !!req.body.otpRequired); audit(req, 'setting_changed', `student mobile OTP: ${req.body.otpRequired ? 'ON' : 'OFF'}`, 'medium'); }
  if (req.body.studentMsgs !== undefined) { await db.setSetting('student_msgs', !!req.body.studentMsgs); audit(req, 'setting_changed', `student confirmation SMS/WhatsApp: ${req.body.studentMsgs ? 'ON' : 'OFF'}`, 'medium'); }
  if (req.body.adminSms !== undefined) { await db.setSetting('admin_sms', !!req.body.adminSms); audit(req, 'setting_changed', `admin login code + alerts by SMS: ${req.body.adminSms ? 'ON' : 'OFF (email only)'}`, 'medium'); }
  res.json({ ok: true, settings: { allowReveal: await db.getSetting('allow_reveal', false), otpRequired: await otpOn(), adminSms: await adminSms(), studentMsgs: await studentMsgs() } });
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const [users, rows] = await Promise.all([db.listUsers(), db.listEnquiries({})]);
  const wk = Date.now() - 7 * 864e5;
  res.json({ users: users.map((u) => {
    const pushed = rows.filter((r) => r.created_by_id === u.id), assigned = rows.filter((r) => r.counsellor_id === u.id);
    const calling = rows.filter((r) => r.caller_id === u.id), today = istToday();
    return { ...u, pushed: pushed.length, pushedWeek: pushed.filter((r) => new Date(r.created_at) > wk).length, assigned: assigned.length,
      admitted: (u.kind === 'caller' ? calling : assigned).filter((r) => r.status === 'Admitted').length, pending: assigned.filter((r) => r.status === 'New').length,
      calling: calling.length, called: calling.filter((r) => r.call_count > 0).length, untouched: calling.filter((r) => !r.call_count && r.status === 'New').length,
      overdue: calling.filter((r) => r.next_action_date && r.next_action_date < today && !['Admitted', 'Not Interested'].includes(r.status)).length,
      interested: calling.filter((r) => ['Interested', 'Counselling Done', 'Applied', 'Admitted'].includes(r.status)).length };
  }) });
});
app.post('/api/admin/users', requireAdmin, requireXhr, async (req, res) => {
  const name = clean(req.body.name, 60), username = clean(req.body.username, 30).toLowerCase(), mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10);
  const password = String(req.body.password || '') || genPassword();
  if (name.length < 2) return res.status(400).json({ error: 'Please enter the full name.' });
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || username === ADMIN_USER().toLowerCase()) return res.status(400).json({ error: 'Username: 3–30 letters, numbers, dot, dash or underscore.' });
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: "Enter a 10-digit WhatsApp mobile number for this account." });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await db.getUserAuth(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const kind = req.body.kind === 'caller' ? 'caller' : 'counsellor';
  let parent_id = null;
  if (kind === 'caller' && req.body.parent_id) { const p = await db.getUser(parseInt(req.body.parent_id, 10)); if (p && p.kind === 'counsellor') parent_id = p.id; }
  const user = await db.createUser({ name, username, mobile, kind, parent_id, pass_hash: await bcrypt.hash(password, 12) });
  audit(req, 'sub_admin_created', `${name} (@${username}) · ${kind === 'caller' ? 'calling team' : 'counsellor (data entry)'}`, 'info');
  res.json({ ok: true, user, password });
});
app.patch('/api/admin/users/:id', requireAdmin, requireXhr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await db.getUser(id))) return res.status(404).json({ error: 'Not found' });
  const upd = {}; let password;
  if (req.body.name !== undefined) upd.name = clean(req.body.name, 60);
  if (req.body.mobile !== undefined) upd.mobile = String(req.body.mobile).replace(/\D/g, '').slice(-10);
  if (req.body.active !== undefined) upd.active = !!req.body.active;
  if (req.body.parent_id !== undefined) upd.parent_id = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;
  if (req.body.resetPassword) { password = genPassword(); upd.pass_hash = await bcrypt.hash(password, 12); audit(req, 'password_reset', `user #${id} (old sessions signed out)`, 'info'); }
  if (req.body.active !== undefined) audit(req, req.body.active ? 'account_enabled' : 'account_disabled', `user #${id}`, 'info');
  res.json({ ok: true, user: await db.updateUser(id, upd), password });
});

// ---------- admin API ----------
const pickFilters = (q) => ({ dataSource: q.dataSource, appStatus: q.appStatus, caller: q.caller, follow: q.follow, pushedBy: q.pushedBy, counsellor: q.counsellor, q: q.q, level: q.level, programme: q.programme, branch: q.branch, status: q.status, region: q.region, verified: q.verified, from: q.from, to: q.to, sort: q.sort, dir: q.dir });

app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  const rows = await db.listEnquiries(pickFilters(req.query));
  const team = (await db.listUsers()).map((u) => ({ id: u.id, name: u.name, active: u.active, kind: u.kind, parent_id: u.parent_id }));
  const aiReady = !!(process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID && process.env.VAPI_PHONE_NUMBER_ID) || !!process.env.AI_CALLER_WEBHOOK_URL;
  const sources = (await db.all("SELECT data_source AS s, COUNT(*) AS n FROM enquiries WHERE data_source IS NOT NULL AND data_source <> '' GROUP BY data_source ORDER BY n DESC LIMIT 200")).map((x) => ({ s: x.s, n: Number(x.n) }));
  res.json({ aiReady, sources, rows, statuses: STATUSES, levels: LEVELS, regions: REGIONS, smsProvider: sms.provider, team, unseenAlerts: await db.countUnseenAlerts() });
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
  const before = await db.getEnquiry(id);
  const row = await db.updateEnquiry(id, upd);
  if (before && upd.status && upd.status !== before.status) db.addEvent(id, ADMIN_NAME(), 'status', `Status ${before.status} → ${upd.status}`).catch(() => {});
  if (before && upd.counsellor_id !== undefined && before.counsellor_id !== upd.counsellor_id) db.addEvent(id, ADMIN_NAME(), 'assign', upd.counsellor_name ? `Counsellor → ${upd.counsellor_name}` : 'Counsellor removed').catch(() => {});
  // newly assigned counsellor → tell the student whom to WhatsApp / call
  if (upd.counsellor_id && before && before.counsellor_id !== upd.counsellor_id) sendConfirmation(row).catch((e) => console.error('counsellor intro', e.message));
  res.json({ row });
});

const parseIds = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 5000);
// Assign selected students to one counsellor (or unassign with counsellor_id = null)
app.post('/api/admin/assign', requireAdmin, requireXhr, async (req, res) => {
  const ids = parseIds(req.body.ids);
  if (!ids.length) return res.status(400).json({ error: 'Select at least one student.' });
  let user = null;
  if (req.body.counsellor_id) { user = await db.getUser(parseInt(req.body.counsellor_id, 10)); if (!user || !Number(user.active)) return res.status(400).json({ error: 'Choose an active caller.' }); }
  const n = await db.assignMany(ids, user);
  for (const id of ids) db.addEvent(id, ADMIN_NAME(), 'assign', user ? `Calling → ${user.name}` : 'Caller removed').catch(() => {});
  audit(req, 'calls_assigned', `${n} students → ${user ? user.name : 'no caller'}`, 'info');
  res.json({ ok: true, assigned: n, to: user ? user.name : null });
});
// Share every student matching the current filters fairly among the chosen counsellors (load-balanced)
app.post('/api/admin/distribute', requireAdmin, requireXhr, async (req, res) => {
  const cids = parseIds(req.body.counsellors);
  const users = (await Promise.all(cids.map((id) => db.getUser(id)))).filter((u) => u && Number(u.active));
  if (!users.length) return res.status(400).json({ error: 'Choose at least one active caller.' });
  let rows = await db.listEnquiries(pickFilters(req.body.filters || {}));
  if (req.body.onlyUnassigned !== false) rows = rows.filter((r) => !r.caller_id);
  if (!rows.length) return res.status(400).json({ error: 'No students to share with these filters.' });
  // start from each counsellor's current open load so the result is balanced
  const all = await db.listEnquiries({});
  const load = new Map(users.map((u) => [u.id, all.filter((r) => r.caller_id === u.id && !['Admitted', 'Not Interested'].includes(r.status)).length]));
  const plan = new Map(users.map((u) => [u.id, []]));
  for (const r of rows) { const u = users.reduce((a, b) => (load.get(b.id) < load.get(a.id) ? b : a)); plan.get(u.id).push(r.id); load.set(u.id, load.get(u.id) + 1); }
  const result = [];
  for (const u of users) { const ids = plan.get(u.id); if (ids.length) await db.assignMany(ids, u); result.push({ name: u.name, count: ids.length }); }
  audit(req, 'calls_distributed', `${rows.length} students shared: ${result.map((x) => `${x.name} ${x.count}`).join(', ')}`, 'info');
  res.json({ ok: true, total: rows.length, result });
});
// Region rules: every new enquiry is given automatically (round-robin) to the CALLERS set for its region
app.get('/api/admin/region-rules', requireAdmin, async (_req, res) => res.json({ rules: await db.getSetting('region_rules', {}), enabled: await db.getSetting('auto_assign', false), regions: REGIONS, assignedCalling: await db.getSetting('assigned_calling', true) }));
app.put('/api/admin/region-rules', requireAdmin, requireXhr, async (req, res) => {
  const rules = {};
  for (const [region, ids] of Object.entries(req.body.rules || {})) { const v = parseIds(ids); if (v.length && REGIONS.includes(region)) rules[region] = v; }
  if (req.body.rules !== undefined) await db.setSetting('region_rules', rules);
  if (req.body.enabled !== undefined) await db.setSetting('auto_assign', !!req.body.enabled);
  if (req.body.assignedCalling !== undefined) await db.setSetting('assigned_calling', !!req.body.assignedCalling);
  audit(req, 'setting_changed', `auto-assign by region: ${(await db.getSetting('auto_assign', false)) ? 'ON' : 'OFF'} (${Object.keys(rules).length} regions)`, 'medium');
  res.json({ ok: true, rules: await db.getSetting('region_rules', {}), enabled: await db.getSetting('auto_assign', false), assignedCalling: await db.getSetting('assigned_calling', true) });
});
app.get('/api/admin/enquiries/:id/calls', requireAdmin, async (req, res) => res.json({ calls: await db.listCalls(parseInt(req.params.id, 10)) }));
app.get('/api/admin/followups', requireAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  res.json({ ...(await followCounts(null)), stats: await db.callStats(since) });
});
app.post('/api/admin/digest', requireAdmin, requireXhr, async (_req, res) => {
  try { const r = await sendDigest(true); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); }
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

// Columns the admin can tick when downloading (key → label, Excel width, PDF weight, value)
const fmtDay = (d) => (d ? new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const EXPORT_FIELDS = [
  ['ref', 'Reference No.', 17, 1.0, (r) => r.ref_no],
  ['name', 'Student Name', 26, 1.5, (r) => r.student_name],
  ['mobile', 'Mobile', 14, 1.0, (r) => r.mobile],
  ['verified', 'Mobile Verified', 10, 0.6, (r) => (r.mobile_verified ? 'Yes' : 'No')],
  ['email', 'Email', 28, 1.6, (r) => r.email || ''],
  ['city', 'City', 16, 0.9, (r) => r.city || ''],
  ['region', 'Region', 24, 1.1, (r) => r.region || ''],
  ['level', 'Level (UG/PG)', 8, 0.5, (r) => r.level],
  ['programme', 'Programme', 14, 0.9, (r) => r.programme],
  ['branch', 'Branch', 30, 1.4, (r) => r.branch || ''],
  ['status', 'Status', 17, 0.9, (r) => r.status],
  ['source', 'Primary Source', 20, 1.0, (r) => pushedLabel(r)],
  ['counsellor', 'Counsellor (data)', 20, 1.1, (r) => r.counsellor_name || 'Unassigned'],
  ['caller', 'Assigned Caller', 20, 1.1, (r) => r.caller_name || 'Not assigned'],
  ['calls', 'No. of Calls', 8, 0.5, (r) => r.call_count || 0],
  ['lastcall', 'Last Call', 20, 1.0, (r) => (r.last_call_at ? fmtIST(r.last_call_at) : '')],
  ['outcome', 'Last Call Result', 16, 0.9, (r) => r.last_call_outcome || ''],
  ['feedback', 'Latest Feedback', 34, 1.8, (r) => r._feedback || ''],
  ['next', 'Next Follow-up', 14, 0.8, (r) => fmtDay(r.next_action_date)],
  ['notes', 'Notes', 28, 1.4, (r) => r.notes || ''],
  ['datasource', 'Data Source', 24, 1.2, (r) => r.data_source || ''],
  ['location', 'Data Location', 20, 1.0, (r) => r.data_location || ''],
  ['duplicate', 'Duplicate Of', 16, 0.9, (r) => (r.dup_of ? r._dupRef || 'Yes' : '')],
  ['appstatus', 'Admission Form', 16, 0.9, (r) => r.app_status || ''],
  ['admtype', 'Admission Type', 14, 0.8, (r) => r.admission_type || ''],
  ['created', 'Created On (IST)', 21, 1.0, (r) => fmtIST(r.created_at)],
  ['updated', 'Updated On (IST)', 21, 1.0, (r) => fmtIST(r.updated_at)],
];
const DEFAULT_FIELDS = ['ref', 'name', 'mobile', 'verified', 'email', 'city', 'region', 'level', 'programme', 'branch', 'status', 'source', 'counsellor', 'caller', 'notes', 'created'];
const pickFields = (q) => {
  const want = String(q.fields || '').split(',').filter(Boolean);
  const list = EXPORT_FIELDS.filter((f) => (want.length ? want : DEFAULT_FIELDS).includes(f[0]));
  return list.length ? list : EXPORT_FIELDS.filter((f) => DEFAULT_FIELDS.includes(f[0]));
};
async function withFeedback(rows, fields) {
  if (fields.some((f) => f[0] === 'duplicate')) { const ids = [...new Set(rows.filter((r) => r.dup_of).map((r) => r.dup_of))]; for (const id of ids) { const d = await db.getEnquiry(id); rows.filter((r) => r.dup_of === id).forEach((r) => { r._dupRef = d ? d.ref_no : 'merged'; }); } }
  if (fields.some((f) => f[0] === 'feedback')) { const m = await db.latestFeedback(rows.map((r) => r.id)); rows.forEach((r) => { r._feedback = m[r.id] || ''; }); }
  return rows;
}
app.get('/api/admin/export-fields', requireAdmin, (_req, res) => res.json({ fields: EXPORT_FIELDS.map(([key, label]) => ({ key, label })), defaults: DEFAULT_FIELDS }));
const stampLine = (req) => `CONFIDENTIAL · Downloaded by main admin · ${fmtIST(new Date().toISOString())} IST · IP ${req.ip} · Do not share`;
app.get('/api/admin/export.xlsx', requireAdmin, async (req, res) => {
  const f = await exportFilters(req.query);
  const fields = pickFields(req.query);
  const rows = await withFeedback(await db.listEnquiries(f), fields);
  audit(req, 'export_excel', `${rows.length} records · ${fields.length} columns downloaded from IP ${req.ip}`, 'high');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ADYPU Admission Desk';
  wb.subject = 'CONFIDENTIAL student data - authorised use only';
  wb.keywords = `downloaded ${new Date().toISOString()} ip ${req.ip}`;
  const ws = wb.addWorksheet('Enquiries', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const cols = [['Sr.', 6], ...fields.map((x) => [x[1], x[2]])];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell('A1').value = `Ajeenkya DY Patil University, Pune — Admission Enquiries ${ACADEMIC_YEAR()}`;
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
    const row = ws.addRow([i + 1, ...fields.map((x) => x[4](r))]);
    const mi = fields.findIndex((x) => x[0] === 'mobile'); if (mi >= 0) row.getCell(mi + 2).numFmt = '@';
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
  section('By assigned caller', countBy(rows.map((r) => ({ k: r.caller_name || 'Not assigned' })), 'k'));
  section('By last call result', countBy(rows.map((r) => ({ k: r.last_call_outcome || 'Not called yet' })), 'k'));
  section('By data source', countBy(rows.map((r) => ({ k: r.data_source || 'Not given' })), 'k'));
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
  const fields = pickFields(req.query);
  const rows = await withFeedback(await db.listEnquiries(f), fields);
  audit(req, 'export_pdf', `${rows.length} records · ${fields.length} columns downloaded from IP ${req.ip}`, 'high');
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
    doc.font('Helvetica').fontSize(10).fillColor('#FFD8A8').text(`Admission Enquiry Report  •  Academic Year ${ACADEMIC_YEAR()}`, L, 38);
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

  const totalW = fields.reduce((a, x) => a + x[3], 0), avail = R - L - 22;
  const cols = [['#', 22], ...fields.map((x) => [x[1], (avail * x[3]) / totalW])];
  const fs = fields.length > 12 ? 6.5 : fields.length > 9 ? 7.5 : 8.5;
  const drawHead = () => {
    const y = doc.y;
    doc.rect(L, y, R - L, 20).fill(NAVY);
    let x = L;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(fs);
    const hh = Math.max(20, ...cols.map(([h, w]) => doc.heightOfString(h, { width: w - 6 }) + 10));
    doc.rect(L, y, R - L, hh).fill(NAVY); doc.fillColor('#FFFFFF');
    cols.forEach(([h, w]) => { doc.text(h, x + 3, y + 5, { width: w - 6 }); x += w; });
    doc.y = y + hh;
  };
  drawHead();
  doc.font('Helvetica').fontSize(fs);
  rows.forEach((r, i) => {
    const vals = [i + 1, ...fields.map((x) => x[4](r))];
    const h = Math.max(18, ...vals.map((v, k) => doc.heightOfString(String(v), { width: cols[k][1] - 6 }) + 8));
    if (doc.y + h > doc.page.height - 50) { doc.addPage(); header(); doc.y = 82; drawHead(); doc.font('Helvetica').fontSize(fs); }
    const y = doc.y;
    if (i % 2) doc.rect(L, y, R - L, h).fill('#F5F7FB');
    let x = L;
    doc.fillColor('#0F172A');
    vals.forEach((v, k) => { doc.text(String(v), x + 3, y + 4, { width: cols[k][1] - 6 }); x += cols[k][1]; });
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

// ---------- daily 9 AM summary email: untouched enquiries + follow-ups ----------
async function sendDigest(force) {
  if (!mailer) return { ok: false, error: 'Email is not set up' };
  const today = istToday();
  if (!force && (await db.getSetting('digest_last', '')) === today) return { ok: true, skipped: true };
  const all = await db.listEnquiries({});
  const dayAgo = Date.now() - 24 * 3600e3, open = (r) => !['Admitted', 'Not Interested'].includes(r.status);
  const untouched = all.filter((r) => r.status === 'New' && !r.call_count && new Date(r.created_at).getTime() < dayAgo);
  const noCaller = untouched.filter((r) => !r.caller_id);
  const overdue = all.filter((r) => r.next_action_date && r.next_action_date < today && open(r));
  const dueToday = all.filter((r) => r.next_action_date === today && open(r));
  const fresh = all.filter((r) => new Date(r.created_at).getTime() >= dayAgo);
  const per = {};
  [...untouched.map((r) => [r, 'u']), ...overdue.map((r) => [r, 'o']), ...dueToday.map((r) => [r, 't'])].forEach(([r, k]) => {
    const n = r.caller_name || 'Not assigned'; per[n] = per[n] || { u: 0, o: 0, t: 0 }; per[n][k] += 1; });
  const rowsHtml = Object.entries(per).sort((a, b) => (b[1].u + b[1].o) - (a[1].u + a[1].o)).map(([n, c]) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${n.replace(/[<&>]/g, '')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#b91c1c;font-weight:700">${c.u}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#c2410c">${c.o}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${c.t}</td></tr>`).join('');
  const tile = (n, l, c) => `<td style="padding:12px;background:#f8fafc;border-radius:10px;text-align:center"><div style="font-size:26px;font-weight:700;color:${c}">${n}</div><div style="font-size:12px;color:#64748b">${l}</div></td>`;
  const text = `ADYPU admissions - daily summary ${today}: ${untouched.length} untouched for 24h+ (${noCaller.length} with no caller), ${overdue.length} overdue follow-ups, ${dueToday.length} follow-ups due today, ${fresh.length} new enquiries in the last 24h.`;
  await mailer.sendMail({ to: ALERT_EMAIL_TO(), subject: `ADYPU admissions · ${untouched.length} untouched · ${overdue.length} overdue · ${dueToday.length} due today`, text,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px"><div style="background:#0B1F4B;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><b>ADYPU admissions - daily summary</b><div style="font-size:12px;color:#FFD8A8">${fmtDay(today)}</div></div>
      <div style="border:1px solid #e2e8f0;border-top:0;padding:18px;border-radius:0 0 10px 10px"><table style="width:100%;border-spacing:8px"><tr>${tile(untouched.length, 'Untouched 24h+', '#b91c1c')}${tile(overdue.length, 'Overdue follow-ups', '#c2410c')}${tile(dueToday.length, 'Due today', '#0B1F4B')}${tile(fresh.length, 'New in 24h', '#15803d')}</tr></table>
      ${noCaller.length ? `<p style="background:#fef2f2;color:#991b1b;padding:10px;border-radius:8px;font-size:13px">⚠ ${noCaller.length} untouched enquiries have <b>no caller assigned</b>. Open Enquiries → filter "Untouched" → Assign for calling.</p>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><tr style="background:#F08A24;color:#fff"><th style="padding:6px 10px;text-align:left">Caller</th><th>Untouched</th><th>Overdue</th><th>Due today</th></tr>${rowsHtml || '<tr><td colspan="4" style="padding:10px">Nothing pending - well done!</td></tr>'}</table>
      <p style="color:#64748b;font-size:12px;margin-top:14px">Sent automatically every morning at 9 AM IST. Student names and numbers are never included in this email.</p></div></div>` });
  await db.setSetting('digest_last', today);
  return { ok: true, untouched: untouched.length, overdue: overdue.length, dueToday: dueToday.length };
}
setInterval(() => {
  const h = new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
  if (h >= 9 && h < 21) collegesApi.forEachCollege(() => sendDigest(false));
}, 10 * 60 * 1000);

Object.assign(CC, { db, audit, requireAdmin, sendView, istToday, clean, bcrypt, genPassword, ExcelJS, setSession, PUBLIC_URL, ADMIN_NAME });
require('./plus')(app, { forEachCollege: collegesApi.forEachCollege, loadCollege: (slug) => collegesApi.load(slug), db, sec, audit, notifyAdmin, requireAdmin, requireSub, requireXhr, readToken, getMailer: () => mailer, ALERT_EMAIL_TO, ADMIN_NAME, ADMIN_USER, STATUSES,
  CALL_OUTCOMES, LEVELS, ACADEMIC_YEAR, CONTACTS, PUBLIC_URL, siteUrl, IS_PROD, teamRow, masked, counsellorOf, istToday, clean, sendView, bcrypt, genPassword, sms, express, rateLimit, QRCode, PDFDocument, ExcelJS, dupMessage, validDate });

app.get('/api/mail/verify', (req, res) => {
  const n = mailNonces.get(String(req.query.n || '')); const to = String(req.query.to || '').toLowerCase();
  for (const [k, v] of mailNonces) if (v.exp < Date.now()) mailNonces.delete(k);
  if (n && n.exp > Date.now() && n.to === to) { mailNonces.delete(String(req.query.n)); return res.type('text').send('yes'); }
  res.type('text').send('no');
});
app.get('/healthz', (_req, res) => res.send('ok'));
app.use((_req, res) => res.redirect('/'));

db.init().then(() => app.listen(PORT, () => console.log(`ADYPU admission portal running on http://localhost:${PORT}`)))
  .catch((e) => { console.error('DB init failed', e); process.exit(1); });
