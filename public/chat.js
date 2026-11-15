(() => {
  const $ = (s) => document.querySelector(s);
  const fab = $('#chatFab'), box = $('#chat'), body = $('#chatBody'), chips = $('#chatChips'), form = $('#chatForm'), input = $('#chatText');
  const history = [];
  let started = false, busy = false;
  const DEFAULT_CHIPS = ['Programmes', 'How to apply', 'Contact numbers', 'Fees', 'Hostel', 'Campus life', 'Location', 'Request a call back'];

  // Safe mini-markdown: escape everything, then allow **bold**, [label](https://…) and line breaks.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function md(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\n/g, '<br>');
  }
  function add(role, text) {
    const d = document.createElement('div');
    d.className = `msg ${role}`;
    if (role === 'bot') d.innerHTML = md(text); else d.textContent = text;
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }
  function setChips(list) {
    chips.innerHTML = '';
    (list || DEFAULT_CHIPS).forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = c;
      b.addEventListener('click', () => ask(c)); chips.appendChild(b);
    });
  }
  function open() {
    box.hidden = false; fab.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
    if (!started) {
      started = true;
      add('bot', "Hi there! 👋 I'm **Ask ADYPU**, your admission assistant.\nAsk me about programmes, how to apply, contact numbers, campus life and more.");
      setChips();
    }
    setTimeout(() => input.focus(), 150);
  }
  function close() { box.hidden = true; fab.classList.remove('open'); fab.setAttribute('aria-expanded', 'false'); fab.focus(); }
  fab.addEventListener('click', () => (box.hidden ? open() : close()));
  $('#chatClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) close(); });

  async function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    if (/^request a call ?back$/i.test(text)) {
      add('me', text);
      add('bot', "Great! 📞 Fill in the short enquiry form on this page and a counsellor will call you. I've taken you there.");
      setTimeout(() => { close(); window.dispatchEvent(new Event('adypu:callback')); }, 900);
      return;
    }
    busy = true; add('me', text); input.value = '';
    const typing = add('bot', ''); typing.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history }) });
      const j = await r.json();
      await new Promise((res) => setTimeout(res, 350));
      typing.innerHTML = md(j.reply || 'Sorry, something went wrong.');
      history.push({ role: 'user', content: text }, { role: 'assistant', content: j.reply || '' });
      if (history.length > 12) history.splice(0, history.length - 12);
      setChips(j.chips);
    } catch {
      typing.innerHTML = md('I could not connect just now. Please try again, or email **info@adypu.edu.in**.');
    } finally { busy = false; body.scrollTop = body.scrollHeight; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  // gentle nudge after 12s for first-time visitors
  setTimeout(() => { if (!started) fab.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 600, iterations: 2 }); }, 12000);
})();
