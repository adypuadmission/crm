// Multi-college support. Every request runs inside a "tenant" context (AsyncLocalStorage):
//  • no context  → the original ADYPU portal (default database, same links as before)
//  • /c/<slug>/… → that college's portal, with its OWN PostgreSQL database, settings, users, branding and programmes
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

const DEFAULT = {
  slug: '', isDefault: true, name: 'Ajeenkya DY Patil University', short: 'ADYPU', city: 'Pune',
  address: 'D Y Patil Knowledge City, Charholi Bk., Via Lohegaon, Pune - 411081', email: 'info@adypu.edu.in', website: 'https://adypu.edu.in',
};
const cur = () => als.getStore() || DEFAULT;
const isDefault = () => !als.getStore();
const base = () => (als.getStore() ? `/c/${als.getStore().slug}` : '');
const cookieName = () => (als.getStore() ? `adm_${als.getStore().slug.replace(/-/g, '_')}` : 'adm');

// Replace the original university's name in any text with the current college's
function brand(text) {
  const t = cur();
  if (t.isDefault || text == null) return text;
  return String(text)
    .replace(/D Y Patil Knowledge City, Charholi Bk\., (Via )?Lohegaon, Pune\s*[-–]\s*411081/g, t.address || t.city || '')
    .replace(/Ajeenkya DY Patil University, Pune/g, `${t.name}${t.city ? ', ' + t.city : ''}`)
    .replace(/Ajeenkya DY Patil University/g, t.name)
    .replace(/Ajeenkya D\.?Y\.? Patil University/g, t.name)
    .replace(/ADYPU/g, t.short)
    .replace(/info@adypu\.edu\.in/g, t.email || '')
    .replace(/D Y Patil Knowledge City · Pune/g, t.city || '');
}

module.exports = { als, cur, isDefault, base, cookieName, brand, DEFAULT };
