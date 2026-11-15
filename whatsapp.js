// WhatsApp messages through Meta's official WhatsApp Business Cloud API.
// The sending number can be your existing WhatsApp Business app number ("coexistence"): you keep using the app on your phone
// while this server sends OTPs and confirmations from the same number.
// Business-initiated WhatsApp messages must use templates approved by Meta (WhatsApp Manager → Message templates):
//   WA_OTP_TEMPLATE      category AUTHENTICATION, with a "Copy code" button        (Meta writes the text: "{{1}} is your verification code.")
//   WA_CONFIRM_TEMPLATE  category UTILITY, body with 3 variables: {{1}} name, {{2}} programme, {{3}} reference number
const env = (k, d = '') => process.env[k] || d;
const TOKEN = env('WA_TOKEN'), PHONE_ID = env('WA_PHONE_NUMBER_ID');
const enabled = !!(TOKEN && PHONE_ID);
const OWN = String(env('WA_SENDER_MOBILE', process.env.ADMIN_MOBILE || '9960889772')).replace(/\D/g, '').slice(-10);

async function send(kind, mobile, data) {
  if (!enabled) return { ok: false, detail: 'WhatsApp not configured' };
  if (OWN && mobile === OWN) return { ok: false, detail: 'cannot message the sending number itself' };
  let template;
  if (kind === 'otp' && env('WA_OTP_TEMPLATE')) template = { name: env('WA_OTP_TEMPLATE'), language: { code: env('WA_OTP_LANG', 'en') }, components: [
    { type: 'body', parameters: [{ type: 'text', text: String(data.otp) }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(data.otp) }] }] };
  else if (kind === 'confirm' && env('WA_CONFIRM_TEMPLATE')) template = { name: env('WA_CONFIRM_TEMPLATE'), language: { code: env('WA_CONFIRM_LANG', 'en') }, components: [
    { type: 'body', parameters: [data.first, data.course, data.ref].map((t) => ({ type: 'text', text: String(t || '-').replace(/\s+/g, ' ') })) }] };
  else if (kind === 'alert' && env('WA_ALERT_TEMPLATE')) template = { name: env('WA_ALERT_TEMPLATE'), language: { code: env('WA_ALERT_LANG', 'en') }, components: [
    { type: 'body', parameters: [{ type: 'text', text: String(data.text).replace(/\s+/g, ' ').slice(0, 300) }] }] };
  if (!template) return { ok: false, detail: `no WhatsApp template set for ${kind}` };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`https://graph.facebook.com/${env('WA_API_VERSION', 'v23.0')}/${PHONE_ID}/messages`, { method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: `91${mobile}`, type: 'template', template }) }).finally(() => clearTimeout(t));
    const body = await r.json().catch(() => ({}));
    if (!r.ok) console.error(`[WhatsApp] ${kind} to ${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)} failed:`, JSON.stringify(body).slice(0, 300));
    return { ok: r.ok && !!body.messages, detail: body };
  } catch (e) { console.error('[WhatsApp]', kind, e.message); return { ok: false, detail: e.message }; }
}
module.exports = { send, enabled };
