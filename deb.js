// UGC-DEB integration — ONLY for colleges created as "Online Learning (OL/ODL)".
// Regular colleges and the main ADYPU portal never see these routes (404) or this data.
//  • Learners for DEB live in their own table (deb_learners), separate from enquiries / applications.
//  • DEB credentials (ClientID + APIKey for each DEB API) are stored encrypted; only the college's MAIN ADMIN can set them,
//    and must re-enter the admin password. Keys are never sent back to the browser.
//  • Calls exactly as in the DEB Postman sample: POST https://deb.ugc.ac.in/api/DebUniqueID/<Api>?<params>,
//    headers APIKey + ClientID (and, optionally, ClientID=APIKey as a query parameter, as in the sample).
const crypto = require('crypto');
const tenant = require('./tenant');

const DEB_BASE = (process.env.DEB_BASE || 'https://deb.ugc.ac.in/api/DebUniqueID').replace(/\/$/, '');
const LISTS = {
  category: ['General', 'OBC', 'SC', 'ST', 'EWS'],
  locality: ['Urban', 'Rural'],
  govId: ['Aadhaar', 'Passport', 'Voter ID', 'Driving Licence', 'PAN'],
  mode: ['Online(OL)', 'Open and Distance Learning (ODL)'],
};
// common spellings in old sheets → DEB wording (shown to the admin in the import preview)
const NORMAL = {
  category: { open: 'General', gen: 'General', general: 'General', 'general / open': 'General', 'open / general': 'General', obc: 'OBC', sc: 'SC', st: 'ST', ews: 'EWS' },
  govId: { 'adhar card': 'Aadhaar', 'aadhar card': 'Aadhaar', 'aadhaar card': 'Aadhaar', adhar: 'Aadhaar', aadhar: 'Aadhaar', aadhaar: 'Aadhaar', passport: 'Passport', pan: 'PAN', 'pan card': 'PAN', 'voter id': 'Voter ID', 'driving licence': 'Driving Licence', 'driving license': 'Driving Licence' },
  locality: { urban: 'Urban', rural: 'Rural' },
  nationality: { indian: 'Indian', india: 'Indian' },
  country: { india: 'India', indian: 'India' },
};

