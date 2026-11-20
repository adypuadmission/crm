// Security tab → API keys (main admin only)
(() => {
  const $ = (s) => document.querySelector(s); if (!$('#apiCard')) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const toast = (m) => { const t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(t._k); t._k = setTimeout(() => t.classList.remove('show'), 2600); };
  async function load() {
    const r = await fetch('/api/admin/api-keys', { headers: H }); if (!r.ok) return; const j = await r.json();
    $('#apiEndpoint').textContent = j.endpoint;
    $('#apiRows').innerHTML = j.keys.length ? j.keys.slice().reverse().map((k) => `<tr class="${k.revokedAt ? 'api-off' : ''}"><td><b>${esc(k.name)}</b></td><td><code>ak_…${esc(k.prefix)}…</code></td><td>${k.scopes.map((s) => (s === 'push' ? '➕ add students' : '👁 read status')).join('<br>')}</td>
      <td>${k.ips.length ? esc(k.ips.join(', ')) : 'any'}</td><td>${when(k.createdAt)}<br><small>${esc(k.createdBy || '')}</small></td><td>${when(k.lastUsed)}<br><small>${k.uses} calls</small></td><td><b>${k.pushed}</b></td>
      <td>${k.revokedAt ? `<small>Revoked ${when(k.revokedAt)}</small>` : `<button class="btn ghost xs" data-revoke="${esc(k.id)}" data-name="${esc(k.name)}" type="button">⛔ Revoke</button>`}</td></tr>`).join('')
      : '<tr><td colspan="8" class="muted">No API keys yet. Create one only when another portal needs to send students here.</td></tr>';
  }
  $('#apiNew').addEventListener('click', () => { $('#apiForm').hidden = false; $('#apiOnce').hidden = true; $('#apiName').focus(); });
  $('#apiCancel').addEventListener('click', () => { $('#apiForm').hidden = true; $('#apiForm').reset(); });
  $('#apiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/admin/api-keys', { method: 'POST', headers: H, body: JSON.stringify({ name: $('#apiName').value, ips: $('#apiIps').value, read: $('#apiRead').checked, password: $('#apiPass').value }) });
    const j = await r.json().catch(() => ({})); $('#apiPass').value = '';
    if (!r.ok) return toast(j.error || 'Could not create the key');
    $('#apiForm').hidden = true; $('#apiForm').reset();
    const box = $('#apiOnce'); box.hidden = false;
    box.innerHTML = `<b>🔑 Your new key — copy it now, it will never be shown again</b><div class="api-key-row"><code id="apiKeyVal">${esc(j.key)}</code><button class="btn primary xs" id="apiCopy" type="button">📋 Copy</button></div><small>Give it only to the technical person of the other portal. Keep it on their server, never inside a web page or mobile app. If it leaks, click ⛔ Revoke.</small>`;
    $('#apiCopy').addEventListener('click', () => navigator.clipboard.writeText(j.key).then(() => toast('📋 Key copied')));
    load();
  });
  $('#apiRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revoke]'); if (!b) return;
    if (!confirm(`Revoke the key "${b.dataset.name}"? The other portal will stop sending students at once.`)) return;
    const r = await fetch(`/api/admin/api-keys/${b.dataset.revoke}/revoke`, { method: 'POST', headers: H }); toast(r.ok ? '⛔ Key revoked' : 'Could not revoke'); load();
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-tab="security"]')) load(); });
  load();
})();
