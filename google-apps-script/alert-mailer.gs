// ADYPU CRM – mailer (Google Apps Script), version 2
// Sends the portal's security alerts AND student emails (admission form links, follow-ups) from YOUR Gmail over HTTPS
// (Render's free plan blocks normal email ports).
//
// Security: alerts go only to ALERT_TO. For any other address (a student), this script first asks the CRM
// whether it really sent that email (one-time code, valid 2 minutes). A leaked web-app link therefore cannot
// be used to email anyone else. No password or secret needs to be stored here.
//
// UPDATE (3 minutes): replace all code with this file → Save → Deploy → Manage deployments → ✏️ Edit →
// Version: "New version" → Deploy → approve the new permission ("connect to an external service").
// The web-app link stays the same. A free Gmail account can email about 100 people a day.
const ALERT_TO = 'associatedeanacademic@adypu.edu.in';
const CRM = 'https://adypu-admission.onrender.com';

function doGet() {
  return ContentService.createTextOutput('adypu-mailer v2');
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    let to = ALERT_TO;
    if (d.to && String(d.to).toLowerCase() !== ALERT_TO.toLowerCase()) {
      const check = UrlFetchApp.fetch(CRM + '/api/mail/verify?n=' + encodeURIComponent(d.nonce || '') + '&to=' + encodeURIComponent(String(d.to)), { muteHttpExceptions: true });
      if (check.getContentText() !== 'yes') return ContentService.createTextOutput('error: not allowed');
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
  UrlFetchApp.fetch(CRM + '/healthz');
}
