// ADYPU CRM – mailer (Google Apps Script), version 2
// Sends the portal's security alerts AND student emails (admission form links, follow-ups) from YOUR Gmail over HTTPS
// (Render's free plan blocks normal email ports).
//
// Security: alerts can only go to ALERT_TO. Emails to anyone else (students) are sent ONLY when the request carries
// the secret below, so a leaked web-app link cannot be used to spam people.
//
// SET-UP / UPDATE (5 minutes):
// 1. Replace the whole code in your existing Apps Script project with this file.
// 2. Put a long random secret in SECRET below (the admin dashboard → Admissions tab shows one you can use).
// 3. Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy   (the web-app link stays the same).
// 4. On Render → Environment, add MAIL_WEBHOOK_SECRET = the same secret, and save.
// Note: a free Gmail account can email about 100 people a day.
const ALERT_TO = 'associatedeanacademic@adypu.edu.in';
const SECRET = 'PASTE-THE-SAME-SECRET-AS-MAIL_WEBHOOK_SECRET-ON-RENDER';

function doGet() {
  return ContentService.createTextOutput('adypu-mailer v2');
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    let to = ALERT_TO;
    if (d.to && String(d.to).toLowerCase() !== ALERT_TO.toLowerCase()) {
      if (!SECRET || SECRET.indexOf('PASTE-') === 0 || d.secret !== SECRET) return ContentService.createTextOutput('error: not allowed');
      to = String(d.to);
    }
    const msg = {
      to: to,
      subject: String(d.subject || 'ADYPU CRM').slice(0, 150),
      body: String(d.text || '').slice(0, 5000),
      htmlBody: String(d.html || d.text || '').slice(0, 20000),
      name: String(d.name || 'ADYPU CRM Security').slice(0, 60),
    };
    if (d.replyTo) msg.replyTo = String(d.replyTo);
    MailApp.sendEmail(msg);
    return ContentService.createTextOutput('ok v2');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}

// Run this once from the editor (▶ Run) to approve sending and receive a test email.
function testAlert() {
  MailApp.sendEmail(ALERT_TO, 'ADYPU CRM – mailer test', 'If you can read this, the CRM can send email.');
}
