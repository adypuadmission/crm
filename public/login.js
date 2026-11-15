document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = document.getElementById('err'), btn = f.querySelector('button');
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value }),
    });
    const j = await r.json();
    if (r.ok) location.href = j.redirect || '/admin'; else err.textContent = j.error || 'Login failed';
  } catch { err.textContent = 'Network error'; }
  btn.disabled = false; btn.textContent = 'Sign in';
});
