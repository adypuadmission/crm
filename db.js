// Storage layer: PostgreSQL when DATABASE_URL is set (recommended for cloud hosting),
// otherwise a local SQLite file at ./data/enquiries.db. Every query is parameterised.
const path = require('path');
const fs = require('fs');

const usePg = !!process.env.DATABASE_URL;
let pool, sqlite;

const COLS = 'id, ref_no, student_name, mobile, email, city, region, level, programme, branch, programme_group, course, status, notes, mobile_verified, sms_status, source, created_by_id, created_by_name, counsellor_id, counsellor_name, created_at, updated_at';
const NEW_COLS = [['city', 'TEXT'], ['region', 'TEXT'], ['mobile_verified', 'INTEGER DEFAULT 0'], ['sms_status', 'TEXT'], ['level', 'TEXT'], ['programme', 'TEXT'], ['branch', 'TEXT'],
  ['created_by_id', 'INTEGER'], ['created_by_name', 'TEXT'], ['counsellor_id', 'INTEGER'], ['counsellor_name', 'TEXT']];
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
  }
  await migrateProgrammes();
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

const q = (sql) => (usePg ? sql : sql.replace(/\$\d+/g, '?'));
async function all(sql, params = []) { return usePg ? (await pool.query(sql, params)).rows : sqlite.prepare(q(sql)).all(...params); }
async function get(sql, params = []) { return (await all(sql, params))[0]; }
async function run(sql, params = []) { return usePg ? pool.query(sql, params) : sqlite.prepare(q(sql)).run(...params); }

const norm = (r) => r && ({ ...r, mobile_verified: !!Number(r.mobile_verified), created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString() });

async function insertEnquiry(e) {
  const now = e.created_at || new Date().toISOString();
  const cols = ['student_name', 'mobile', 'email', 'city', 'region', 'programme_group', 'course', 'mobile_verified', 'level', 'programme', 'branch',
    'status', 'notes', 'source', 'created_by_id', 'created_by_name', 'counsellor_id', 'counsellor_name', 'created_at', 'updated_at'];
  const vals = [e.student_name, e.mobile, e.email || null, e.city, e.region, e.programme, e.course, e.mobile_verified ? 1 : 0, e.level, e.programme, e.branch || '',
    e.status || 'New', e.notes || '', e.source || 'web', e.created_by_id || null, e.created_by_name || null, e.counsellor_id || null, e.counsellor_name || null, now, now];
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
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE mobile = $1 AND course = $2 ORDER BY id DESC LIMIT 1`, [mobile, course]));
}

async function findRecentDuplicate(mobile, course) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE mobile = $1 AND course = $2 AND created_at >= $3 ORDER BY id DESC LIMIT 1`, [mobile, course, since]));
}

const SORTS = { pushed: 'LOWER(COALESCE(created_by_name,\'\'))', counsellor: 'LOWER(COALESCE(counsellor_name,\'zzz\'))', date: 'created_at', name: 'LOWER(student_name)', programme: 'programme', branch: 'LOWER(COALESCE(branch,\'\'))', level: 'level', region: 'LOWER(COALESCE(region,\'\'))', city: 'LOWER(COALESCE(city,\'\'))', course: 'course', status: 'status' };
function buildFilter(f = {}) {
  const where = [], params = [];
  const add = (clause, val) => { params.push(val); where.push(clause.replace('?', `$${params.length}`)); };
  if (f.q) {
    const like = `%${String(f.q).toLowerCase()}%`;
    params.push(like, like, like, like, like);
    const n = params.length;
    where.push(`(LOWER(student_name) LIKE $${n - 4} OR mobile LIKE $${n - 3} OR LOWER(COALESCE(email,'')) LIKE $${n - 2} OR LOWER(COALESCE(ref_no,'')) LIKE $${n - 1} OR LOWER(COALESCE(city,'')) LIKE $${n})`);
  }
  if (f.level) add('level = ?', f.level);
  if (f.programme) add('programme = ?', f.programme);
  if (f.branch) add('branch = ?', f.branch);
  if (f.status) add('status = ?', f.status);
  if (f.region) add('region = ?', f.region);
  if (f.pushedBy === 'web') where.push('created_by_id IS NULL');
  else if (f.pushedBy) add('created_by_id = ?', parseInt(f.pushedBy, 10));
  if (f.counsellor === 'none') where.push('counsellor_id IS NULL');
  else if (f.counsellor) add('counsellor_id = ?', parseInt(f.counsellor, 10));
  if (f.scopeUser) { params.push(f.scopeUser, f.scopeUser); where.push(`(created_by_id = $${params.length - 1} OR counsellor_id = $${params.length})`); }
  if (f.verified === 'yes') where.push('mobile_verified = 1');
  if (f.verified === 'no') where.push('(mobile_verified = 0 OR mobile_verified IS NULL)');
  if (f.from) add('created_at >= ?', new Date(f.from + 'T00:00:00+05:30').toISOString());
  if (f.to) add('created_at <= ?', new Date(f.to + 'T23:59:59+05:30').toISOString());
  const col = SORTS[f.sort] || 'created_at';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  return { sql: (where.length ? 'WHERE ' + where.join(' AND ') : '') + ` ORDER BY ${col} ${dir}, id ${dir}`, params };
}

