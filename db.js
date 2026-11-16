// Storage layer: PostgreSQL when DATABASE_URL is set (recommended for cloud hosting),
// otherwise a local SQLite file at ./data/enquiries.db. Every query is parameterised.
const path = require('path');
const fs = require('fs');
const sec = require('./sec');

const usePg = !!process.env.DATABASE_URL;
let pool, sqlite;

const COLS = 'id, ref_no, student_name, mobile, email, city, region, level, programme, branch, programme_group, course, status, notes, mobile_verified, sms_status, source, created_by_id, created_by_name, counsellor_id, counsellor_name, created_at, updated_at, next_action_date, last_call_at, last_call_outcome, call_count, caller_id, caller_name, caller_assigned_at';
const NEW_COLS = [['city', 'TEXT'], ['region', 'TEXT'], ['mobile_verified', 'INTEGER DEFAULT 0'], ['sms_status', 'TEXT'], ['level', 'TEXT'], ['programme', 'TEXT'], ['branch', 'TEXT'],
  ['created_by_id', 'INTEGER'], ['created_by_name', 'TEXT'], ['counsellor_id', 'INTEGER'], ['counsellor_name', 'TEXT'], ['mobile_hash', 'TEXT'],
  ['next_action_date', 'TEXT'], ['last_call_at', 'TEXT'], ['last_call_outcome', 'TEXT'], ['call_count', 'INTEGER DEFAULT 0'],
  // calling assignment is separate from the data-entry counsellor
  ['caller_id', 'INTEGER'], ['caller_name', 'TEXT'], ['caller_assigned_at', 'TEXT']];
// Call log: every call / WhatsApp a counsellor makes, with outcome + feedback (feedback is encrypted)
const CALLS_PG = `CREATE TABLE IF NOT EXISTS calls (id SERIAL PRIMARY KEY, enquiry_id INTEGER NOT NULL, user_id INTEGER, user_name TEXT, at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel TEXT, outcome TEXT, feedback TEXT, status_after TEXT, next_action_date TEXT)`;
const CALLS_SQLITE = `CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, enquiry_id INTEGER NOT NULL, user_id INTEGER, user_name TEXT, at TEXT NOT NULL,
  channel TEXT, outcome TEXT, feedback TEXT, status_after TEXT, next_action_date TEXT)`;
const AUDIT_PG = `CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), actor TEXT, role TEXT, user_id INTEGER,
  ip TEXT, ua TEXT, action TEXT NOT NULL, details TEXT, severity TEXT NOT NULL DEFAULT 'info', seen INTEGER NOT NULL DEFAULT 0)`;
const AUDIT_SQLITE = `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, role TEXT, user_id INTEGER,
  ip TEXT, ua TEXT, action TEXT NOT NULL, details TEXT, severity TEXT NOT NULL DEFAULT 'info', seen INTEGER NOT NULL DEFAULT 0)`;
const USERS_PG = `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, mobile TEXT,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'subadmin', active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login TIMESTAMPTZ)`;
const USERS_SQLITE = `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, mobile TEXT,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'subadmin', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login TEXT)`;

