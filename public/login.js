const f = document.getElementById('loginForm'), err = document.getElementById('err'), btn = f.querySelector('button[type=submit]');
const otpStep = document.getElementById('otpStep');
let challenge = null;
if (/idle=1/.test(location.search)) err.textContent = 'You were signed out after a period of inactivity.';
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json()) }));
function reset() { challenge = null; otpStep.hidden = true; f.username.disabled = f.password.disabled = false; f.otp.value = ''; btn.textContent = 'Sign in'; }
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = ''; btn.disabled = true;
  try {
    if (!challenge) {
      btn.textContent = 'Signing in…';
      const j = await post('/api/admin/login', { username: f.username.value.trim(), password: f.password.value });
      if (j.ok && j.otp) {
        challenge = j.challenge; otpStep.hidden = false; f.username.disabled = f.password.disabled = true;
        document.getElementById('otpMsg').textContent = `A 6-digit login code was sent to +91 ${j.sentTo}.` + (j.demoOtp ? ` (Demo mode code: ${j.demoOtp})` : '');
        btn.textContent = 'Verify & sign in'; f.otp.focus();
      } else if (j.ok) { location.href = j.redirect || '/admin'; return; }
      else { err.textContent = j.error || 'Login failed'; btn.textContent = 'Sign in'; }
    } else {
      btn.textContent = 'Verifying…';
      const j = await post('/api/admin/login/verify', { challenge, otp: f.otp.value });
      if (j.ok) { location.href = j.redirect || '/admin'; return; }
      err.textContent = j.error || 'Incorrect code';
      if (j.restart) reset(); else btn.textContent = 'Verify & sign in';
    }
  } catch { err.textContent = 'Network error'; }
  btn.disabled = false;
});