async function listEnquiries(f) {
  const { sql, params } = buildFilter(f);
  return (await all(`SELECT ${COLS} FROM enquiries ${sql}`, params)).map(norm);
}

async function updateEnquiry(id, { status, notes, sms_status, counsellor_id, counsellor_name }) {
  const now = new Date().toISOString();
  if (counsellor_id !== undefined) await run('UPDATE enquiries SET counsellor_id = $1, counsellor_name = $2, updated_at = $3 WHERE id = $4', [counsellor_id, counsellor_name || null, now, id]);
  if (status !== undefined) await run('UPDATE enquiries SET status = $1, updated_at = $2 WHERE id = $3', [status, now, id]);
  if (notes !== undefined) await run('UPDATE enquiries SET notes = $1, updated_at = $2 WHERE id = $3', [notes, now, id]);
  if (sms_status !== undefined) await run('UPDATE enquiries SET sms_status = $1 WHERE id = $2', [sms_status, id]);
  return norm(await get(`SELECT ${COLS} FROM enquiries WHERE id = $1`, [id]));
}
async function deleteEnquiry(id) { await run('DELETE FROM enquiries WHERE id = $1', [id]); }

// ---------- OTP storage ----------
async function getOtp(mobile) { return get('SELECT * FROM otps WHERE mobile = $1', [mobile]); }
async function saveOtp(o) {
  if (usePg) {
    await pool.query(`INSERT INTO otps (mobile, code_hash, expires_at, attempts, sends, window_start, last_sent) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (mobile) DO UPDATE SET code_hash=$2, expires_at=$3, attempts=$4, sends=$5, window_start=$6, last_sent=$7`,
    [o.mobile, o.code_hash, o.expires_at, o.attempts, o.sends, o.window_start, o.last_sent]);
  } else {
    sqlite.prepare(`INSERT OR REPLACE INTO otps (mobile, code_hash, expires_at, attempts, sends, window_start, last_sent) VALUES (?,?,?,?,?,?,?)`)
      .run(o.mobile, o.code_hash, o.expires_at, o.attempts, o.sends, o.window_start, o.last_sent);
  }
}
async function bumpOtpAttempts(mobile) { await run('UPDATE otps SET attempts = attempts + 1 WHERE mobile = $1', [mobile]); }
async function clearOtp(mobile) { await run("UPDATE otps SET code_hash = '', expires_at = 0 WHERE mobile = $1", [mobile]); }

// ---------- team (sub-admin) users ----------
const normU = (u) => u && ({ id: u.id, name: u.name, username: u.username, mobile: u.mobile, role: u.role, active: !!Number(u.active),
  created_at: u.created_at && new Date(u.created_at).toISOString(), last_login: u.last_login ? new Date(u.last_login).toISOString() : null });
async function createUser({ name, username, mobile, pass_hash }) {
  const now = new Date().toISOString();
  if (usePg) return normU((await pool.query('INSERT INTO users (name, username, mobile, pass_hash, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, username, mobile, pass_hash, now])).rows[0]);
  const id = sqlite.prepare('INSERT INTO users (name, username, mobile, pass_hash, created_at) VALUES (?,?,?,?,?)').run(name, username, mobile, pass_hash, now).lastInsertRowid;
  return getUser(id);
}
async function getUser(id) { return normU(await get('SELECT * FROM users WHERE id = $1', [id])); }
async function getUserAuth(username) { return get('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]); }
async function listUsers() { return (await all('SELECT * FROM users ORDER BY active DESC, name ASC')).map(normU); }
async function updateUser(id, { name, mobile, active, pass_hash }) {
  if (name !== undefined) await run('UPDATE users SET name = $1 WHERE id = $2', [name, id]);
  if (mobile !== undefined) await run('UPDATE users SET mobile = $1 WHERE id = $2', [mobile, id]);
  if (active !== undefined) await run('UPDATE users SET active = $1 WHERE id = $2', [active ? 1 : 0, id]);
  if (pass_hash !== undefined) await run('UPDATE users SET pass_hash = $1 WHERE id = $2', [pass_hash, id]);
  if (name !== undefined) { await run('UPDATE enquiries SET created_by_name = $1 WHERE created_by_id = $2', [name, id]); await run('UPDATE enquiries SET counsellor_name = $1 WHERE counsellor_id = $2', [name, id]); }
  return getUser(id);
}
async function touchLogin(id) { await run('UPDATE users SET last_login = $1 WHERE id = $2', [new Date().toISOString(), id]); }

module.exports = { getEnquiry, findExisting, createUser, getUser, getUserAuth, listUsers, updateUser, touchLogin, init, insertEnquiry, findRecentDuplicate, listEnquiries, updateEnquiry, deleteEnquiry, getOtp, saveOtp, bumpOtpAttempts, clearOtp, usePg };
