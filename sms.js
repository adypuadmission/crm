// SMS sending with pluggable providers. Choose with SMS_PROVIDER = console | msg91 | fast2sms | twilio.
// The portal generates and checks OTPs itself; providers only deliver the text.
//
// India: commercial SMS must use DLT-registered sender IDs and templates (TRAI). Register the two
// templates in README.md with your operator/provider first, then put the IDs in the env variables below.
const P = (process.env.SMS_PROVIDER || 'console').toLowerCase();
const CONTACTS = require('./contacts');
const CONTACT_LINE = CONTACTS.map((c) => `${c.name} ${c.phone}`).join(' or ');
const env = (k, d = '') => process.env[k] || d;

const OTP_TEXT = (otp) => `${otp} is your OTP to verify your mobile number for ADYPU admission enquiry. Valid for 5 minutes. Do not share it with anyone. - ADYPU`;
// Plain ASCII keeps the SMS in GSM encoding (160 chars per part instead of 70).
const CONFIRM_TEXT = (e) => `Dear ${e.first}, thank you for your enquiry for ${String(e.course).replace(/[–—]/g, '-')} at Ajeenkya DY Patil University. Ref No: ${e.ref}. For queries call ${CONTACT_LINE}. - ADYPU`;

async function post(url, opts) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

const providers = {
  // Prints messages to the server log. For local testing only — nothing is delivered.
  async console(kind, mobile, data) {
    const text = kind === 'otp' ? OTP_TEXT(data.otp) : CONFIRM_TEXT(data);
    console.log(`[SMS:console] to +91${mobile}: ${text}`);
    return { ok: true };
  },

  // MSG91 v5. OTP: POST /api/v5/otp with our own otp value and the OTP template id.
  // Confirmation: POST /api/v5/flow with a flow template having variables name, course, ref.
  async msg91(kind, mobile, data) {
    const headers = { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json', accept: 'application/json' };
    if (kind === 'otp') {
      const qs = new URLSearchParams({ template_id: env('MSG91_OTP_TEMPLATE_ID'), mobile: `91${mobile}`, otp: data.otp, otp_expiry: '5', otp_length: '6' });
      const r = await post(`https://control.msg91.com/api/v5/otp?${qs}`, { method: 'POST', headers, body: '{}' });
      return { ok: r.ok && r.body?.type !== 'error', detail: r.body };
    }
    const r = await post('https://control.msg91.com/api/v5/flow', { method: 'POST', headers, body: JSON.stringify({
      template_id: env('MSG91_CONFIRM_TEMPLATE_ID'), short_url: '0',
      recipients: [{ mobiles: `91${mobile}`, name: data.first, course: data.course, ref: data.ref }] }) });
    return { ok: r.ok && r.body?.type !== 'error', detail: r.body };
  },

  // Fast2SMS. OTP: bulkV2 route "otp" (Fast2SMS' pre-approved "Your OTP: {#var#}" template).
  // Confirmation: route "dlt" with your DLT sender id + message id, variables "name|course|ref";
  // or set FAST2SMS_CONFIRM_ROUTE=q to use their Quick SMS route with free text (no DLT, costs more).
  async fast2sms(kind, mobile, data) {
    const headers = { authorization: env('FAST2SMS_API_KEY'), 'Content-Type': 'application/json', accept: 'application/json' };
    let body;
    if (kind === 'otp') body = { route: 'otp', variables_values: data.otp, numbers: mobile };
    else if (env('FAST2SMS_CONFIRM_ROUTE', 'dlt') === 'q') body = { route: 'q', message: CONFIRM_TEXT(data), numbers: mobile, flash: 0 };
    else body = { route: 'dlt', sender_id: env('FAST2SMS_SENDER_ID'), message: env('FAST2SMS_CONFIRM_MESSAGE_ID'),
      variables_values: `${data.first}|${data.course}|${data.ref}`, numbers: mobile, flash: 0 };
    const r = await post('https://www.fast2sms.com/dev/bulkV2', { method: 'POST', headers, body: JSON.stringify(body) });
    return { ok: r.ok && r.body?.return === true, detail: r.body };
  },

  // Twilio Programmable Messaging (international; Indian delivery still needs DLT registration).
  async twilio(kind, mobile, data) {
    const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN');
    const form = new URLSearchParams({ To: `+91${mobile}`, Body: kind === 'otp' ? OTP_TEXT(data.otp) : CONFIRM_TEXT(data) });
    if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID')); else form.set('From', env('TWILIO_FROM'));
    const r = await post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    return { ok: r.ok, detail: r.body };
  },
};

async function send(kind, mobile, data) {
  const fn = providers[P];
  if (!fn) { console.error(`Unknown SMS_PROVIDER "${P}"`); return { ok: false }; }
  try {
    const res = await fn(kind, mobile, data);
    if (!res.ok) console.error(`[SMS:${P}] ${kind} to ${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)} failed:`, JSON.stringify(res.detail).slice(0, 300));
    return res;
  } catch (e) {
    console.error(`[SMS:${P}] ${kind} error:`, e.message);
    return { ok: false };
  }
}

module.exports = { send, provider: P, OTP_TEXT, CONFIRM_TEXT };