async function init() {
  if (usePg) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS enquiries (
      id SERIAL PRIMARY KEY, ref_no TEXT UNIQUE, student_name TEXT NOT NULL, mobile TEXT NOT NULL, email TEXT,
      programme_group TEXT NOT NULL, course TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', notes TEXT DEFAULT '',
      source TEXT DEFAULT 'web', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    for (const [c, t] of NEW_COLS) await pool.query(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS ${c} ${t}`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_enq_created ON enquiries(created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_enq_mobile ON enquiries(mobile)');
    await pool.query(`CREATE TABLE IF NOT EXISTS otps (mobile TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, window_start BIGINT NOT NULL, last_sent BIGINT NOT NULL)`);
    await pool.query(USERS_PG);
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'counsellor'");
    await pool.query(AUDIT_PG);
    await pool.query('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_enq_mhash ON enquiries(mobile_hash)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)');
    await pool.query(CALLS_PG);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_calls_enq ON calls(enquiry_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_enq_next ON enquiries(next_action_date)');
  } else {
    let Database;
    try { Database = require('better-sqlite3'); } catch {
      throw new Error('No DATABASE_URL set and the optional SQLite driver is not installed. Set DATABASE_URL (PostgreSQL) or run "npm install better-sqlite3".');
    }
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    sqlite = new Database(path.join(dir, 'enquiries.db'));
    sqlite.pragma('journal_mode = WAL');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS enquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ref_no TEXT UNIQUE, student_name TEXT NOT NULL, mobile TEXT NOT NULL, email TEXT,
      programme_group TEXT NOT NULL, course TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', notes TEXT DEFAULT '',
      source TEXT DEFAULT 'web', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_enq_created ON enquiries(created_at);
    CREATE INDEX IF NOT EXISTS idx_enq_mobile ON enquiries(mobile);
    CREATE TABLE IF NOT EXISTS otps (mobile TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL, last_sent INTEGER NOT NULL);`);
    const have = sqlite.prepare('PRAGMA table_info(enquiries)').all().map((c) => c.name);
    for (const [c, t] of NEW_COLS) if (!have.includes(c)) sqlite.exec(`ALTER TABLE enquiries ADD COLUMN ${c} ${t}`);
    sqlite.exec(USERS_SQLITE);
    if (!sqlite.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'kind')) sqlite.exec("ALTER TABLE users ADD COLUMN kind TEXT DEFAULT 'counsellor'");
    sqlite.exec(AUDIT_SQLITE);
    sqlite.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_enq_mhash ON enquiries(mobile_hash); CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);');
    sqlite.exec(CALLS_SQLITE + '; CREATE INDEX IF NOT EXISTS idx_calls_enq ON calls(enquiry_id); CREATE INDEX IF NOT EXISTS idx_enq_next ON enquiries(next_action_date);');
  }
  await migrateProgrammes();
  await migrateEncryption();
  console.log(`Storage: ${usePg ? 'PostgreSQL' : 'SQLite (local file)'}`);
}

// Older entries stored only programme_group ('B.Tech' / 'Others') + course. Fill level/programme/branch.
async function migrateProgrammes() {
  const old = await all('SELECT id, programme_group, course FROM enquiries WHERE programme IS NULL');
  for (const r of old) {
    let level = 'UG', programme = r.course, branch = '';
    if (r.programme_group === 'B.Tech') { programme = 'B.Tech'; branch = r.course; }
    else if (['MBA', 'MCA'].includes(r.course)) level = 'PG';
    const course = branch ? `${programme} – ${branch}` : programme;
    await run('UPDATE enquiries SET level = $1, programme = $2, branch = $3, course = $4 WHERE id = $5', [level, programme, branch, course, r.id]);
  }
  if (old.length) console.log(`Migrated ${old.length} older enquiries to UG/PG → programme → branch`);
}

// Encrypt any personal data still stored in plain text (older versions) and add the blind index.
async function migrateEncryption() {
  const rows = await all(`SELECT id, student_name, mobile, email, notes FROM enquiries WHERE mobile_hash IS NULL OR mobile NOT LIKE 'enc:v1:%'`);
  for (const r of rows) {
    const mobile = sec.decrypt(r.mobile);
    await run('UPDATE enquiries SET student_name = $1, mobile = $2, email = $3, notes = $4, mobile_hash = $5 WHERE id = $6',
      [sec.encrypt(sec.decrypt(r.student_name)), sec.encrypt(mobile), sec.encrypt(sec.decrypt(r.email)), sec.encrypt(sec.decrypt(r.notes)), sec.blind(mobile), r.id]);
  }
  const users = await all(`SELECT id, mobile FROM users WHERE mobile IS NOT NULL AND mobile <> '' AND mobile NOT LIKE 'enc:v1:%'`);
  for (const u of users) await run('UPDATE users SET mobile = $1 WHERE id = $2', [sec.encrypt(u.mobile), u.id]);
  if (rows.length || users.length) console.log(`🔐 Encrypted personal data in ${rows.length} enquiries and ${users.length} user records`);
}