module.exports = function deb(app, C) {
  const { db, sec, audit, requireAdmin, requireXhr, express } = C;
  const isOL = () => !tenant.isDefault() && tenant.cur().type === 'ol';
  const onlyOL = (req, res, next) => (isOL() ? next() : res.status(404).json({ error: 'Not available' }));
  const guard = [onlyOL, requireAdmin];
  const digits = (v) => String(v ?? '').replace(/\.0+$/, '').replace(/\D/g, '');
  const pad12 = (v) => { const d = digits(v); return d && d.length < 12 && d.length >= 9 ? d.padStart(12, '0') : d; };
  const clean = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[,;]+$/, '').slice(0, n);
  const norm = (kind, v) => { const s = clean(v, 60); if (!s) return ''; const k = s.toLowerCase(); return (NORMAL[kind] && NORMAL[kind][k]) || s; };
  function ddmmyyyy(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return `${String(v.getUTCDate()).padStart(2, '0')}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${v.getUTCFullYear()}`;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[1]}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
    if (/^\d{5}$/.test(s)) return ddmmyyyy(new Date(Math.round((+s - 25569) * 864e5))); // Excel serial date
    return '';
  }
  const validDate = (s) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s || ''); if (!m) return false; const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`); return !isNaN(d) && d.getUTCDate() === +m[1]; };

  // ---------- storage (own table, created on first use in each OL college's database) ----------
  const ready = new Set();
  async function ensure() {
    const key = tenant.cur().slug; if (ready.has(key)) return;
    const id = db.usePg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await db.run(`CREATE TABLE IF NOT EXISTS deb_learners (id ${id}, data TEXT NOT NULL, deb_hash TEXT, abc_hash TEXT, programme TEXT, status TEXT NOT NULL DEFAULT 'Incomplete',
      verified TEXT, enquiry_id INTEGER, source TEXT, created_at TEXT NOT NULL, updated_at TEXT, pushed_at TEXT, pushed_by TEXT, last_msg TEXT)`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_deb_hash ON deb_learners(deb_hash)');
    ready.add(key);
  }
  const readRow = (r) => { const d = JSON.parse(sec.decrypt(r.data) || '{}'); return { id: r.id, ...d, status: r.status, verified: r.verified ? JSON.parse(r.verified) : null, enquiry_id: r.enquiry_id, source: r.source, created_at: r.created_at, updated_at: r.updated_at, pushed_at: r.pushed_at, pushed_by: r.pushed_by, last_msg: r.last_msg }; };
  const conf = async () => { const raw = await db.getSetting('deb_conf', null); return raw ? JSON.parse(sec.decrypt(raw) || '{}') : {}; };
  const saveConf = (c) => db.setSetting('deb_conf', sec.encrypt(JSON.stringify(c)));
  const progKey = (lv, p, br) => [lv, p, br || ''].join('|');
  function programmes() {
    const out = [];
    for (const lv of ['UG', 'PG']) for (const p of C.LEVELS[lv] || []) for (const br of (p.branches && p.branches.length ? p.branches : [{ name: '' }])) {
      const b = br.name || (typeof br === 'string' ? br : ''); out.push({ key: progKey(lv, p.name, b), label: `${p.name}${b ? ' – ' + b : ''}` });
    }
    return out;
  }

  // what is missing before a learner can be pushed
  function issues(l, c) {
    const out = [], map = (c.programmes || {})[l.programme] || {};
    if (!/^\d{12}$/.test(l.deb_id || '')) out.push(l.deb_id ? 'DEB-ID must be 12 digits' : 'DEB-ID missing');
    if (!l.programme || !programmes().some((p) => p.key === l.programme)) out.push('Programme not chosen');
    else if (!map.code) out.push('Programme has no DEB code (DEB connection → programme codes)');
    if (!l.enrollment_no) out.push('Enrolment number missing');
    if (!validDate(l.admission_date)) out.push('Admission date (DD-MM-YYYY) missing');
    for (const [k, label] of [['category', 'Category'], ['locality', 'Locality (Urban / Rural)'], ['nationality', 'Nationality'], ['gov_id_type', 'Government ID type'], ['country', 'Country of residence']]) if (!l[k]) out.push(label + ' missing');
    if (!l.gov_id_no) out.push('Government ID number missing');
    else if (l.gov_id_type === 'Aadhaar' && !/^\d{12}$/.test(l.gov_id_no)) out.push('Aadhaar must be 12 digits');
    return out;
  }
  const statusOf = (l, c, prev) => (prev === 'Pushed' ? 'Pushed' : issues(l, c).length ? 'Incomplete' : prev === 'Failed' ? 'Failed' : 'Ready');
  const maskId = (v) => (v ? 'XXXX-XXXX-' + String(v).slice(-4) : '');
  const pub = (l, c) => ({ ...l, gov_id_no: maskId(l.gov_id_no), has_gov_id: !!l.gov_id_no, issues: issues(l, c), mode: ((c.programmes || {})[l.programme] || {}).mode || '', deb_code: ((c.programmes || {})[l.programme] || {}).code || '' });

  const FIELDS = ['name', 'programme', 'abc_id', 'deb_id', 'gender', 'dob', 'email', 'enrollment_no', 'admission_date', 'admission_details', 'category', 'locality', 'nationality', 'gov_id_type', 'gov_id_no', 'country'];
  function fromInput(b, old = {}) {
    const l = { ...old };
    for (const k of FIELDS) if (b[k] !== undefined && k !== 'gov_id_no') l[k] = b[k]; // ID number: blank = keep the saved one
    l.name = clean(l.name, 100); l.abc_id = pad12(l.abc_id); l.deb_id = pad12(l.deb_id);
    l.gender = clean(l.gender, 12).toUpperCase(); l.dob = ddmmyyyy(l.dob) || clean(l.dob, 12); l.email = clean(l.email, 120).toLowerCase();
    l.enrollment_no = clean(l.enrollment_no, 40); l.admission_date = ddmmyyyy(l.admission_date) || clean(l.admission_date, 12); l.admission_details = clean(l.admission_details, 100);
    l.category = norm('category', l.category); l.locality = norm('locality', l.locality); l.nationality = norm('nationality', l.nationality); l.country = norm('country', l.country); l.gov_id_type = norm('govId', l.gov_id_type);
    if (b.gov_id_no !== undefined && String(b.gov_id_no).trim() !== '' && !/^X+/.test(String(b.gov_id_no))) l.gov_id_no = l.gov_id_type === 'Aadhaar' ? pad12(b.gov_id_no) : clean(b.gov_id_no, 30).toUpperCase();
    return l;
  }
  async function store(l, { id, source, enquiry_id, prevStatus } = {}) {
    const c = await conf(), now = new Date().toISOString();
    const status = statusOf(l, c, prevStatus);
    const vals = [sec.encrypt(JSON.stringify(l)), l.deb_id ? sec.blind(l.deb_id) : null, l.abc_id ? sec.blind(l.abc_id) : null, l.programme || null, status];
    if (id) { await db.run('UPDATE deb_learners SET data = $1, deb_hash = $2, abc_hash = $3, programme = $4, status = $5, updated_at = $6 WHERE id = $7', [...vals, now, id]); return id; }
    const r = await db.get('INSERT INTO deb_learners (data, deb_hash, abc_hash, programme, status, source, enquiry_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id', [...vals, source || 'manual', enquiry_id || null, now]);
    return r.id;
  }
  async function findSame(l, exceptId) {
    for (const [col, v] of [['deb_hash', l.deb_id], ['abc_hash', l.abc_id]]) {
      if (!v) continue; const r = await db.get(`SELECT id FROM deb_learners WHERE ${col} = $1 AND id <> $2`, [sec.blind(v), exceptId || 0]); if (r) return r.id;
    }
    return null;
  }

  // ---------- calling DEB ----------
  async function callDeb(api, params, cred, c) {
    if (!cred || !cred.clientId || !cred.apiKey) return { ok: false, message: 'DEB credentials for this API are not saved yet (DEB connection).' };
    const url = new URL(`${DEB_BASE}/${api}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v ?? '');
    if (c.keyInQuery !== false) url.searchParams.set(cred.clientId, cred.apiKey); // as in DEB's Postman sample
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { APIKey: cred.apiKey, ClientID: cred.clientId, Accept: 'application/json', 'Content-Length': '0' }, signal: ctl.signal });
      const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      const status = j ? String(j.Status || j.status || '') : '', message = j ? String(j.Message || j.message || '') : text.slice(0, 160);
      const ok = r.ok && /success/i.test(status) && !/unsuccess/i.test(status);
      return { ok, http: r.status, status, message: (message || status || `HTTP ${r.status}`).slice(0, 300), resource: j ? j.Resource ?? j.resource ?? null : null };
    } catch (e) {
      return { ok: false, message: e.name === 'AbortError' ? 'DEB portal did not answer within 25 seconds — try again later.' : 'Could not reach the DEB portal: ' + String(e.message).slice(0, 80) };
    } finally { clearTimeout(t); } // the URL holds keys and ID numbers: it is never logged
  }
  const nameOf = (res) => { if (!res || typeof res !== 'object') return ''; const o = Array.isArray(res) ? res[0] || {} : res; const k = Object.keys(o).find((x) => /name/i.test(x) && !/(university|course|father|mother|programme)/i.test(x)); return k ? String(o[k]) : ''; };
  const simpleName = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter((w) => w.length > 1).sort().join(' ');
  async function verifyOne(l, c) {
    const r = await callDeb('GetStudentDetails', { DEBUniqueID: l.deb_id }, c.student, c);
    const debName = nameOf(r.resource);
    const nameMatch = !debName || !l.name ? null : (() => { const a = simpleName(debName).split(' '), b = simpleName(l.name).split(' '); return a.filter((w) => b.includes(w)).length >= Math.min(2, b.length); })();
    return { ok: r.ok, at: new Date().toISOString(), message: r.message, debName, nameMatch };
  }

  // ---------- routes ----------
  app.get('/api/deb/status', ...guard, async (_req, res) => {
    await ensure(); const c = await conf();
    const counts = Object.fromEntries((await db.all('SELECT status, COUNT(*) AS n FROM deb_learners GROUP BY status')).map((x) => [x.status, Number(x.n)]));
    res.json({ ol: true, configured: !!(c.heiCode && c.admission && c.admission.clientId), deadline: c.deadline || '', counts, lists: LISTS, base: process.env.DEB_BASE ? 'the DEB portal (test connection)' : DEB_BASE.replace(/^https?:\/\//, '').split('/')[0] });
  });
  app.get('/api/deb/settings', ...guard, async (_req, res) => {
    const c = await conf(), m = (x) => (x && x.clientId ? { clientId: x.clientId, apiKey: '••••••' + String(x.apiKey).slice(-3) } : null);
    res.json({ heiCode: c.heiCode || '', deadline: c.deadline || '', keyInQuery: c.keyInQuery !== false, student: m(c.student), admission: m(c.admission), programmes: c.programmes || {}, list: programmes(), lists: LISTS, savedAt: c.savedAt || null, savedBy: c.savedBy || null });
  });
  const pwTries = new Map();
  app.put('/api/deb/settings', ...guard, requireXhr, async (req, res) => {
    const b = req.body || {}, c = await conf();
    const credChange = ['heiCode', 'studentClientId', 'studentApiKey', 'admissionClientId', 'admissionApiKey', 'keyInQuery'].some((k) => b[k] !== undefined && String(b[k]) !== '' && !(k === 'heiCode' && b[k] === c.heiCode) && !(k === 'keyInQuery' && b[k] === (c.keyInQuery !== false)));
    if (credChange) {
      const t = pwTries.get(req.ip) || { n: 0, at: Date.now() }; if (Date.now() - t.at > 15 * 60000) { t.n = 0; t.at = Date.now(); }
      if (t.n >= 5) return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
      if (!b.password || !(await C.bcrypt.compare(String(b.password), C.ADMIN_HASH()))) { t.n++; pwTries.set(req.ip, t); audit(req, 'deb_settings_wrong_password', '', 'high'); return res.status(403).json({ error: 'Wrong admin password. DEB code and keys can only be changed after confirming your password.' }); }
    }
    if (b.heiCode !== undefined) c.heiCode = clean(b.heiCode, 30);
    for (const api of ['student', 'admission']) {
      const id = clean(b[api + 'ClientId'], 80), key = String(b[api + 'ApiKey'] || '').trim().slice(0, 200);
      if (id || key) { c[api] = { clientId: id || (c[api] || {}).clientId || '', apiKey: key || (c[api] || {}).apiKey || '' }; }
    }
    if (b.keyInQuery !== undefined) c.keyInQuery = !!b.keyInQuery;
    if (b.deadline !== undefined) c.deadline = /^\d{4}-\d{2}-\d{2}$/.test(b.deadline) ? b.deadline : '';
    if (b.programmes && typeof b.programmes === 'object') {
      const valid = new Set(programmes().map((p) => p.key)); c.programmes = {};
      for (const [k, v] of Object.entries(b.programmes)) if (valid.has(k) && v && (v.code || v.mode)) c.programmes[k] = { code: clean(v.code, 30).toUpperCase(), mode: clean(v.mode, 60) || LISTS.mode[0] };
    }
    c.savedAt = new Date().toISOString(); c.savedBy = req.user.name;
    await saveConf(c);
    // statuses depend on the programme codes → refresh them
    await ensure();
    for (const r of await db.all('SELECT * FROM deb_learners')) { const l = readRow(r); const st = statusOf(l, c, r.status); if (st !== r.status) await db.run('UPDATE deb_learners SET status = $1 WHERE id = $2', [st, r.id]); }
    audit(req, 'deb_settings_saved', credChange ? 'DEB HEI code / API keys changed' : 'programme codes / deadline updated', credChange ? 'high' : 'medium');
    res.json({ ok: true });
  });

  app.get('/api/deb/learners', ...guard, async (req, res) => {
    await ensure(); const c = await conf();
    const rows = (await db.all('SELECT * FROM deb_learners ORDER BY id DESC')).map(readRow).map((l) => pub(l, c));
    res.json({ rows, programmes: programmes() });
  });
  app.post('/api/deb/learners', ...guard, requireXhr, async (req, res) => {
    await ensure(); const l = fromInput(req.body || {});
    if (l.name.length < 2) return res.status(400).json({ error: 'Enter the learner name.' });
    const same = await findSame(l); if (same) return res.status(409).json({ error: 'A learner with this DEB-ID / ABC ID is already in the list.' });
    const id = await store(l, { source: 'manual' }); audit(req, 'deb_learner_added', `#${id}`, 'info'); res.json({ ok: true, id });
  });
  app.put('/api/deb/learners/:id', ...guard, requireXhr, async (req, res) => {
    await ensure(); const r = await db.get('SELECT * FROM deb_learners WHERE id = $1', [+req.params.id]); if (!r) return res.status(404).json({ error: 'Not found' });
    const old = readRow(r), l = fromInput(req.body || {}, old);
    const same = await findSame(l, r.id); if (same) return res.status(409).json({ error: 'Another learner already has this DEB-ID / ABC ID.' });
    if (l.deb_id !== old.deb_id) await db.run('UPDATE deb_learners SET verified = NULL WHERE id = $1', [r.id]);
    await store(l, { id: r.id, prevStatus: r.status === 'Pushed' && l.deb_id === old.deb_id ? 'Pushed' : r.status === 'Failed' ? 'Failed' : '' });
    audit(req, 'deb_learner_updated', `#${r.id}`, 'info'); res.json({ ok: true });
  });
  app.delete('/api/deb/learners/:id', ...guard, requireXhr, async (req, res) => {
    await ensure(); const r = await db.get('SELECT status FROM deb_learners WHERE id = $1', [+req.params.id]); if (!r) return res.status(404).json({ error: 'Not found' });
    if (r.status === 'Pushed') return res.status(400).json({ error: 'This learner was already sent to DEB and cannot be removed here.' });
    await db.run('DELETE FROM deb_learners WHERE id = $1', [+req.params.id]); audit(req, 'deb_learner_removed', `#${req.params.id}`, 'medium'); res.json({ ok: true });
  });

  // --- fill one field for many learners at once (e.g. admission date, Urban / Rural) ---
  const BULK = ['admission_date', 'locality', 'category', 'nationality', 'country', 'programme', 'gov_id_type', 'admission_details'];
  app.post('/api/deb/bulk', ...guard, requireXhr, async (req, res) => {
    await ensure(); const { field, value } = req.body || {}; const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 500);
    if (!BULK.includes(field)) return res.status(400).json({ error: 'This field cannot be changed in bulk.' });
    if (!ids.length) return res.status(400).json({ error: 'Select learners first.' });
    let n = 0;
    for (const id of ids) {
      const r = await db.get('SELECT * FROM deb_learners WHERE id = $1', [id]); if (!r || r.status === 'Pushed') continue;
      const l = fromInput({ [field]: value }, readRow(r)); await store(l, { id, prevStatus: r.status === 'Failed' ? 'Failed' : '' }); n++;
    }
    audit(req, 'deb_bulk_update', `${field} set for ${n} learners`, 'info'); res.json({ ok: true, updated: n });
  });

  // --- import the DEB learners workbook (sheets like "ABC ID", "DEB ID", "VIA …"); preview first, then save ---
  app.post('/api/deb/import', ...guard, requireXhr, express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
    await ensure();
    let wb; try { wb = new C.ExcelJS.Workbook(); await wb.xlsx.load(req.body); } catch { return res.status(400).json({ error: 'Please upload the Excel file (.xlsx / .xlsm).' }); }
    const cell = (v) => (v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : '')) : v);
    const H = { name: /student\s*name|^name$/i, code: /program(me)?\s*(map\s*)?code/i, abc: /^abc/i, deb: /^deb/i, gender: /gender/i, dob: /^dob|birth/i, course: /course\s*name|programme\s*name/i,
      enrol: /enrol+ment/i, locality: /locality/i, category: /category/i, nationality: /nationality/i, govType: /government\s*identifier$|gov.*(type|identifier)$/i, govNo: /identifier\s*number|id.*number/i, email: /e-?mail/i, country: /country/i, adate: /admission\s*date/i };
    const people = new Map(); const keyOf = (p) => (p.abc ? 'a' + pad12(p.abc) : 'n' + String(p.name).toLowerCase().replace(/\s+/g, ' '));
    for (const ws of wb.worksheets) {
      let head = null, cols = {};
      ws.eachRow((row, i) => {
        const v = row.values.map(cell);
        if (!head) { if (v.some((x) => x && H.name.test(String(x)))) { head = i; v.forEach((x, j) => { if (!x) return; const s = String(x).trim(); for (const [k, rx] of Object.entries(H)) if (cols[k] === undefined && rx.test(s)) { cols[k] = j; break; } }); } return; }
        const g = (k) => (cols[k] !== undefined ? v[cols[k]] : undefined);
        const name = clean(g('name'), 100); if (!name || name === '-') return;
        const p = { name, abc: g('abc') && g('abc') !== '-' ? digits(g('abc')) : '', sheet: ws.name };
        const prev = people.get(keyOf(p)) || people.get('n' + name.toLowerCase()) || {};
        const set = (k, val) => { if (val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '-') prev[k] = val; };
        set('name', name); set('abc', p.abc); set('deb', g('deb') !== undefined && g('deb') !== '-' ? digits(g('deb')) : undefined); set('code', clean(g('code'), 30).toUpperCase() || undefined);
        set('course', clean(g('course'), 80) || undefined); set('gender', g('gender')); set('dob', g('dob')); set('enrol', clean(g('enrol'), 40) || undefined); set('locality', g('locality')); set('category', g('category'));
        set('nationality', g('nationality')); set('govType', g('govType')); set('govNo', g('govNo')); set('email', g('email')); set('country', g('country')); set('adate', g('adate'));
        prev.sheets = [...new Set([...(prev.sheets || []), ws.name])];
        people.delete('n' + name.toLowerCase()); people.set(keyOf(prev), prev);
      });
    }
    const c = await conf(), list = programmes(), byCode = {};
    for (const [k, v] of Object.entries(c.programmes || {})) if (v.code) byCode[v.code] = k;
    const findProg = (p) => byCode[p.code] || (p.course && (list.find((x) => x.label.toLowerCase() === p.course.toLowerCase()) || list.find((x) => x.label.toLowerCase().split(' – ')[0] === p.course.toLowerCase()) || {}).key) || '';
    const out = [];
    for (const p of people.values()) {
      const changes = [];
      const raw = { deb: digits(p.deb), abc: digits(p.abc), gov: digits(p.govNo) };
      const l = fromInput({ name: p.name, abc_id: p.abc, deb_id: p.deb, gender: p.gender, dob: p.dob, email: p.email, enrollment_no: p.enrol, admission_date: p.adate,
        category: p.category, locality: p.locality, nationality: p.nationality, gov_id_type: p.govType, gov_id_no: p.govNo, country: p.country, programme: findProg(p) });
      if (raw.deb && raw.deb !== l.deb_id) changes.push(`DEB-ID leading zero restored (${raw.deb.length} → 12 digits)`);
      if (raw.abc && raw.abc !== l.abc_id) changes.push('ABC ID leading zero restored');
      if (raw.gov && l.gov_id_no && raw.gov !== l.gov_id_no) changes.push('ID number leading zero restored');
      for (const [k, kind] of [['category', 'category'], ['govType', 'govId'], ['nationality', 'nationality'], ['country', 'country']]) { const o = clean(p[k], 60); if (o && norm(kind, o) !== o) changes.push(`${o} → ${norm(kind, o)}`); }
      if (p.locality && !LISTS.locality.includes(l.locality)) { changes.push(`Locality "${clean(p.locality, 30)}" is a place, not Urban/Rural — please choose`); l.locality = ''; }
      if (p.email && clean(p.email) !== String(p.email).trim()) changes.push('email cleaned');
      const dup = await findSame(l);
      out.push({ l, changes, dup, issues: issues(l, c), sheets: p.sheets || [], course: p.course || p.code || '' });
    }
    if (String(req.query.commit) !== '1') {
      return res.json({ preview: out.map((x) => ({ name: x.l.name, programme: (list.find((p) => p.key === x.l.programme) || {}).label || x.course || '—', deb_id: x.l.deb_id, abc_id: x.l.abc_id ? '…' + x.l.abc_id.slice(-4) : '', changes: x.changes, issues: x.issues, exists: !!x.dup, sheets: x.sheets })) });
    }
    let added = 0, updated = 0;
    for (const x of out) {
      if (x.dup) { const r = await db.get('SELECT * FROM deb_learners WHERE id = $1', [x.dup]); const old = readRow(r); const merged = { ...old }; for (const [k, v] of Object.entries(x.l)) if (v && !old[k]) merged[k] = v; await store(merged, { id: r.id, prevStatus: r.status }); updated++; }
      else { await store(x.l, { source: 'import' }); added++; }
    }
    audit(req, 'deb_import', `${added} added, ${updated} updated from Excel`, 'medium');
    res.json({ ok: true, added, updated });
  });

  // --- bring admitted students of this OL college into the DEB list (prefilled from their admission form) ---
  app.post('/api/deb/from-admissions', ...guard, requireXhr, async (req, res) => {
    await ensure();
    const have = new Set((await db.all('SELECT enquiry_id FROM deb_learners WHERE enquiry_id IS NOT NULL')).map((x) => x.enquiry_id));
    const apps = await db.all("SELECT * FROM applications WHERE submitted_at IS NOT NULL AND status <> 'Cancelled' ORDER BY id");
    let added = 0;
    for (const a of apps) {
      if (have.has(a.enquiry_id)) continue;
      const e = await db.getEnquiry(a.enquiry_id); if (!e || !(e.status === 'Admitted' || a.status === 'Paid' || Number(a.paid_amount) > 0)) continue;
      const d = JSON.parse(sec.decrypt(a.data) || '{}');
      const gov = d.aadhaar ? ['Aadhaar', d.aadhaar] : d.passport_no ? ['Passport', d.passport_no] : ['', ''];
      const l = fromInput({ name: [d.first_name, d.last_name].filter(Boolean).join(' ') || e.student_name, gender: d.gender, dob: d.dob, email: d.email || e.email, category: d.category, nationality: d.nationality || 'Indian',
        country: d.c_country || 'India', gov_id_type: gov[0], gov_id_no: gov[1], admission_date: ddmmyyyy(new Date(a.submitted_at)), programme: progKey(e.level, e.programme, e.branch) });
      await store(l, { source: 'admission', enquiry_id: e.id }); have.add(e.id); added++;
    }
    audit(req, 'deb_from_admissions', `${added} admitted students added to the DEB list`, 'info');
    res.json({ ok: true, added });
  });

  // --- verify DEB-IDs (GetStudentDetails) ---
  app.post('/api/deb/verify', ...guard, requireXhr, async (req, res) => {
    await ensure(); const c = await conf(); const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 50);
    if (!c.student || !c.student.clientId) return res.status(400).json({ error: 'Save the DEB "Student details" ClientID and APIKey first (DEB connection).' });
    const results = [];
    for (const id of ids) {
      const r = await db.get('SELECT * FROM deb_learners WHERE id = $1', [id]); if (!r) continue; const l = readRow(r);
      if (!/^\d{12}$/.test(l.deb_id || '')) { results.push({ id, ok: false, message: 'DEB-ID must be 12 digits' }); continue; }
      const v = await verifyOne(l, c);
      await db.run('UPDATE deb_learners SET verified = $1 WHERE id = $2', [JSON.stringify(v), id]);
      results.push({ id, ...v }); await new Promise((ok) => setTimeout(ok, 250));
    }
    audit(req, 'deb_verify', `${results.filter((x) => x.ok).length}/${results.length} DEB-IDs found on DEB`, 'info');
    res.json({ results });
  });

  // --- push admissions to DEB (GetAdmissionDetails) ---
  app.post('/api/deb/push', ...guard, requireXhr, async (req, res) => {
    await ensure(); const c = await conf(); const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 100);
    if (!c.heiCode) return res.status(400).json({ error: 'Save your DEB HEI / AISHE code first (DEB connection).' });
    if (!c.admission || !c.admission.clientId) return res.status(400).json({ error: 'Save the DEB "Admission" ClientID and APIKey first (DEB connection).' });
    if (!req.body.confirm) return res.status(400).json({ error: 'Please confirm the push.' });
    const results = [];
    for (const id of ids) {
      const r = await db.get('SELECT * FROM deb_learners WHERE id = $1', [id]); if (!r) continue; const l = readRow(r);
      if (r.status === 'Pushed' && !req.body.force) { results.push({ id, name: l.name, ok: false, skipped: true, message: 'Already sent to DEB' }); continue; }
      const probs = issues(l, c); if (probs.length) { results.push({ id, name: l.name, ok: false, skipped: true, message: probs.join('; ') }); continue; }
      const map = c.programmes[l.programme];
      const out = await callDeb('GetAdmissionDetails', { DEBuniqueID: l.deb_id, UniversityName: c.heiCode, CourseName: map.code, AdmissionDate: l.admission_date, AdmissionDetails: l.admission_details || 'NA', EnrollmentNumber: l.enrollment_no,
        ModeEducation: map.mode || LISTS.mode[0], Category: l.category, GovernmentIdentifier: l.gov_id_type, Locality: l.locality, Nationality: l.nationality, GovernmentIdentifierNumber: l.gov_id_no, CountryResidence: l.country }, c.admission, c);
      const now = new Date().toISOString();
      await db.run('UPDATE deb_learners SET status = $1, last_msg = $2, pushed_at = $3, pushed_by = $4, updated_at = $3 WHERE id = $5', [out.ok ? 'Pushed' : 'Failed', out.message, now, req.user.name, id]);
      results.push({ id, name: l.name, ok: out.ok, message: out.message });
      await new Promise((ok) => setTimeout(ok, 300));
    }
    const sent = results.filter((x) => x.ok).length, failed = results.filter((x) => !x.ok && !x.skipped).length;
    audit(req, 'deb_push', `${sent} sent to UGC-DEB, ${failed} failed, ${results.length - sent - failed} skipped`, failed ? 'medium' : 'info');
    res.json({ sent, failed, skipped: results.length - sent - failed, results });
  });

  // --- export in the DEB sheet layout (backup / manual upload) ---
  app.get('/api/deb/export.xlsx', ...guard, async (req, res) => {
    await ensure(); const c = await conf(), list = programmes();
    const wb = new C.ExcelJS.Workbook(), ws = wb.addWorksheet('DEB Admission Data');
    ws.columns = [['Sr. No', 7], ['Student Name', 26], ['Program Code', 14], ['ABC ID', 15], ['DEB ID', 15], ['Gender', 9], ['DOB', 12], ['University (HEI) Code', 16], ['Course Name', 26], ['Mode of Education', 24],
      ['Admission Date', 14], ['EnrollmentNumber', 20], ['Locality', 10], ['Category', 10], ['Nationality', 11], ['Government Identifier', 18], ['Government IdentifierNumber', 22], ['email', 28], ['Country Residence', 14], ['DEB status', 12], ['DEB message', 40], ['Sent on', 18]]
      .map(([header, width]) => ({ header, width }));
    const rows = (await db.all('SELECT * FROM deb_learners ORDER BY id')).map(readRow);
    const full = String(req.query.full) === '1';
    rows.forEach((l, i) => { const m = (c.programmes || {})[l.programme] || {};
      ws.addRow([i + 1, l.name, m.code || '', l.abc_id, l.deb_id, l.gender, l.dob, c.heiCode || '', ((list.find((p) => p.key === l.programme) || {}).label) || '', m.mode || '', l.admission_date, l.enrollment_no, l.locality, l.category, l.nationality, l.gov_id_type,
        full ? l.gov_id_no : maskId(l.gov_id_no), l.email, l.country, l.status, l.last_msg || '', l.pushed_at ? new Date(l.pushed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''].map((v) => (v == null ? '' : String(v)))); });
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    [4, 5, 17].forEach((n) => { ws.getColumn(n).numFmt = '@'; }); // IDs stay text → leading zeros are kept
    audit(req, 'deb_export', `${rows.length} learners${full ? ' (full ID numbers)' : ''}`, full ? 'high' : 'medium');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DEB_Admission_Data_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });
};
module.exports.LISTS = LISTS;
