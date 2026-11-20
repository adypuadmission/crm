// API keys: lets another portal / website / CRM push admission enquiries into this college's system.
//  • Only the college's MAIN ADMIN can create or revoke keys, and must re-enter the admin password to create one.
//  • The key is shown once; only an HMAC of it is stored. Each key works for ONE college only (its own database).
//  • Optional IP allow-list, per-key rate limit, every call recorded in the Security log, alert e-mail on create / revoke.
const crypto = require('crypto');
const tenant = require('./tenant');

module.exports = function integrations(app, C) {
  const { db, audit, requireAdmin, requireXhr, express } = C;
  const KEY = 'api_keys';
  const hmac = (k) => crypto.createHmac('sha256', C.SECRET).update('apikey:' + k).digest('hex');
  const list = async () => (await db.getSetting(KEY, [])) || [];
  const save = (keys) => db.setSetting(KEY, keys);
  const pub = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, ips: k.ips || [], createdAt: k.createdAt, createdBy: k.createdBy, lastUsed: k.lastUsed || null, uses: k.uses || 0, pushed: k.pushed || 0, revokedAt: k.revokedAt || null });
  const origin = (req) => C.siteUrl(req);

  // ---------- main admin: manage keys ----------
  app.get('/api/admin/api-keys', requireAdmin, async (req, res) => res.json({ keys: (await list()).map(pub), endpoint: origin(req) + '/api/v1', docs: origin(req) + '/api/v1/docs' }));
  const tries = new Map();
  app.post('/api/admin/api-keys', requireAdmin, requireXhr, async (req, res) => {
    const b = req.body || {};
    const t = tries.get(req.ip) || { n: 0, at: Date.now() }; if (Date.now() - t.at > 15 * 60000) { t.n = 0; t.at = Date.now(); }
    if (t.n >= 5) return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    const name = C.clean(b.name, 60);
    if (name.length < 3) return res.status(400).json({ error: 'Give the key a name, e.g. "College website" or "Partner portal".' });
    if (!b.password || !(await C.bcrypt.compare(String(b.password), C.ADMIN_HASH()))) {
      t.n++; tries.set(req.ip, t);
      audit(req, 'api_key_create_wrong_password', name, 'high');
      return res.status(403).json({ error: 'Wrong admin password. For safety, a key can only be created after confirming your password.' });
    }
    const ips = String(b.ips || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
    if (ips.some((ip) => !/^[0-9a-f.:]{3,45}$/i.test(ip))) return res.status(400).json({ error: 'IP allow-list: enter IP addresses separated by commas (or leave it empty).' });
    const scopes = ['push', ...(b.read ? ['read'] : [])];
    const keys = await list();
    if (keys.filter((k) => !k.revokedAt).length >= 10) return res.status(400).json({ error: 'Maximum 10 active keys. Revoke an old one first.' });
    const prefix = crypto.randomBytes(4).toString('hex');
    const secret = `ak_${(tenant.cur().slug || 'main').replace(/-/g, '')}_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
    const k = { id: crypto.randomBytes(6).toString('hex'), name, prefix, hash: hmac(secret), scopes, ips, createdAt: new Date().toISOString(), createdBy: req.user.name, uses: 0, pushed: 0 };
    keys.push(k); await save(keys);
    audit(req, 'api_key_created', `${name} (${prefix}) · ${scopes.join('+')}${ips.length ? ' · IPs ' + ips.join(', ') : ' · any IP'}`, 'high');
    Promise.resolve(C.notifyAdmin(`New API key "${name}" (id ${prefix}) created by ${req.user.name} for ${tenant.cur().name}. If this was not you, revoke it now in Security > API keys.`)).catch(() => {});
    res.json({ ok: true, key: secret, info: pub(k) });
  });
  app.post('/api/admin/api-keys/:id/revoke', requireAdmin, requireXhr, async (req, res) => {
    const keys = await list(); const k = keys.find((x) => x.id === req.params.id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    if (!k.revokedAt) { k.revokedAt = new Date().toISOString(); await save(keys); audit(req, 'api_key_revoked', `${k.name} (${k.prefix})`, 'high'); }
    res.json({ ok: true });
  });
  // sub-admins never reach these (requireAdmin blocks and alerts)

  // ---------- public API (server-to-server, key required) ----------
  const hits = new Map(); // key id → { n, at }
  const LIMIT = 300, WINDOW = 15 * 60000;
  async function auth(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const raw = String(req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '')).trim();
    const m = raw.match(/^ak_[a-z0-9]+_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/);
    const keys = m ? await list() : [];
    const k = m && keys.find((x) => x.prefix === m[1]);
    const ok = k && !k.revokedAt && crypto.timingSafeEqual(Buffer.from(k.hash), Buffer.from(hmac(raw)));
    if (!ok) {
      audit(req, 'api_key_rejected', `${req.method} ${req.originalUrl.split('?')[0]}${k && k.revokedAt ? ' · revoked key ' + k.prefix : m ? ' · unknown/invalid key' : raw ? ' · malformed key' : ' · no key'}`, 'medium', { username: 'api' });
      return res.status(401).json({ error: 'Missing or invalid API key. Send it as the header  X-API-Key: <key>' });
    }
    if (k.ips && k.ips.length && !k.ips.includes(req.ip.replace(/^::ffff:/, ''))) {
      audit(req, 'api_key_blocked_ip', `${k.name} (${k.prefix}) used from ${req.ip}`, 'high', { username: 'api:' + k.name });
      return res.status(403).json({ error: 'This key is not allowed from your IP address.' });
    }
    const h = hits.get(k.id) || { n: 0, at: Date.now() }; if (Date.now() - h.at > WINDOW) { h.n = 0; h.at = Date.now(); } h.n++; hits.set(k.id, h);
    res.set('X-RateLimit-Limit', String(LIMIT)); res.set('X-RateLimit-Remaining', String(Math.max(0, LIMIT - h.n)));
    if (h.n > LIMIT) return res.status(429).json({ error: `Rate limit: ${LIMIT} requests per 15 minutes per key.` });
    req.apiKey = k; req.apiKeys = keys; next();
  }
  const touch = async (req, pushed = 0) => { const k = req.apiKeys.find((x) => x.id === req.apiKey.id); k.lastUsed = new Date().toISOString(); k.uses = (k.uses || 0) + 1; k.pushed = (k.pushed || 0) + pushed; await save(req.apiKeys).catch(() => {}); };
  const need = (scope) => (req, res, next) => (req.apiKey.scopes.includes(scope) ? next() : res.status(403).json({ error: `This key does not have "${scope}" permission.` }));

  app.get('/api/v1/ping', auth, async (req, res) => { await touch(req); res.json({ ok: true, college: tenant.cur().name, key: req.apiKey.name, scopes: req.apiKey.scopes, time: new Date().toISOString() }); });
  app.get('/api/v1/programmes', auth, async (req, res) => {
    await touch(req);
    const out = [];
    for (const lv of ['UG', 'PG']) for (const p of C.LEVELS[lv] || []) for (const br of (p.branches && p.branches.length ? p.branches : [{ name: '' }])) out.push({ level: lv, programme: p.name, branch: br.name || br || '' });
    res.json({ programmes: out });
  });
  app.post('/api/v1/enquiries', express.json({ limit: '600kb' }), auth, need('push'), async (req, res) => {
    const body = req.body || {};
    const items = Array.isArray(body.students) ? body.students : Array.isArray(body) ? body : [body];
    if (!items.length || items.length > 100) return res.status(400).json({ error: 'Send 1–100 students per request: { "students": [ … ] }' });
    const results = []; let created = 0, dups = 0, failed = 0;
    for (const [i, s] of items.entries()) {
      try {
        const r = await C.pushFromApi(s || {}, req.apiKey);
        if (r.errors) { failed++; results.push({ index: i, ok: false, errors: r.errors }); }
        else if (r.duplicate) { dups++; results.push({ index: i, ok: true, duplicate: true, ref_no: r.duplicate.ref_no, message: 'Already registered — not added again (a note was added to the existing student).' }); }
        else { created++; results.push({ index: i, ok: true, ref_no: r.row.ref_no }); }
      } catch (e) { failed++; results.push({ index: i, ok: false, error: 'Server error' }); console.error('api push', e.message); }
    }
    await touch(req, created);
    audit(req, 'api_push', `${req.apiKey.name}: ${created} added, ${dups} already registered, ${failed} rejected`, failed && !created ? 'medium' : 'info', { username: 'api:' + req.apiKey.name });
    res.status(created || dups ? 200 : 400).json({ ok: failed === 0, created, duplicates: dups, rejected: failed, results });
  });
  app.get('/api/v1/enquiries/:ref', auth, need('read'), async (req, res) => {
    await touch(req);
    const r = await db.get('SELECT id FROM enquiries WHERE ref_no = $1', [String(req.params.ref).slice(0, 40)]);
    if (!r) return res.status(404).json({ error: 'No student with this reference number.' });
    const e = await db.getEnquiry(r.id);
    res.json({ ref_no: e.ref_no, status: e.status, admission_form: e.app_status || null, programme: e.course, counsellor: e.counsellor_name || null, created_at: e.created_at, updated_at: e.updated_at || null });
  });
  app.get('/api/v1/docs', async (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(docs(origin(req))));

  function docs(base) {
    const t = tenant.cur(), e = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const ex = JSON.stringify({ students: [{ student_name: 'Aarya Patil', mobile: '9876543210', email: 'aarya@example.com', city: 'Pune', level: 'UG', programme: ((C.LEVELS.UG || [])[0] || {}).name || 'B.Tech', branch: (((C.LEVELS.UG || [])[0] || {}).branches || [])[0]?.name || '', source: 'Partner portal', location: 'Pune', remarks: 'Interested in hostel' }] }, null, 2);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Admission API · ${e(t.name)}</title><link rel="stylesheet" href="/admin.css"><link rel="stylesheet" href="/platform.css"></head>
<body class="pf"><main class="pf-main api-doc"><div class="card"><h1>🔌 Admission API — ${e(t.name)}</h1>
<p>Push student enquiries from your website, partner portal or another CRM straight into this admission system. Students added this way get the same duplicate check, counsellor assignment and follow-up as students who fill the form.</p>
<h2>1 · Get a key</h2><p>Only the <b>main admin</b> can create a key: <i>Admin dashboard → 🛡️ Security → 🔌 API keys</i> (your password is asked again). The key is shown once — keep it on your server, never in a web page or app.</p>
<h2>2 · Send it with every request</h2><pre>X-API-Key: ak_…</pre>
<h2>3 · Add students</h2><p><code>POST ${e(base)}/api/v1/enquiries</code> — 1 to 100 students per call.</p>
<pre>curl -X POST "${e(base)}/api/v1/enquiries" \\
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '${e(ex.replace(/\n\s*/g, ' '))}'</pre>
<table class="api-t"><tr><th>Field</th><th>Required</th><th>Notes</th></tr>
<tr><td>student_name</td><td>✔</td><td>Full name</td></tr><tr><td>mobile</td><td>✔</td><td>10-digit Indian mobile — the same number is never stored twice</td></tr>
<tr><td>city</td><td>✔</td><td>City / district</td></tr><tr><td>level</td><td>✔</td><td>UG or PG</td></tr><tr><td>programme, branch</td><td>✔</td><td>Exactly as listed by <code>GET /api/v1/programmes</code> (branch empty if none)</td></tr>
<tr><td>email</td><td></td><td>Optional</td></tr><tr><td>source, location</td><td></td><td>Where the lead came from — shown as Data source / location filters</td></tr><tr><td>remarks</td><td></td><td>Saved as a note</td></tr></table>
<p>Answer: <code>{ created, duplicates, rejected, results: [ { index, ok, ref_no | errors } ] }</code></p>
<h2>Other calls</h2><ul><li><code>GET /api/v1/ping</code> — test your key</li><li><code>GET /api/v1/programmes</code> — valid level / programme / branch values</li><li><code>GET /api/v1/enquiries/&lt;ref_no&gt;</code> — status of a student (key needs “read” permission; no phone or email is returned)</li></ul>
<h2>Safety</h2><ul><li>A key works for this college only.</li><li>Limit: ${LIMIT} calls per 15 minutes per key · optional IP allow-list.</li><li>Every call is recorded in the Security log; wrong keys raise an alert.</li><li>Revoke a key any time — it stops working immediately.</li></ul></div></main></body></html>`;
  }
};