const q = (sql) => (usePg ? sql : sql.replace(/\$\d+/g, '?'));
async function all(sql, params = []) { return usePg ? (await pool.query(sql, params)).rows : sqlite.prepare(q(sql)).all(...params); }
async function get(sql, params = []) { return (await all(sql, params))[0]; }
async function run(sql, params = []) { return usePg ? pool.query(sql, params) : sqlite.prepare(q(sql)).run(...params); }

const norm = (r) => r && ({ ...r, student_name: sec.decrypt(r.student_name), mobile: sec.decrypt(r.mobile), email: sec.decrypt(r.email), notes: sec.decrypt(r.notes) || '', mobile_verified: !!Number(r.mobile_verified), call_count: Number(r.call_count || 0), created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString() });

async function insertEnquiry(e) {
  const now = e.created_at || new Date().toISOString();
  const cols = ['student_name', 'mobile', 'email', 'city', 'region', 'programme_group', 'course', 'mobile_verified', 'level', 'programme', 'branch',
    'status', 'notes', 'source', 'created_by_id', 'created_by_name', 'counsellor_id', 'counsellor_name', 'created_at', 'updated_at', 'mobile_hash'];
  const vals = [sec.encrypt(e.student_name), sec.encrypt(e.mobile), sec.encrypt(e.email || null), e.city, e.region, e.programme, e.course, e.mobile_verified ? 1 : 0, e.level, e.programme, e.branch || '',
    e.status || 'New', sec.encrypt(e.notes || ''), e.source || 'web', e.created_by_id || null, e.created_by_name || null, e.counsellor_id || null, e.counsellor_name || null, now, now, sec.blind(e.mobile)];
  const ph = cols.map((_, i) => `$${i + 1}`).join(',');
  let id;
  if (usePg) id = (await pool.query(`INSERT INTO enquiries (${cols.join(',')}) VALUES (${ph}) RETURNING id`, vals)).rows[0].id;
  else id = sqlite.prepare(`INSERT INTO enquiries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
  const yr = new Date().getFullYear().toString().slice(-2);
  await run('UPDATE enquiries SET ref_no = $1 WHERE id = $2', [`ADYPU-${yr}-${String(id).padStart(5, '0')}`, id]);
  return getEnquiry(id);
}
async function getEnquiry(id) { return norm(await get(`SELECT ${COLS} FROM enquiries WHERE id = $1`, [id])); }
// Any earlier enquiry for the same mobile + course (used to skip duplicates in team uploads)
async function findExisting(mobile, course) {
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE mobile_hash = $1 AND course = $2 ORDER BY id DESC LIMIT 1`, [sec.blind(mobile), course]));
}

