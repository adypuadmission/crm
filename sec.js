// Field-level encryption for personal data (AES-256-GCM) + blind index for look-ups.
//
// DATA_KEY must stay the same forever: if it is lost or changed, encrypted data cannot be read.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const raw = process.env.DATA_KEY || process.env.SESSION_SECRET || '';
if (!process.env.DATA_KEY) {
  console.warn(raw
    ? '⚠  DATA_KEY not set — deriving the encryption key from SESSION_SECRET. Set a dedicated DATA_KEY and never change it.'
    : '⚠  DATA_KEY and SESSION_SECRET not set — using an INSECURE development key. Never run like this in production.');
}
const master = crypto.scryptSync(raw || 'dev-only-insecure-key', 'adypu-crm-v1', 64);
const ENC_KEY = master.subarray(0, 32);   // encryption
const IDX_KEY = master.subarray(32, 64);  // blind index (search / duplicate check without decrypting)

function encrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  const s = String(value);
  if (s.startsWith(PREFIX)) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const b = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '[unreadable — wrong DATA_KEY]';
  }
}
const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);
const blind = (value) => crypto.createHmac('sha256', IDX_KEY).update(String(value || '').trim().toLowerCase()).digest('hex');

// Display masks for anyone who is not the main admin
const maskMobile = (m) => { const s = String(m || ''); return s.length >= 4 ? `${s.slice(0, 2)}XXXXXX${s.slice(-2)}` : 'XXXXXXXXXX'; };
const maskEmail = (e) => { const s = String(e || ''); if (!s.includes('@')) return s ? '•••••' : ''; const [u, d] = s.split('@'); return `${u.slice(0, 1)}•••@${d}`; };

module.exports = { encrypt, decrypt, isEncrypted, blind, maskMobile, maskEmail };
