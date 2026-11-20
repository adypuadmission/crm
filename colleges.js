// Multi-college platform: every college gets its own link (/c/<code>), its own PostgreSQL database,
// branding, programmes & fees, admin login and alerts. The original ADYPU portal is untouched.
// The platform owner (ADYPU main admin) manages all colleges from /platform.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const tenant = require('./tenant');
const { build } = require('./courses');

module.exports = function colleges(app, C) {
  const db = require('./db'), bcrypt = require('bcryptjs');
  const cache = new Map(); // slug → { ctx, at }
  const ready = new Set(); // colleges whose database tables are created in this process

  // ---------- load a college (config + its own database) ----------
  function toCtx(r) {
    const cfg = JSON.parse(r.config || '{}');
    return {
      slug: r.slug, isDefault: false, id: r.id, name: r.name, short: r.short, status: r.status, dbName: r.db_name, type: cfg.type === 'ol' ? 'ol' : 'regular',
      city: cfg.city || '', address: cfg.address || '', email: cfg.email || '', website: cfg.website || '', phone: cfg.phone || '', color: cfg.color || '#0B1F4B',
      tagline: cfg.tagline || '', academicYear: cfg.academicYear || '2027–28', feeYear: cfg.feeYear || `AY ${cfg.academicYear || '2027-28'}`, contacts: cfg.contacts || [],
      catalogue: build(cfg.catalogue || { UG: [], PG: [] }), rawCatalogue: cfg.catalogue || { UG: [], PG: [] }, hasLogo: !!r.logo,
      admin: { user: r.admin_user, hash: r.admin_hash, name: r.admin_name || 'Admin', email: r.admin_email || '', mobile: r.admin_mobile || '' },
      pool: null,
    };
  }
  const pools = new Map();
  async function load(slug, fresh) {
    const c = cache.get(slug);
    if (c && !fresh && Date.now() - c.at < 30000) return c.ctx;
    const r = await db.registry.get(slug);
    if (!r) { cache.delete(slug); return null; }
    const ctx = toCtx(r);
    if (!pools.has(r.db_name)) pools.set(r.db_name, db.makePool(r.db_name));
    ctx.pool = pools.get(r.db_name);
    if (!ready.has(slug)) { await tenant.als.run(ctx, () => db.init()); ready.add(slug); }
    cache.set(slug, { ctx, at: Date.now() });
    return ctx;
  }
  // run a job (AI caller, daily summary …) for ADYPU and then for every active college
  async function forEachCollege(fn) {
    try { await fn(); } catch (e) { console.error('job', e.message); }
    if (!(typeof db.usePg === 'function' ? db.usePg() : db.usePg)) return;
    for (const r of await db.registry.all().catch(() => [])) {
      if (r.status !== 'active') continue;
      try { const ctx = await load(r.slug); await tenant.als.run(ctx, fn); } catch (e) { console.error('job', r.slug, e.message); }
    }
  }
  C.forEachCollege = forEachCollege;

  // ---------- routing: /c/<slug>/… runs inside that college ----------
  const SLUG = /^\/c\/([a-z0-9][a-z0-9-]{1,28}[a-z0-9])(\/.*)?$/;
  app.use(async (req, res, next) => {
    const m = req.url.match(SLUG);
    if (!m) return next();
    let ctx;
    try { ctx = await load(m[1]); } catch (e) { console.error('college load', e.message); return res.status(503).send('This admission portal is starting up. Please refresh in a minute.'); }
    if (!ctx) return res.status(404).type('html').send(notFound('This admission portal does not exist.'));
    if (ctx.status !== 'active') return res.status(403).type('html').send(notFound('This admission portal is currently not active. Please contact the college.'));
    const baseP = `/c/${ctx.slug}`;
    // keep every redirect and file name inside this college
    const redirect = res.redirect.bind(res);
    res.redirect = (a, b) => { if (typeof a === 'number') return redirect(a, b && b.startsWith('/') && !b.startsWith(baseP + '/') ? baseP + b : b); return redirect(a && a.startsWith('/') && !a.startsWith(baseP + '/') ? baseP + a : a); };
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (k, v) => setHeader(k, /^content-disposition$/i.test(k) && typeof v === 'string' ? tenant.brand(v).replace(/[^\x20-\x7E]/g, '') : v);
    req.url = m[2] || '/';
    tenant.als.run(ctx, () => {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) return sendIndex(res);
      if (req.method === 'GET' && req.url.split('?')[0] === '/logo') return sendLogo(res, ctx);
      next();
    });
  });
  const notFound = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admission portal</title><body style="font-family:system-ui;display:grid;place-items:center;height:90vh;color:#0B1F4B;text-align:center"><div><div style="font-size:48px">🎓</div><h2>${msg}</h2></div></body>`;
  async function sendLogo(res, ctx) {
    const r = await db.registry.get(ctx.slug);
    if (!r || !r.logo) return res.status(404).end();
    const [meta, b64] = String(r.logo).split(',');
    res.set('Cache-Control', 'public, max-age=600').type((meta.match(/data:([^;]+)/) || [])[1] || 'image/png').send(Buffer.from(b64, 'base64'));
  }

  // ---------- pages for a college: same screens, its own name / logo / links ----------
  const STATIC = /^\/(style\.css|app\.js|admin\.css|guard\.js|panel\.js|help\.js|login\.js|apply\.js|apply\.css|tenant-shim\.js|api-keys\.js|deb-tab\.js|platform\.css|favicon[^"]*|fonts\/)/;
  function brandHtml(html, req) {
    const t = tenant.cur(), b = tenant.base();
    const tok = req && C.readToken ? C.readToken(req) : null;
    // in a college: "All colleges" becomes "College profile" (+ a way back for the platform owner)
    const links = `<a class="btn ghost" id="profileLink" href="${b}/admin/profile" title="Edit name, logo, contacts, programmes and fees">🏫 College profile</a>${tok && tok.sup ? ' <a class="btn ghost" href="/platform" title="Back to all colleges">↩ All colleges</a>' : ''}`;
    let h = tenant.brand(html).replace(/<a [^>]*id="platformLink"[^>]*>[^<]*<\/a>/, links)
      .replace(/(href|src|action)="(\/[^"]*)"/g, (all, attr, url) => (STATIC.test(url) || url.startsWith(b + '/') || url === '/platform' ? all : `${attr}="${b}${url}"`))
      .replace('<head>', `<head>\n<meta name="t-base" content="${b}">\n<script src="/tenant-shim.js"></script>`);
    if (t.hasLogo) h = h.replace(/<span class="crest( sm)?">[^<]*<\/span>/g, `<span class="crest$1 logo"><img src="${b}/logo" alt=""></span>`).replace(/<div class="crest">🎓<\/div>/, `<div class="crest logo"><img src="${b}/logo" alt=""></div>`);
    return h;
  }
  C.brandHtml = brandHtml;
  function sendIndex(res) {
    const t = tenant.cur(), b = tenant.base();
    let h = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const progs = t.catalogue.FEE_TABLE.length, schools = new Set(t.catalogue.FEE_TABLE.map((x) => x.school)).size;
    h = h.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="Admission enquiry — ${esc(t.name)}">`)
      .replace('10 Schools · 2 Centres of study', `${progs} programmes${schools > 1 ? ` · ${schools} schools` : ''}`)
      .replace(/<div class="brand-sub">[^<]*<\/div>/, `<div class="brand-sub">${esc(t.city || t.address || '')}</div>`)
      .replace(/<b id="ay">[^<]*<\/b>/, `<b id="ay">${esc(t.academicYear)}</b>`)
      .replace(/<span>📞 Engineering helpline:[^\n]*<\/span>/, t.phone ? `<span>📞 Helpline: <a href="tel:+91${esc(t.phone)}">+91 ${esc(t.phone)}</a></span>` : '<span></span>')
      .replace(/<div class="help-list" id="helpContacts">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, `<div class="help-list" id="helpContacts">${(t.contacts || []).map((c) => `<div class="hc"><div class="hc-av">${esc(c.name.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s*/i, '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</div><div class="hc-n"><b>${esc(c.name)}</b><a href="tel:+91${esc(c.phone)}">+91 ${esc(c.phone)}</a></div><a class="hc-btn call" href="tel:+91${esc(c.phone)}" aria-label="Call">📞</a><a class="hc-btn wa" href="https://wa.me/91${esc(c.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp">💬</a></div>`).join('')}</div>\n    </div>`);
    if (t.tagline) h = h.replace(/<p class="lead">[^<]*<\/p>/, `<p class="lead">${esc(t.tagline)}</p>`);
    if (t.hasLogo) h = h.replace(/<div class="crest" aria-hidden="true">[\s\S]*?<\/div>/, `<div class="crest logo" aria-hidden="true"><img src="${b}/logo" alt=""></div>`);
    res.set('Cache-Control', 'no-cache').type('html').send(brandHtml(h));
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- platform owner: all colleges ----------
  const requireOwner = (req, res, next) => (tenant.isDefault() ? C.requireAdmin(req, res, next) : res.status(404).end());
  // a college's own main admin edits its own profile at /c/<code>/admin/profile (same screen, "self" mode)
  const requireSelf = (req, res, next) => (tenant.isDefault() ? res.status(404).end() : C.requireAdmin(req, res, next));
  const isSelf = (req) => req.path.startsWith('/api/college/');
  const either = (req, res, next) => (isSelf(req) ? requireSelf : requireOwner)(req, res, next);
  const slugOf = (req) => (isSelf(req) ? tenant.cur().slug : req.params.slug);
  app.get('/admin/profile', requireSelf, (_req, res) => {
    const h = fs.readFileSync(path.join(__dirname, 'views', 'platform.html'), 'utf8').replace('<body class="pf">', '<body class="pf self">').replace('<script src="/platform/platform.js"></script>', '<script src="/admin/profile.js"></script>');
    res.set('Cache-Control', 'no-store').type('html').send(brandHtml(h));
  });
  app.get('/admin/profile.js', requireSelf, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'platform.js')));
  app.get('/platform', requireOwner, (_req, res) => C.sendView(res, 'platform.html'));
  app.get('/platform/platform.js', requireOwner, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'platform.js')));

  async function statsFor(dbCtx) {
    const run = async () => {
      const today = C.istToday(), wk = new Date(Date.now() - 7 * 864e5).toISOString();
      const one = async (sql, p = []) => Number(((await db.get(sql, p)) || {}).n || 0);
      const [total, todayN, week, admitted, apps, paid, collected, team, lastAt] = await Promise.all([
        one('SELECT COUNT(*) AS n FROM enquiries'), one('SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= $1', [new Date(today + 'T00:00:00+05:30').toISOString()]),
        one('SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= $1', [wk]), one("SELECT COUNT(*) AS n FROM enquiries WHERE status = 'Admitted'"),
        one('SELECT COUNT(*) AS n FROM applications WHERE submitted_at IS NOT NULL'), one("SELECT COUNT(*) AS n FROM applications WHERE status = 'Paid'"),
        one('SELECT COALESCE(SUM(paid_amount),0) AS n FROM applications'), one("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND kind <> 'ai'"),
        db.get('SELECT MAX(created_at) AS at FROM enquiries')]);
      const byStatus = await db.all('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status');
      const trend = await db.all("SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d, COUNT(*) AS n FROM enquiries WHERE created_at >= $1 GROUP BY 1 ORDER BY 1", [new Date(Date.now() - 14 * 864e5).toISOString()]);
      const untouched = await one("SELECT COUNT(*) AS n FROM enquiries WHERE status = 'New' AND COALESCE(call_count,0) = 0 AND created_at < $1", [new Date(Date.now() - 864e5).toISOString()]);
      const apiKeys = ((await db.getSetting('api_keys', [])) || []).filter((k) => !k.revokedAt).length;
      let debPushed = null; if (tenant.cur().type === 'ol') { try { debPushed = await one("SELECT COUNT(*) AS n FROM deb_learners WHERE status = 'Pushed'"); } catch { debPushed = 0; } }
      return { apiKeys, debPushed, total, today: todayN, week, admitted, apps, paid, collected, team, untouched, lastAt: lastAt && lastAt.at ? new Date(lastAt.at).toISOString() : null,
        byStatus: Object.fromEntries(byStatus.map((x) => [x.status, Number(x.n)])), trend: trend.map((x) => ({ d: x.d, n: Number(x.n) })) };
    };
    return dbCtx ? tenant.als.run(dbCtx, run) : run();
  }
  app.get('/api/platform/colleges', requireOwner, async (req, res) => {
    const list = [{ slug: '', name: tenant.DEFAULT.name, short: tenant.DEFAULT.short, city: tenant.DEFAULT.city, status: 'active', main: true, links: { form: '/', admin: '/admin', poster: '/qr-poster.pdf' }, stats: await statsFor(null) }];
    for (const r of await db.registry.all()) {
      let stats = null, err = null;
      try { stats = await statsFor(await load(r.slug)); } catch (e) { err = e.message.slice(0, 120); }
      const cfg = JSON.parse(r.config || '{}');
      list.push({ slug: r.slug, name: r.name, short: r.short, city: cfg.city || '', status: r.status, logo: !!r.logo, created_at: r.created_at, adminUser: r.admin_user, adminEmail: r.admin_email,
        programmes: build(cfg.catalogue || {}).FEE_TABLE.length, type: cfg.type === 'ol' ? 'ol' : 'regular', links: { form: `/c/${r.slug}/`, admin: `/c/${r.slug}/admin/login`, poster: `/c/${r.slug}/qr-poster.pdf` }, stats, error: err });
    }
    res.json({ colleges: list, origin: C.PUBLIC_URL() || `${req.protocol}://${req.get('host')}` });
  });
  app.get(['/api/platform/colleges/:slug', '/api/college/profile'], either, async (req, res) => {
    const r = await db.registry.get(slugOf(req)); if (!r) return res.status(404).json({ error: 'Not found' });
    const cfg = JSON.parse(r.config || '{}');
    res.json({ college: { slug: r.slug, name: r.name, short: r.short, status: r.status, logo: r.logo || '', adminUser: r.admin_user, adminName: r.admin_name, adminEmail: r.admin_email, adminMobile: r.admin_mobile, ...cfg } });
  });

  // --- one Excel sheet comparing every college ---
  app.get('/api/platform/report.xlsx', requireOwner, async (req, res) => {
    const j = { colleges: [] };
    j.colleges.push({ name: tenant.DEFAULT.name, short: tenant.DEFAULT.short, status: 'active', link: '/', stats: await statsFor(null) });
    for (const r of await db.registry.all()) { let st = null; try { st = await statsFor(await load(r.slug)); } catch { /* shown as blank */ } j.colleges.push({ name: r.name, short: r.short, status: r.status, link: `/c/${r.slug}/`, stats: st }); }
    const wb = new C.ExcelJS.Workbook(), ws = wb.addWorksheet('All colleges');
    const origin = C.PUBLIC_URL() || `${req.protocol}://${req.get('host')}`;
    ws.columns = [['College', 38], ['Code', 10], ['Status', 11], ['Enquiries', 11], ['Today', 8], ['Last 7 days', 11], ['Admitted', 10], ['Conversion %', 13], ['Forms submitted', 15], ['Paid', 8], ['Fees collected (₹)', 18], ['Team accounts', 14], ['Waiting 24h+', 13], ['API keys', 10], ['Last enquiry', 20], ['Form link', 46]].map(([header, width]) => ({ header, width }));
    for (const c of j.colleges) { const s = c.stats || {};
      ws.addRow([c.name, c.short, c.status, s.total, s.today, s.week, s.admitted, s.total ? Math.round((s.admitted / s.total) * 1000) / 10 : 0, s.apps, s.paid, s.collected, s.team, s.untouched, s.apiKeys, s.lastAt ? new Date(s.lastAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '', origin + c.link]); }
    const tot = ws.addRow(['TOTAL', '', '', ...[4, 5, 6, 7].map((i) => ({ formula: `SUM(${String.fromCharCode(64 + i)}2:${String.fromCharCode(64 + i)}${j.colleges.length + 1})` })), '', ...[9, 10, 11, 12, 13].map((i) => ({ formula: `SUM(${String.fromCharCode(64 + i)}2:${String.fromCharCode(64 + i)}${j.colleges.length + 1})` }))]);
    tot.font = { bold: true };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getColumn(11).numFmt = '#,##0';
    C.audit(req, 'platform_report_downloaded', `${j.colleges.length} colleges`, 'medium');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="All_Colleges_Report_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });

  // --- programmes from Excel / PDF / typed text → rows for a preview the owner can edit ---
  app.post(['/api/platform/parse-programmes', '/api/college/parse-programmes'], either, C.requireXhr, C.express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
    try {
      const kind = String(req.query.kind || 'text');
      let rows = [];
      if (kind === 'excel') rows = await fromExcel(req.body);
      else if (kind === 'pdf') { const pdf = require('pdf-parse/lib/pdf-parse.js'); rows = fromText((await pdf(req.body)).text); }
      else rows = fromText(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || ''));
      res.json({ rows: rows.slice(0, 400) });
    } catch (e) { res.status(400).json({ error: 'Could not read that file: ' + e.message.slice(0, 120) }); }
  });
  const DEGREES = [['B.Tech', /\bBachelor of (Technology|Engineering)\b/i], ['M.Tech', /\bMaster of (Technology|Engineering)\b/i], ['B.Sc', /\bBachelor of Science\b/i], ['M.Sc', /\bMaster of Science\b/i],
    ['BBA', /\bBachelor of Business Administration\b/i], ['MBA', /\bMaster of Business Administration\b/i], ['BCA', /\bBachelor of Computer Applications?\b/i], ['MCA', /\bMaster of Computer Applications?\b/i],
    ['B.Com', /\bBachelor of Commerce\b/i], ['M.Com', /\bMaster of Commerce\b/i], ['BA', /\bBachelor of Arts\b/i], ['MA', /\bMaster of Arts\b/i], ['B.Des', /\bBachelor of Design\b/i], ['M.Des', /\bMaster of Design\b/i],
    ['BA LLB', /\bB\.?\s?A\.?\s*,?\s*LL\.?\s?B\b/i], ['BBA LLB', /\bBBA\s*,?\s*LL\.?\s?B\b/i], ['B.Tech', /\bB\.?\s?Tech\b|\bB\.?\s?E\.?\b(?=\s)/i], ['M.Tech', /\bM\.?\s?Tech\b|\bM\.?\s?E\.?\b(?=\s)/i],
    ['B.Des', /\bB\.?\s?Des\b/i], ['M.Des', /\bM\.?\s?Des\b/i], ['BBA', /\bBBA\b/i], ['MBA', /\bMBA\b/i], ['PGDM', /\bPGDM\b/i], ['BCA', /\bBCA\b/i], ['MCA', /\bMCA\b/i],
    ['B.Sc', /\bB\.?\s?Sc\b/i], ['M.Sc', /\bM\.?\s?Sc\b/i], ['B.Com', /\bB\.?\s?Com\b/i], ['M.Com', /\bM\.?\s?Com\b/i], ['LLB', /\bLL\.?\s?B\b/i], ['LLM', /\bLL\.?\s?M\b/i],
    ['B.Pharm', /\bB\.?\s?Pharm/i], ['M.Pharm', /\bM\.?\s?Pharm/i], ['D.Pharm', /\bD\.?\s?Pharm/i], ['Pharm.D', /\bPharm\.?\s?D\b/i], ['B.Arch', /\bB\.?\s?Arch/i], ['M.Arch', /\bM\.?\s?Arch/i],
    ['Ph.D', /\bPh\.?\s?D\b/i], ['PG Diploma', /\bPG\s?Diploma\b|\bPGD\b/i], ['Diploma', /\bDiploma\b/i], ['B.Ed', /\bB\.?\s?Ed\b/i], ['M.Ed', /\bM\.?\s?Ed\b/i], ['BHMCT', /\bBHMCT\b/i],
    ['MBBS', /\bMBBS\b/i], ['BDS', /\bBDS\b/i], ['BAMS', /\bBAMS\b/i], ['BHMS', /\bBHMS\b/i], ['BPT', /\bBPT\b/i], ['B.Voc', /\bB\.?\s?Voc\b/i], ['BA', /\bB\.?\s?A\b(?!\w)/], ['MA', /\bM\.?\s?A\b(?!\w)/],
    ['Certificate', /\bCertificate\b/i]];
  const PG = /^(M\.|MBA|MCA|MA$|LLM|PGDM|PG Diploma|Ph\.D|MPT|Master)/i;
  const FEE = /(?:₹|rs\.?|inr)?\s*((?:\d{1,2},)?(?:\d{2},)*\d{2,3},\d{3}|\d{4,7})(?:\.\d{1,2})?\s*(?:\/-)?\s*(?:per\s+(?:year|annum))?\s*$/i;
  const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|In|For|The)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
  function parseLine(text, fee, school) {
    let t = text.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    let degree = null;
    for (const [name, rx] of DEGREES) { if (rx.test(t)) { degree = name; t = t.replace(rx, ' '); break; } }
    t = t.replace(/^\s*[-–:,]\s*/, '');
    let spec = t.replace(/\(|\)/g, ' ').replace(/^\s*[-–:,|]+|[-–:,|]+\s*$/g, '').replace(/\b(in|with|specialization in|specialisation in|hons\.?|honours)\b\s*/ig, (w) => (/hon/i.test(w) ? 'Honours ' : '')).replace(/\s+/g, ' ').trim();
    if (!degree) { degree = spec; spec = ''; }
    if (!degree) return null;
    return { level: PG.test(degree) ? 'PG' : 'UG', school: school || 'Programmes', programme: degree, branch: spec.replace(/^[-–]\s*/, ''), fee };
  }
  function fromText(text) {
    const rows = []; let school = '', pending = '';
    for (let raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, ' ').trim(); if (!line) continue;
      // structured: "UG | B.Tech | CSE | 150000"  or tab / comma separated
      const parts = line.split(/\s*[|\t]\s*/);
      if (parts.length >= 3) {
        const feeP = parts.find((x) => /^\D{0,3}\d[\d,]{3,}/.test(x)); const fee = feeP ? +feeP.replace(/\D/g, '') : 0;
        const lv = parts.find((x) => /^(UG|PG)$/i.test(x)); const rest = parts.filter((x) => x !== feeP && x !== lv);
        const r = parseLine(rest.join(' '), fee, school); if (r) { if (lv) r.level = lv.toUpperCase(); rows.push(r); } continue;
      }
      if (/^(school|faculty|department|institute|centre|center) of\b/i.test(line) && !FEE.test(line)) { school = titleCase(line); pending = ''; continue; }
      if (/fee|structure|tuition|program(me)?\s*name|sr\.?\s*no|^\(?\s*₹\s*\)?$/i.test(line) && !/\d{4,}|\d{1,3},\d{3}/.test(line)) continue;
      const m = line.match(FEE);
      if (!m) { pending = (pending ? pending + ' ' : '') + line; continue; }
      const fee = +m[1].replace(/,/g, ''); if (fee < 1000 || (/^(19|20)\d\d$/.test(m[1]) && /\b(AY|year|structure|20\d\d\s*-)/i.test(line))) { pending = ''; continue; }
      if (/fees?\s+structure|university,?\s|^\s*(sr|s)\.?\s*no/i.test(line) && !DEGREES.some(([, rx]) => rx.test(line))) { pending = ''; continue; }
      if (fee < 1000) { pending = (pending ? pending + ' ' : '') + line; continue; }
      const textPart = (pending + ' ' + line.slice(0, m.index)).trim(); pending = '';
      const r = parseLine(textPart, fee, school); if (r) rows.push(r);
    }
    return rows;
  }
  async function fromExcel(buf) {
    const wb = new C.ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { await wb.csv.read(require('stream').Readable.from(buf.toString('utf8'))); }
    const ws = wb.worksheets[0]; if (!ws) return [];
    const cell = (v) => (v && typeof v === 'object' ? (v.text || v.result || (v.richText ? v.richText.map((x) => x.text).join('') : '')) : v ?? '').toString().trim();
    let head = null, map = {};
    ws.eachRow((row, i) => { if (head) return; const vals = row.values.map(cell); if (vals.some((v) => /program|course|degree/i.test(v))) { head = i;
      vals.forEach((v, j) => { const k = v.toLowerCase(); if (/level|ug\/pg|type/.test(k)) map.level = j; else if (/school|faculty|department/.test(k)) map.school = j; else if (/special|branch|stream|discipline/.test(k)) map.branch = j;
        else if (/program|course|degree/.test(k) && map.programme === undefined) map.programme = j; else if (/fee|amount|tuition|₹|rs/.test(k)) map.fee = j; }); } });
    const rows = [];
    if (!head) { const lines = []; ws.eachRow((row) => lines.push(row.values.map(cell).filter(Boolean).join(' | '))); return fromText(lines.join('\n')); }
    ws.eachRow((row, i) => {
      if (i <= head) return; const v = row.values.map(cell);
      const progText = [v[map.programme], v[map.branch]].filter(Boolean).join(' '); if (!progText) return;
      const r = parseLine(v[map.programme] || '', +(String(v[map.fee] || '').replace(/[^\d.]/g, '')) || 0, v[map.school] || '');
      if (!r) return;
      if (map.branch !== undefined && v[map.branch]) r.branch = v[map.branch];
      if (map.level !== undefined && /^(UG|PG)/i.test(v[map.level])) r.level = v[map.level].slice(0, 2).toUpperCase();
      rows.push(r);
    });
    return rows;
  }
  const ICONS = [[/tech|engineer|\bB\.E/i, '🛠️'], [/mba|bba|pgdm|manage|commerce|com\b/i, '📊'], [/bca|mca|computer/i, '💻'], [/des\b|design|arch/i, '🎨'], [/law|llb|llm/i, '⚖️'], [/hotel|hospitality|tourism|culinary/i, '🏨'],
    [/pharm/i, '💊'], [/sc\b|science|physics|chem|bio/i, '🔬'], [/\bba\b|\bma\b|arts|psych|english|econ/i, '📖'], [/mbbs|bds|bams|bhms|nurs|medical|bpt/i, '🩺'], [/ed\b|education/i, '🍎'], [/ph\.?d/i, '🎓']];
  const iconOf = (p) => (ICONS.find(([rx]) => rx.test(p)) || [0, '🎓'])[1];
  function rowsToCatalogue(rows) {
    const cat = { UG: [], PG: [] };
    for (const r of rows) {
      const lv = r.level === 'PG' ? 'PG' : 'UG', name = C.clean(r.programme, 60), branch = C.clean(r.branch || '', 60), school = C.clean(r.school || 'Programmes', 60), fee = Math.max(0, parseInt(r.fee, 10) || 0);
      if (!name) continue;
      let p = cat[lv].find((x) => x[1] === name);
      if (!p) { p = [school, name, iconOf(name), []]; cat[lv].push(p); }
      if (!p[3].some((x) => x[0] === branch)) p[3].push([branch, fee]);
    }
    for (const lv of ['UG', 'PG']) for (const p of cat[lv]) if (p[3].length > 1) p[3] = p[3].filter((x) => x[0]); // a programme with specialisations needs no blank one
    return cat;
  }

  // --- create / update a college ---
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  function readCollege(b) {
    const out = { name: C.clean(b.name, 120), short: C.clean(b.short, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''), cfg: {
      type: b.type === 'ol' ? 'ol' : 'regular', city: C.clean(b.city, 60), address: C.clean(b.address, 160), email: C.clean(b.email, 120), website: C.clean(b.website, 120), phone: String(b.phone || '').replace(/\D/g, '').slice(-10),
      tagline: C.clean(b.tagline, 200), academicYear: C.clean(b.academicYear, 12) || '2027–28', feeYear: C.clean(b.feeYear, 60), color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#0B1F4B',
      contacts: (Array.isArray(b.contacts) ? b.contacts : []).map((c) => ({ name: C.clean(c.name, 60), phone: String(c.phone || '').replace(/\D/g, '').slice(-10) })).filter((c) => c.name && /^[6-9]\d{9}$/.test(c.phone)).slice(0, 4),
      catalogue: rowsToCatalogue(Array.isArray(b.programmes) ? b.programmes : []) } };
    return out;
  }
  function checkLogo(logo) {
    if (!logo) return null;
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new Error('Logo must be a PNG, JPG or WEBP image.');
    if (logo.length > 420000) throw new Error('Logo is too large (max ~300 KB).');
    return logo;
  }
  app.post('/api/platform/colleges', requireOwner, C.requireXhr, C.express.json({ limit: '1mb' }), async (req, res) => {
    const b = req.body || {}, c = readCollege(b);
    const slug = slugify(b.slug || c.short || c.name);
    const adminUser = C.clean(b.adminUser, 30).toLowerCase() || 'admin', adminEmail = C.clean(b.adminEmail, 120);
    if (c.name.length < 3) return res.status(400).json({ error: 'Enter the college name.' });
    if (!c.short) return res.status(400).json({ error: 'Enter a short code (e.g. SNBP).' });
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) return res.status(400).json({ error: 'The link code must be 3–30 letters / numbers.' });
    if (!c.cfg.catalogue.UG.length && !c.cfg.catalogue.PG.length) return res.status(400).json({ error: 'Add at least one programme.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail)) return res.status(400).json({ error: 'Enter the admin email — login codes and alerts go there.' });
    if (!/^[a-z0-9._-]{3,30}$/.test(adminUser)) return res.status(400).json({ error: 'Admin username: 3–30 letters / numbers.' });
    if (await db.registry.get(slug)) return res.status(409).json({ error: `The link /c/${slug} is already used. Choose another code.` });
    let logo; try { logo = checkLogo(b.logo); } catch (e) { return res.status(400).json({ error: e.message }); }
    const password = String(b.adminPassword || '') || C.genPassword();
    if (password.length < 8) return res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
    const dbName = 'crm_' + slug.replace(/-/g, '_');
    try { await db.createDatabase(dbName); } catch (e) { return res.status(500).json({ error: 'Could not create the database for this college: ' + e.message.slice(0, 150) }); }
    await db.registry.insert({ slug, name: c.name, short: c.short, db_name: dbName, config: JSON.stringify(c.cfg), logo, admin_user: adminUser, admin_hash: await bcrypt.hash(password, 12),
      admin_name: C.clean(b.adminName, 60) || 'Admin', admin_email: adminEmail, admin_mobile: String(b.adminMobile || '').replace(/\D/g, '').slice(-10), status: 'active' });
    try { await load(slug, true); } catch (e) { return res.status(500).json({ error: 'College saved, but its database could not be prepared: ' + e.message.slice(0, 150) }); }
    C.audit(req, 'college_created', `${c.cfg.type === 'ol' ? '[Online Learning] ' : ''}${c.name} (/c/${slug}) · ${c.cfg.catalogue.UG.length + c.cfg.catalogue.PG.length} programmes · own database ${dbName}`, 'high');
    const origin = C.PUBLIC_URL() || `${req.protocol}://${req.get('host')}`;
    res.json({ ok: true, slug, password, adminUser, links: { form: `${origin}/c/${slug}/`, admin: `${origin}/c/${slug}/admin/login`, poster: `${origin}/c/${slug}/qr-poster.pdf` } });
  });
  app.put(['/api/platform/colleges/:slug', '/api/college/profile'], either, C.requireXhr, C.express.json({ limit: '1mb' }), async (req, res) => {
    const r = await db.registry.get(slugOf(req)); if (!r) return res.status(404).json({ error: 'Not found' });
    const b = { ...(req.body || {}) }, upd = {};
    if (isSelf(req)) { delete b.status; delete b.resetPassword; } // a college cannot suspend itself; password resets stay with the platform owner
    if (b.status !== undefined) upd.status = b.status === 'active' ? 'active' : 'suspended';
    if (b.name !== undefined) {
      const c = readCollege({ ...JSON.parse(r.config || '{}'), ...b, programmes: b.programmes || catalogueRows(JSON.parse(r.config || '{}').catalogue) });
      if (c.name.length < 3 || !c.short) return res.status(400).json({ error: 'Enter the college name and short code.' });
      Object.assign(upd, { name: c.name, short: c.short, config: JSON.stringify(c.cfg) });
      if (b.adminEmail !== undefined) upd.admin_email = C.clean(b.adminEmail, 120);
      if (b.adminName !== undefined) upd.admin_name = C.clean(b.adminName, 60);
      if (b.adminMobile !== undefined) upd.admin_mobile = String(b.adminMobile || '').replace(/\D/g, '').slice(-10);
    }
    if (b.logo !== undefined) { try { upd.logo = b.logo ? checkLogo(b.logo) : null; } catch (e) { return res.status(400).json({ error: e.message }); } }
    let password;
    if (b.resetPassword) { password = C.genPassword(); upd.admin_hash = await bcrypt.hash(password, 12); }
    await db.registry.update(r.slug, upd); cache.delete(r.slug);
    C.audit(req, 'college_updated', `${r.name}: ${Object.keys(upd).join(', ')}${password ? ' (admin password reset)' : ''}`, b.status || password ? 'high' : 'medium');
    res.json({ ok: true, password });
  });
  const catalogueRows = (cat) => Object.entries(cat || {}).flatMap(([lv, list]) => list.flatMap(([school, name, , specs]) => specs.map(([branch, fee]) => ({ level: lv, school, programme: name, branch, fee }))));
  app.get(['/api/platform/colleges/:slug/programmes', '/api/college/programmes'], either, async (req, res) => {
    const r = await db.registry.get(slugOf(req)); if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ rows: catalogueRows(JSON.parse(r.config || '{}').catalogue) });
  });
  // the platform owner opens a college's dashboard (signed in as that college's admin; recorded in its log)
  app.post('/api/platform/colleges/:slug/open', requireOwner, C.requireXhr, async (req, res) => {
    const ctx = await load(req.params.slug); if (!ctx) return res.status(404).json({ error: 'Not found' });
    C.audit(req, 'college_dashboard_opened', ctx.name, 'info');
    tenant.als.run(ctx, () => {
      C.audit(req, 'platform_owner_opened_dashboard', 'Platform owner opened this dashboard from the colleges platform', 'medium', { role: 'admin', u: 'platform' });
      C.setSession(res, { u: ctx.admin.user, role: 'admin', sup: 1 }, req);
      res.json({ ok: true, url: `/c/${ctx.slug}/admin` });
    });
  });
  app.get(['/api/platform/template.xlsx', '/api/college/template.xlsx'], either, async (_req, res) => {
    const wb = new C.ExcelJS.Workbook(), ws = wb.addWorksheet('Programmes');
    ws.columns = [['Level (UG/PG)', 14], ['School', 30], ['Programme', 22], ['Specialisation', 34], ['Annual Fee (₹)', 16]].map(([header, width]) => ({ header, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } };
    [['UG', 'School of Engineering', 'B.Tech', 'Computer Engineering', 150000], ['UG', 'School of Engineering', 'B.Tech', 'Mechanical Engineering', 120000], ['UG', 'School of Management', 'BBA', '', 100000], ['PG', 'School of Management', 'MBA', 'Finance', 200000]].forEach((r) => ws.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Programmes_Template.xlsx"');
    await wb.xlsx.write(res); res.end();
  });
  return { load, forEachCollege, statsFor };
};