async function findRecentDuplicate(mobile, course) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE mobile_hash = $1 AND course = $2 AND created_at >= $3 ORDER BY id DESC LIMIT 1`, [sec.blind(mobile), course, since]));
}

const SORTS = { caller: 'LOWER(COALESCE(caller_name,\'zzz\'))', next: 'COALESCE(next_action_date,\'9999\')', lastcall: 'COALESCE(last_call_at,\'\')', pushed: 'LOWER(COALESCE(created_by_name,\'\'))', counsellor: 'LOWER(COALESCE(counsellor_name,\'zzz\'))', date: 'created_at', name: 'LOWER(student_name)', programme: 'programme', branch: 'LOWER(COALESCE(branch,\'\'))', level: 'level', region: 'LOWER(COALESCE(region,\'\'))', city: 'LOWER(COALESCE(city,\'\'))', course: 'course', status: 'status' };
function buildFilter(f = {}) {
  const where = [], params = [];
  const add = (clause, val) => { params.push(val); where.push(clause.replace('?', `$${params.length}`)); };
  // Free-text search (name / mobile / email are encrypted) happens after decryption, in listEnquiries.
  if (f.level) add('level = ?', f.level);
  if (f.programme) add('programme = ?', f.programme);
  if (f.branch) add('branch = ?', f.branch);
  if (f.status) add('status = ?', f.status);
  if (f.region) add('region = ?', f.region);
  if (f.pushedBy === 'web') where.push('created_by_id IS NULL');
  else if (f.pushedBy) add('created_by_id = ?', parseInt(f.pushedBy, 10));
  if (f.counsellor === 'none') where.push('counsellor_id IS NULL');
  else if (f.counsellor) add('counsellor_id = ?', parseInt(f.counsellor, 10));
  if (f.caller === 'none') where.push('caller_id IS NULL');
  else if (f.caller) add('caller_id = ?', parseInt(f.caller, 10));
  if (f.scopeCaller) add('caller_id = ?', f.scopeCaller);
  if (f.scopeUser) { params.push(f.scopeUser, f.scopeUser); where.push(`(created_by_id = $${params.length - 1} OR counsellor_id = $${params.length})`); }
  if (f.verified === 'yes') where.push('mobile_verified = 1');
  // follow-ups (dates are IST calendar days 'YYYY-MM-DD')
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (f.follow === 'today') add('next_action_date = ?', today);
  if (f.follow === 'overdue') add("next_action_date < ? AND status NOT IN ('Admitted','Not Interested')", today);
  if (f.follow === 'upcoming') add('next_action_date > ?', today);
  if (f.follow === 'untouched') where.push("COALESCE(call_count,0) = 0 AND status = 'New'");
  if (f.follow === 'called') where.push('COALESCE(call_count,0) > 0');
  if (f.ids && f.ids.length) { const ph = f.ids.map((id) => { params.push(id); return `$${params.length}`; }); where.push(`id IN (${ph.join(',')})`); }
  if (f.verified === 'no') where.push('(mobile_verified = 0 OR mobile_verified IS NULL)');
  if (f.from) add('created_at >= ?', new Date(f.from + 'T00:00:00+05:30').toISOString());
  if (f.to) add('created_at <= ?', new Date(f.to + 'T23:59:59+05:30').toISOString());
  const col = SORTS[f.sort] || 'created_at';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  return { sql: (where.length ? 'WHERE ' + where.join(' AND ') : '') + ` ORDER BY ${col} ${dir}, id ${dir}`, params };
}

async function listEnquiries(f = {}) {
  const { sql, params } = buildFilter(f);
  let rows = (await all(`SELECT ${COLS} FROM enquiries ${sql}`, params)).map(norm);
  if (f.q) {
    const q = String(f.q).toLowerCase().trim();
    rows = rows.filter((r) => [r.student_name, r.mobile, r.email, r.ref_no, r.city].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  if (f.sort === 'name') {
    const dir = f.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)) * dir);
  }
  return rows;
}

async function updateEnquiry(id, { status, notes, sms_status, counsellor_id, counsellor_name, next_action_date }) {
  const now = new Date().toISOString();
  if (counsellor_id !== undefined) await run('UPDATE enquiries SET counsellor_id = $1, counsellor_name = $2, updated_at = $3 WHERE id = $4', [counsellor_id, counsellor_name || null, now, id]);
  if (next_action_date !== undefined) await run('UPDATE enquiries SET next_action_date = $1, updated_at = $2 WHERE id = $3', [next_action_date || null, now, id]);
  if (status !== undefined) await run('UPDATE enquiries SET status = $1, updated_at = $2 WHERE id = $3', [status, now, id]);
  if (notes !== undefined) await run('UPDATE enquiries SET notes = $1, updated_at = $2 WHERE id = $3', [sec.encrypt(notes), now, id]);
  if (sms_status !== undefined) await run('UPDATE enquiries SET sms_status = $1 WHERE id = $2', [sms_status, id]);
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE id = $1`, [id]));
}
async function deleteEnquiry(id) { await run('DELETE FROM calls WHERE enquiry_id = $1', [id]); await run('DELETE FROM enquiries WHERE id = $1', [id]); }

