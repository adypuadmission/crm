// ADYPU CRM – security alert mailer (Google Apps Script)
// Sends the portal's security alerts from YOUR Gmail over HTTPS (Render's free plan blocks normal email ports).
// The recipient is fixed below, so even if the web-app link leaked, it could only email this one address.
const ALERT_TO = 'associatedeanacademic@adypu.edu.in';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    MailApp.sendEmail({
      to: ALERT_TO,
      subject: String(d.subject || 'ADYPU CRM security alert').slice(0, 150),
      body: String(d.text || '').slice(0, 5000),
      htmlBody: String(d.html || d.text || '').slice(0, 20000),
      name: 'ADYPU CRM Security',
    });
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}

// Run this once from the editor (▶ Run) to approve sending and receive a test email.
function testAlert() {
  MailApp.sendEmail(ALERT_TO, 'ADYPU CRM – mailer test', 'If you can read this, security alerts by email will work.');
}
