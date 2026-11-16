# ADYPU Admission Enquiry Portal

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/adypuadmission/crm)

**Quick deploy:** click the button, sign in to Render with GitHub, set `ADMIN_PASSWORD`, and Render creates the web app plus a PostgreSQL database from `render.yaml`. For long-term storage, point `DATABASE_URL` at a permanent PostgreSQL database (a paid Render database, or free Neon or Supabase).

An admission enquiry website for **Ajeenkya DY Patil University, Pune**. It has three parts:
- a public enquiry form, with mobile OTP verification;
- an "Ask ADYPU" chatbot;
- a password-protected admin dashboard with date-wise and region-wise analytics and Excel/PDF reports.

| Page | URL |
|---|---|
| Student enquiry form + chatbot | `/` |
| Admin login | `/admin/login` |
| Admin dashboard | `/admin` |

## Programmes offered on the form
| Level | Programmes | Branches |
|---|---|---|
| **UG** | B.Tech, Law, Design, Hotel Management | B.Tech: Computer Science & Engg., Software Engg., Cybersecurity, AI & Data Science, Biomedical Engg., Biotechnology, Mechanical Engg., Robotics & Automation, Electronics & Computer Engg., Civil Engg. |
| **PG** | M.Tech, MBA, MCA | M.Tech: the same 10 branches |

Edit `courses.js` to add or rename programmes and branches. The form, server checks, chatbot, filters and reports all update from that file. Older entries are migrated to the new structure automatically.

## Contact persons for queries
**Dr. Maqsood Ahmed Ansari** (98220 70363) and **Mrs. Rebekah Gaware** (77739 00773) appear on the form page and the success screen (with Call and WhatsApp buttons), in the confirmation SMS, and in the chatbot. Edit them in **`contacts.js`**.

## What students get
- **Form fields:** Student name\*, Mobile\* (verified by a 6-digit OTP), Email (optional), City / District\* and Preferred programme\*.
- **Region detection:** typing a city shows its region live. Maharashtra districts map to their division (Pune, Konkan/Mumbai, Nashik, Chhatrapati Sambhajinagar, Amravati, Nagpur); other cities and states map to their state.
- **OTP verification:** 6 boxes with auto-advance and paste support, a 30-second resend timer and a "change number" option. If the student presses Submit before verifying, the OTP is sent and the form submits automatically once it's verified.
- **Confirmation SMS:** sent after registration with the reference number, e.g. "Dear Ananya, thank you for your enquiry for AI & Data Science at Ajeenkya DY Patil University. Ref No: ADYPU-26-00013. For queries call Dr. Maqsood Ahmed Ansari 9822070363 or Mrs. Rebekah Gaware 7773900773. - ADYPU".
- **Ask ADYPU chatbot:** a floating button with quick-reply chips. It covers programmes, how to apply, ACET, contact numbers by school, office hours, location, campus life, international links and approvals.
  - Questions it can't answer from verified facts (exact fees, eligibility percentages, hostel charges, placement figures) get the right school's phone number instead of a guess.
  - "Request a call back" takes the student to the form.

## What the admission team gets: the Admission Command Centre
**One filter bar for everything:** UG / PG · Programme · Branch · Region · Status · Verified · Search · date range (Today / 7 days / 30 days / All / custom). Active filters show as removable chips, and **every chart is clickable**: clicking a segment filters the whole dashboard (cross-filtering).

**📊 Insights tab**
- **KPI cards:**
  - total enquiries with a 14-day sparkline and the change vs the previous week;
  - UG vs PG split;
  - verified-mobile and admission-conversion rings;
  - a pulsing alert for new enquiries **waiting more than 24 h** for a call.
- **Smart insights:** auto-written lines, e.g. *"Pune Division brings 37% of enquiries"*, *"Electronics & Computer Engineering is the most wanted branch"*, *"Momentum is up"*, *"Students are most active on Wed, 9 pm–12 am — the best time to call back"*.
- **🧭 Programme explorer:** an interactive sunburst (Level → Programme → Branch). Click a ring to drill in, then "Back out".
- **🪜 Admission funnel:** New → Contacted → Interested → Counselling → Applied → Admitted, with stage conversion %.
- **🗺️ Maharashtra division map:** hexagon tiles laid out like the state, shaded by demand, with the top region pulsing. A "Beyond the divisions" list covers other states.
- **📈 Enquiry trend:** UG/PG stacked bars plus a total line (7 / 14 / 30 days). Click a day to filter.
- **⏰ Best-time-to-call heatmap:** day of week × 3-hour slot, in IST.
- **🏆 Branch leaderboard:** B.Tech vs M.Tech demand per branch.

**📋 Enquiries tab:** the table with sortable columns, a Level badge and Programme/Branch per student, OTP-verified badge, status, notes, SMS status and ↻ resend.