// ---------- assignment & calls ----------
// Calling assignment (separate from the data-entry counsellor)
async function assignMany(ids, user) {
  const now = new Date().toISOString();
  for (const id of ids) await run('UPDATE enquiries SET caller_id = $1, caller_name = $2, caller_assigned_at = $3, updated_at = $4 WHERE id = $5', [user ? user.id : null, user ? user.name : null, now, now, id]);
  return ids.length;
}
async function logCall(c) {
  const at = new Date().toISOString();
  await run('INSERT INTO calls (enquiry_id, user_id, user_name, at, channel, outcome, feedback, status_after, next_action_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [c.enquiry_id, c.user_id || null, c.user_name || null, at, c.channel || 'call', c.outcome, sec.encrypt(c.feedback || ''), c.status_after || null, c.next_action_date || null]);
  await run('UPDATE enquiries SET last_call_at = $1, last_call_outcome = $2, call_count = COALESCE(call_count,0) + 1, updated_at = $3 WHERE id = $4', [at, c.outcome, at, c.enquiry_id]);
}
async function listCalls(enquiryId) {
  return (await all('SELECT * FROM calls WHERE enquiry_id = $1 ORDER BY id DESC LIMIT 100', [enquiryId]))
    .map((r) => ({ ...r, feedback: sec.decrypt(r.feedback) || '', at: new Date(r.at).toISOString() }));
}
async function latestFeedback(ids) {
  if (!ids.length) return {};
  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  const rows = await all(`SELECT enquiry_id, feedback, at FROM calls WHERE enquiry_id IN (${ph}) ORDER BY id ASC`, ids);
  const m = {}; rows.forEach((r) => { m[r.enquiry_id] = sec.decrypt(r.feedback) || ''; }); return m;
}
async function callStats(sinceIso) {
  return all(`SELECT user_id, user_name, COUNT(*) AS calls, SUM(CASE WHEN outcome = 'Connected' THEN 1 ELSE 0 END) AS connected FROM calls WHERE at >= $1 GROUP BY user_id, user_name ORDER BY calls DESC`, [sinceIso]);
}

// ---------- OTP storage ----------
// OTP rows are keyed by the blind index, so the table never holds a readable mobile number.
async function getOtp(mobile) { return get('SELECT * FROM otps WHERE mobile = $1', [sec.blind(mobile)]); }
async function saveOtp(o) {
  if (usePg) {
    await pool.query(`INSERT INTO otps (mobile, code_hash, expires_at, attempts, sends, window_start, last_sent) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (mobile) DO UPDATE SET code_hash=$2, expires_at=$3, attempts=$4, sends=$5, window_start=$6, last_sent=$7`,
    [sec.blind(o.mobile), o.code_hash, o.expires_at, o.attempts, o.sends, o.window_start, o.last_sent]);
  } else {
    sqlite.prepare(`INSERT OR REPLACE INTO otps (mobile, code_hash, expires_at, attempts, sends, window_start, last_sent) VALUES (?,?,?,?,?,?,?)`)
      .run(sec.blind(o.mobile), o.code_hash, o.expires_at, o.attempts, o.sends, o.window_start, o.last_sent);
  }
}
async function bumpOtpAttempts(mobile) { await run('UPDATE otps SET attempts = attempts + 1 WHERE mobile = $1', [sec.blind(mobile)]); }
async function clearOtp(mobile) { await run("UPDATE otps SET code_hash = '', expires_at = 0 WHERE mobile = $1", [sec.blind(mobile)]); }

// ---------- team (sub-admin) users ----------
const normU = (u) => u && ({ id: u.id, name: u.name, username: u.username, mobile: sec.decrypt(u.mobile) || '', role: u.role, kind: u.kind === 'caller' ? 'caller' : 'counsellor', active: !!Number(u.active),
  created_at: u.created_at && new Date(u.created_at).toISOString(), last_login: u.last_login ? new Date(u.last_login).toISOString() : null });
async function createUser({ name, username, mobile, pass_hash, kind }) {
  const now = new Date().toISOString(), k = kind === 'caller' ? 'caller' : 'counsellor';
  if (usePg) return normU((await pool.query('INSERT INTO users (name, username, mobile, pass_hash, created_at, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [name, username, sec.encrypt(mobile), pass_hash, now, k])).rows[0]);
  const id = sqlite.prepare('INSERT INTO users (name, username, mobile, pass_hash, created_at, kind) VALUES (?,?,?,?,?,?)').run(name, username, sec.encrypt(mobile), pass_hash, now, k).lastInsertRowid;
  return getUser(id);
}
async function getUser(id) { return normU(await get('SELECT * FROM users WHERE id = $1', [id])); }
async function getUserAuth(username) { return get('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]); }
async function listUsers() { return (await all('SELECT * FROM users ORDER BY active DESC, name ASC')).map(normU); }
async function updateUser(id, { name, mobile, active, pass_hash }) {
  if (name !== undefined) await run('UPDATE users SET name = $1 WHERE id = $2', [name, id]);
  if (mobile !== undefined) await run('UPDATE users SET mobile = $1 WHERE id = $2', [sec.encrypt(mobile), id]);
  if (active !== undefined) await run('UPDATE users SET active = $1 WHERE id = $2', [active ? 1 : 0, id]);
  if (pass_hash !== undefined) await run('UPDATE users SET pass_hash = $1 WHERE id = $2', [pass_hash, id]);
  if (name !== undefined) { await run('UPDATE enquiries SET created_by_name = $1 WHERE created_by_id = $2', [name, id]); await run('UPDATE enquiries SET counsellor_name = $1 WHERE counsellor_id = $2', [name, id]); await run('UPDATE enquiries SET caller_name = $1 WHERE caller_id = $2', [name, id]); }
  return getUser(id);
}
async function touchLogin(id) { await run('UPDATE users SET last_login = $1 WHERE id = $2', [new Date().toISOString(), id]); }

// ---------- audit log & settings ----------
async function insertAudit(e) {
  const at = new Date().toISOString();
  const vals = [at, e.actor || null, e.role || null, e.user_id || null, e.ip || null, String(e.ua || '').slice(0, 200), e.action, String(e.details || '').slice(0, 1000), e.severity || 'info'];
  await run('INSERT INTO audit_log (at, actor, role, user_id, ip, ua, action, details, severity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', vals);
}
async function listAudit({ limit = 300, severity, action, actor } = {}) {
  const where = [], params = [];
  if (severity) { params.push(severity); where.push(`severity = $${params.length}`); }
  if (action) { params.push(action); where.push(`action = $${params.length}`); }
  if (actor) { params.push(actor); where.push(`actor = $${params.length}`); }
  params.push(Math.min(1000, limit));
  return (await all(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${params.length}`, params))
    .map((a) => ({ ...a, at: new Date(a.at).toISOString(), seen: !!Number(a.seen) }));
}
async function countUnseenAlerts() { return Number((await get("SELECT COUNT(*) AS n FROM audit_log WHERE seen = 0 AND severity IN ('high','critical')")).n); }
async function markAlertsSeen() { await run('UPDATE audit_log SET seen = 1 WHERE seen = 0'); }
async function getSetting(key, def) { const r = await get('SELECT value FROM settings WHERE key = $1', [key]); return r ? JSON.parse(r.value) : def; }
async function setSetting(key, value) {
  if (usePg) await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, JSON.stringify(value)]);
  else sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, JSON.stringify(value));
}
// Raw rows exactly as stored (used by the Security tab to prove data is encrypted at rest)
async function rawSample(n = 3) { return all(`SELECT ref_no, student_name, mobile, email FROM enquiries ORDER BY id DESC LIMIT ${Math.min(10, n)}`); }

module.exports = { latestFeedback, assignMany, logCall, listCalls, callStats, insertAudit, listAudit, countUnseenAlerts, markAlertsSeen, getSetting, setSetting, rawSample, getEnquiry, findExisting, createUser, getUser, getUserAuth, listUsers, updateUser, touchLogin, init, insertEnquiry, findRecentDuplicate, listEnquiries, updateEnquiry, deleteEnquiry, getOtp, saveOtp, bumpOtpAttempts, clearOtp, usePg };