**Exports:** Excel and PDF follow the current filters and sort order. They include Level, Programme and Branch columns, plus summaries by level, programme, branch, region and date.

Course names live in **`courses.js`** and city→region rules in **`regions.js`**. The chatbot's facts are in **`chat.js`**; update them when university details change.

---

## 📱 QR "scan & fill" (website scanner)
- **Front page (laptop/desktop):** a QR card. Students scan it with their phone camera and the enquiry form opens on the phone. It's hidden on phones, since they're already there.
- **Printable A4 poster:** `/qr-poster.pdf`, also linked from the front page and from the admin header ("📱 QR poster"), for notice boards, fairs and seminars.
- **A personal QR for every sub-admin:** shown in their workspace, with a poster download, copy-link and WhatsApp share. Students who scan it are **credited to that counsellor automatically** (pushed by and counsellor), the form shows "Your counsellor: …", and the admin table marks them "📱 Name (QR)". Admins can download each person's poster from the Team tab ("📱 QR").
- Scans of the general poster are tagged "📱 QR scan" so you can tell them apart from normal website visits.
- Set `PUBLIC_URL` (e.g. `https://admissions.adypu.edu.in`) once you have a custom domain, so printed QR codes always point to it.

## Sub-admin (counsellor / partner) module
**Main admin → 👥 Team tab:** create sub-admin accounts (name, username, mobile; the password is auto-generated or set by you), reset passwords, disable or enable accounts, and see each person's numbers: pushed, this week, counselling, admitted. A disabled account is logged out immediately.

**Sub-admins** sign in at the same `/admin/login` page and land in the **Counsellor Workspace** (`/team`):
- **Add a student:** name, mobile, email, city, UG/PG → programme → branch, status, notes, and an optional confirmation SMS.
- **Bulk upload:** an Excel or CSV file of up to 1000 rows. Download the **template** first; it has dropdowns for Level, Programme, Branch and Status. Columns are matched by name, loose entries like "btech" or "Mechanical" are understood, rows with errors are listed with the reason, and students already in the database (same mobile + programme) are skipped with their existing reference number.
- **My students:** students they pushed plus website leads the admin assigned to them, with status and notes editing. They can't see or change anyone else's data or the admin dashboard.

**Main admin, tracking the team:**
- New filters: **Pushed by** (Website form / each sub-admin) and **Counsellor** (Unassigned / each sub-admin), combined with the date range and all other filters.
- The Enquiries table shows **Pushed by** and lets you **assign or reassign the counsellor** from a dropdown. A smart insight flags enquiries with no counsellor.
- **👥 Team performance** chart on the Insights tab: students pushed vs admitted per person. Click a person to filter.
- Excel and PDF exports include Pushed By and Counsellor columns and summaries.

## Run on your laptop
```bash
npm install
cp .env.example .env      # set ADMIN_PASSWORD and SESSION_SECRET
# For a quick test without SMS, set OTP_DEMO_MODE=true (the OTP is shown on screen)
npm start
```
Open http://localhost:3000.

## Deploy online (Render.com)
1. Push this folder to GitHub.
2. On Render, choose **New → Blueprint** and select the repo. `render.yaml` creates the app and a PostgreSQL database.
3. Set **ADMIN_PASSWORD** and the **SMS provider keys** (below).
4. For permanent data, use a PostgreSQL database (a paid Render database, or free Neon or Supabase) through `DATABASE_URL`. Render's free database expires.

---

## 💬 WhatsApp messages (OTP + confirmation)

Students receive their OTP and the thank-you message on **WhatsApp** from the official admission number. The message names **their own counsellor and the counsellor's WhatsApp number**, so students reply straight to the counsellor. The main admin's number (9960889772) and email are used only for admin login and security alerts, through Meta's official **WhatsApp Business Cloud API**. If a WhatsApp message fails (e.g. the student has no WhatsApp), the portal automatically sends an SMS instead. Approximate Meta charge in India: ~₹0.12–0.15 per OTP or confirmation (no monthly fee when you connect directly to Meta).

**One-time setup (≈30 minutes + template approval):**
1. Use the **admission office number** for sending (not the admin's 9960889772). Install **WhatsApp Business** on that phone and update it to the latest version.
2. Go to **business.facebook.com** → create/verify the business "Ajeenkya DY Patil University – Admissions".
3. In **developers.facebook.com** create an app (type *Business*) → add **WhatsApp** → *Add phone number* → enter the office number → choose **"Connect your existing WhatsApp Business app"** and scan the QR code shown in the app. (This is *coexistence*: you keep chatting from the app on your phone.)
4. Copy the **Phone number ID** → `WA_PHONE_NUMBER_ID`. In Business Settings → System users, create a system user, give it the WhatsApp app, and generate a **permanent token** with `whatsapp_business_messaging` → `WA_TOKEN`.
5. In **WhatsApp Manager → Message templates** create:
   - `adypu_otp` — category **Authentication**, *Copy code* button (Meta writes the text).
   - `adypu_enquiry_confirm` — category **Utility**, language English:
     > Dear {{1}}, thank you for your enquiry for {{2}} at Ajeenkya DY Patil University, Pune. Your reference number is {{3}}. Your admission counsellor is {{4}}. For any query, reply on WhatsApp or call {{5}}.

   ({{4}}/{{5}} are filled with the student's own counsellor — the one who added them or whose QR they scanned, or whom the admin assigned. Website enquiries without a counsellor get Dr. Maqsood Ahmed Ansari 9822070363.)
6. Add a payment method in WhatsApp Manager, put the values in Render's environment, redeploy.

   - `adypu_security_alert` — category **Utility**: *ADYPU CRM security alert: {{1}}. Please check the admin dashboard.*
6b. Set `WA_SENDER_MOBILE` to the office number.

**Who gets what**
- **Students** → OTP + confirmation on WhatsApp from the office number, with **their counsellor's name and WhatsApp number** to reply to. When the admin assigns a counsellor, the student gets a fresh message introducing that counsellor.
- **Counsellors** → their own WhatsApp number is required when the admin creates their account; it is shown to their students (QR page, success screen, messages).
- **Main admin (Dr. Atul Kathole, 9960889772 + email)** → admin login OTP and every security alert (SMS + WhatsApp + email), including **every Excel/PDF download, even from the admin account**.

## Setting up SMS (OTP + confirmation)
Indian SMS rules (TRAI DLT) require a registered **sender ID** and **approved templates** before messages are delivered. One-time steps:

1. **Register on a DLT portal** as the principal entity. Use Jio, Vodafone-Idea (Vi), Airtel or BSNL; your SMS provider can help. Register a 6-letter sender ID, e.g. `ADYPUN`.
2. **Get these two templates approved.** The text must match exactly; `{#var#}` marks a variable.
   - **OTP (Service Implicit):** `{#var#} is your OTP to verify your mobile number for ADYPU admission enquiry. Valid for 5 minutes. Do not share it with anyone. - ADYPU`
   - **Confirmation (Service Implicit):** `Dear {#var#}, thank you for your enquiry for {#var#} at Ajeenkya DY Patil University. Ref No: {#var#}. For queries call Dr. Maqsood Ahmed Ansari 9822070363 or Mrs. Rebekah Gaware 7773900773. - ADYPU`
     (about 225 characters, sent as a 2-part SMS. The contact names and numbers live in `contacts.js`; if you change them, update this DLT template too.)
3. **Choose one provider** and set its environment variables:

| Provider | Set these |
|---|---|
| **MSG91** (`SMS_PROVIDER=msg91`) | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` (OTP template with `##OTP##`), `MSG91_CONFIRM_TEMPLATE_ID` (Flow template using `##name##`, `##course##`, `##ref##`) |
| **Fast2SMS** (`SMS_PROVIDER=fast2sms`) | `FAST2SMS_API_KEY`, `FAST2SMS_SENDER_ID`, `FAST2SMS_CONFIRM_MESSAGE_ID` (3 variables: name, course, ref). OTPs use Fast2SMS's ready-made OTP route. |
| **Twilio** (`SMS_PROVIDER=twilio`) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` |

4. **Check the dashboard header.** It shows which SMS provider is active, and each enquiry shows whether its SMS was sent or failed.

| Setting | Meaning |
|---|---|
| `OTP_REQUIRED=true` | Students must verify their mobile before submitting. |
| `OTP_DEMO_MODE=true` | **Testing only.** The OTP is shown on screen and no SMS is sent. |
| `SEND_CONFIRMATION_SMS=true` | Sends the thank-you SMS after registration. |
| `SMS_PROVIDER=console` | Messages are only written to the server log. |

**OTP security:**
- The code is a random 6-digit number. It's stored only as a keyed hash, expires in 5 minutes, works once and allows 5 wrong tries.
- There's a 30-second gap between resends and at most 5 OTPs per number per hour, plus a per-network rate limit.
- The form only accepts a submission carrying a signed "verified" token for that exact number.

## Chatbot options
- **Default (free):** it answers from the built-in knowledge base taken from adypu.edu.in.
- **AI mode:** set `ANTHROPIC_API_KEY` and Claude answers questions in natural language, in English, Hindi or Marathi. It's still restricted to the same facts and told never to invent fees, rankings or approvals. If the AI is unavailable, it falls back to the knowledge base automatically.

## 📞 Calling team, follow-ups & smart exports

**Two separate kinds of team accounts** (Team tab → Create an account):
- **Counsellor (data entry):** adds / uploads students and has a personal QR code. Sees only students they pushed. Cannot call from the portal.
- **Calling team:** sees only the students the admin assigns to them **for calling**, in a *Calling Workspace* with *Due today · Overdue · Not called yet · Upcoming* lists.

**Calling assignment is separate from the data counsellor.** Every student has a "Counsellor (data)" and an "Assigned caller". The admin assigns callers in Enquiries → *Calling assignment*:
1. **Selected students:** tick rows → choose caller → *Assign selected*.
2. **Share filtered students fairly:** filter (e.g. Region = Nashik, Programme = MBA) → tick callers → *Share now*. Students are split by each caller's current workload.
3. **Automatic by region:** *Set region rules*. New enquiries go turn-by-turn to the callers set for their region.

**Secure calling:** callers see masked numbers. *📞 Call* / *💬 WhatsApp* releases the number for a single tap, only for students assigned to that caller. Every dial is logged, and more than 80 dials in an hour is blocked and alerts the admin.

**Call log:** after each call the caller records the result (Connected, Not picked, Busy, Switched off, Not reachable, Wrong number, Call back later), feedback, new status and next follow-up date. The admin sees the full history (📞 badge in the Caller column) and can filter *Untouched / Overdue / Due today / Upcoming / Called*.

**Daily 9 AM email:** untouched enquiries (24 h+), overdue follow-ups and today's follow-ups, per caller. It contains no student names or numbers. You can also send it any time with *Team → Send today's summary email*.

**Downloads with chosen columns:** Excel / PDF open a tick-box list (22 columns including caller, calls, last result, latest feedback, next follow-up, updated on). The choice is remembered.

## 🛡️ Data protection (maximum security mode)

**Only the main admin can see full contact details or download data.**

| Protection | What it does |
|---|---|
| **Encryption at rest** | Student name, mobile, email and notes are encrypted with **AES-256-GCM** before they reach the database. Anyone opening the database directly (hosting staff, a leaked backup) sees only `enc:v1:…` ciphertext. Mobile look-ups use a keyed hash (blind index), never the plain number. |
| **Masked for counsellors** | Sub-admins only ever receive `98XXXXXX10` / `p•••@gmail.com` from the server — the full number never reaches their browser. Searching by mobile digits is blocked and logged. |
| **Optional "Call" button** | Off by default. If the admin switches it on (Security tab), a counsellor can see one number for 20 seconds to call; each view is logged and alerted. |
| **Downloads: admin only** | Excel/PDF exports exist only for the main admin. Every download is logged; each PDF page carries a CONFIDENTIAL watermark plus "downloaded by admin · time · IP". |
| **Instant alerts** | SMS to `ADMIN_MOBILE` (and email if SMTP is set) when a sub-admin tries the admin area or a download, copies / prints / screenshots data, opens developer tools, an account is locked, a session is reused on another device, or unusual request volume appears. Alerts also show as a red badge in the dashboard. |
| **Screen protection** | Sub-admin pages carry a moving-proof watermark (name · @username · IP · time), block copy, cut, right-click, drag, select-all, print, save-page; data blurs when the window loses focus (snipping tools) or PrintScreen is pressed. Main admin pages carry a "CONFIDENTIAL · MAIN ADMIN" watermark. |
| **Admin 2-step login** | Password + 6-digit OTP sent to `ADMIN_MOBILE`. |
| **Lockout** | 5 wrong passwords → account locked 15 minutes + critical alert. |
| **Sessions** | Signed HttpOnly cookie, bound to the browser it was issued to (a stolen cookie fails elsewhere and raises an alert), expires in 6 h, auto sign-out after 15 min idle, password reset signs a counsellor out everywhere. |
| **No caching** | `Cache-Control: no-store` on every private page, API and export; HTTPS forced in production. |
| **Security log** | Security tab lists every sign-in, failure, export, change and attempt, with IP and device. |

> **Honest limits:** no website can physically stop someone photographing a screen with a phone. That is why counsellors never receive the full numbers at all, and why every screen carries a watermark identifying the person — any leaked photo can be traced.

**Before going live set:** `DATA_KEY` (Render generates it — download a copy and keep it safe), `ADMIN_MOBILE`, `ADMIN_PASSWORD`, `SMS_PROVIDER`, and `OTP_DEMO_MODE=false`.

## Security built in
- **Admin login:** bcrypt password and a signed HttpOnly cookie that lasts 8 hours. Logins are rate-limited.
- **Abuse protection:** rate limits on the form, OTP and chatbot; a bot honeypot; server-side validation; parameterised SQL; Helmet security headers with a strict Content-Security-Policy; admin pages hidden from search engines.
- **Duplicates:** the same mobile and course within 24 hours returns the existing reference number.

To change the admin password, update `ADMIN_PASSWORD` and restart, or run `npm run hash-password -- "NewPassword"` and set `ADMIN_PASSWORD_HASH`.
