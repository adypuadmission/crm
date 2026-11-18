// Online admission application form — same sections as the printed SOE application form.
// One definition drives the student's form, server-side checks, the admin view and the application PDF.
const YN = ['Yes', 'No'];
const SCHEME = ['Percentage', 'CGPA'];
const RESULT = ['Declared', 'Awaiting'];
const BOARDS = ['Maharashtra State Board', 'CBSE', 'CISCE (ICSE / ISC)', 'NIOS', 'Other State Board', 'International (IB / Cambridge)'];
const STATES = ['Maharashtra', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman & Nicobar', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry', 'Outside India'];
const YEARS = Array.from({ length: 20 }, (_, i) => String(new Date().getFullYear() + 1 - i));

const h = (label) => ({ type: 'h', label });
const f = (k, label, type = 'text', o = {}) => ({ k, label, type, ...o });

const SECTIONS = [
  { id: 'programme', title: 'Programme', icon: '🎓', fields: [
    f('level', 'Level', 'select', { options: ['UG', 'PG'], req: true, half: true }),
    f('programme', 'Programme', 'programme', { req: true, half: true }),
    f('branch', 'Branch / Specialisation', 'branch', { half: true }),
    h('Entrance examination (if any)'),
    f('entrance', 'Entrance exam', 'select', { options: ['ADYPU Entrance', 'MHT-CET', 'JEE Main', 'CAT / MAT / CMAT', 'CLAT / MH-CET Law', 'NATA / UCEED', 'Other', 'Not appeared'], half: true }),
    f('exam_year', 'Year of passing', 'select', { options: YEARS, half: true, show: ['entrance', '!', 'Not appeared'] }),
    f('exam_result', 'Result status', 'select', { options: RESULT, half: true, show: ['entrance', '!', 'Not appeared'] }),
    f('exam_percentile', 'Percentile / score', 'text', { max: 12, half: true, show: ['entrance', '!', 'Not appeared'] }),
    f('exam_rank', 'Rank (if any)', 'text', { max: 12, half: true, show: ['entrance', '!', 'Not appeared'] }),
  ] },
  { id: 'personal', title: 'Personal details', icon: '🙋', fields: [
    f('title', 'Title', 'select', { options: ['Mr.', 'Ms.', 'Mrs.'], req: true, third: true }),
    f('first_name', 'First name', 'text', { req: true, max: 40, third: true }),
    f('last_name', 'Last name', 'text', { req: true, max: 40, third: true }),
    f('email', 'Email address', 'email', { req: true, max: 120, half: true }),
    f('alt_mobile', 'Alternate mobile', 'tel', { half: true }),
    f('wa_same', 'Is your WhatsApp number the same as your mobile?', 'select', { options: YN, req: true, half: true }),
    f('wa_number', 'WhatsApp number', 'tel', { half: true, show: ['wa_same', '=', 'No'], req: true }),
    f('gender', 'Gender', 'select', { options: ['Male', 'Female', 'Other'], req: true, third: true }),
    f('dob', 'Date of birth', 'date', { req: true, third: true }),
    f('blood', 'Blood group', 'select', { options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', "Don't know"], third: true }),
    f('marital', 'Marital status', 'select', { options: ['Single', 'Married'], third: true }),
    f('nationality', 'Nationality', 'select', { options: ['Indian', 'NRI', 'Foreign national'], req: true, third: true }),
    f('category', 'Category', 'select', { options: ['General / Open', 'OBC', 'SC', 'ST', 'VJ / NT', 'SBC', 'EWS', 'Other'], req: true, third: true }),
    f('religion', 'Religion (optional)', 'text', { max: 30, half: true }),
    f('aadhaar', 'Aadhaar number (optional)', 'aadhaar', { half: true, hint: 'Stored encrypted. You may also show it at the admission desk.' }),
    f('passport_no', 'Passport number (if any)', 'text', { max: 20, third: true }),
    f('passport_country', 'Passport issuing country', 'text', { max: 40, third: true }),
    f('passport_valid', 'Passport valid up to', 'date', { third: true }),
  ] },
  { id: 'parents', title: 'Parents / guardian', icon: '👨‍👩‍👧', fields: [
    h("Father's details"),
    f('father_title', 'Title', 'select', { options: ['Mr.', 'Dr.', 'Late'], third: true }),
    f('father_name', "Father's name", 'text', { req: true, max: 80, third: true }),
    f('father_mobile', "Father's mobile", 'tel', { third: true }),
    f('father_email', "Father's email", 'email', { half: true }),
    f('father_occ', "Father's occupation", 'text', { max: 60, half: true }),
    h("Mother's details"),
    f('mother_title', 'Title', 'select', { options: ['Mrs.', 'Ms.', 'Dr.', 'Late'], third: true }),
    f('mother_name', "Mother's name", 'text', { req: true, max: 80, third: true }),
    f('mother_mobile', "Mother's mobile", 'tel', { third: true }),
    f('mother_email', "Mother's email", 'email', { half: true }),
    f('mother_occ', "Mother's occupation", 'text', { max: 60, half: true }),
    h('Guardian (if different from parents)'),
    f('guardian_name', "Guardian's name", 'text', { max: 80, third: true }),
    f('guardian_mobile', "Guardian's mobile", 'tel', { third: true }),
    f('guardian_rel', 'Relationship with the student', 'text', { max: 40, third: true }),
    f('income', 'Family annual income', 'select', { options: ['0 – 3 lakh', '3 – 6 lakh', '6 – 8 lakh', '8 – 12 lakh', 'Above 12 lakh', 'Prefer not to say'], req: true, half: true }),
  ] },
  { id: 'address', title: 'Address', icon: '🏠', fields: [
    h('Address for correspondence'),
    f('c_line1', 'Address line 1', 'text', { req: true, max: 120, half: true }),
    f('c_line2', 'Address line 2', 'text', { max: 120, half: true }),
    f('c_city', 'City / Taluka', 'text', { req: true, max: 60, third: true }),
    f('c_district', 'District', 'text', { req: true, max: 60, third: true }),
    f('c_state', 'State', 'select', { options: STATES, req: true, third: true }),
    f('c_pin', 'Pincode', 'pin', { req: true, third: true }),
    f('c_country', 'Country', 'text', { max: 40, third: true, def: 'India' }),
    f('perm_same', 'Is the permanent address the same?', 'select', { options: YN, req: true, third: true }),
    h('Permanent address'),
    f('p_line1', 'Address line 1', 'text', { req: true, max: 120, half: true, show: ['perm_same', '=', 'No'] }),
    f('p_line2', 'Address line 2', 'text', { max: 120, half: true, show: ['perm_same', '=', 'No'] }),
    f('p_city', 'City / Taluka', 'text', { req: true, max: 60, third: true, show: ['perm_same', '=', 'No'] }),
    f('p_district', 'District', 'text', { req: true, max: 60, third: true, show: ['perm_same', '=', 'No'] }),
    f('p_state', 'State', 'select', { options: STATES, req: true, third: true, show: ['perm_same', '=', 'No'] }),
    f('p_pin', 'Pincode', 'pin', { req: true, third: true, show: ['perm_same', '=', 'No'] }),
  ] },
  { id: 'academics', title: 'Academic details', icon: '📚', fields: [
    h('Class X / SSC'),
    f('ssc_school', 'School name', 'text', { req: true, max: 100, half: true }),
    f('ssc_board', 'Board', 'select', { options: BOARDS, req: true, half: true }),
    f('ssc_year', 'Year of passing', 'select', { options: YEARS, req: true, third: true }),
    f('ssc_scheme', 'Marking scheme', 'select', { options: SCHEME, req: true, third: true }),
    f('ssc_marks', 'Percentage / CGPA', 'marks', { req: true, third: true }),
    f('after_ssc', 'Qualification after Class X', 'select', { options: ['Class XII / HSC', 'Diploma', 'Both'], req: true, half: true }),
    h('Class XII / HSC'),
    f('hsc_school', 'College / school name', 'text', { req: true, max: 100, half: true, show: ['after_ssc', '!', 'Diploma'] }),
    f('hsc_board', 'Board', 'select', { options: BOARDS, req: true, half: true, show: ['after_ssc', '!', 'Diploma'] }),
    f('hsc_year', 'Year of passing', 'select', { options: YEARS, req: true, third: true, show: ['after_ssc', '!', 'Diploma'] }),
    f('hsc_result', 'Result status', 'select', { options: RESULT, req: true, third: true, show: ['after_ssc', '!', 'Diploma'] }),
    f('hsc_marks', 'Percentage / CGPA', 'marks', { third: true, show: ['after_ssc', '!', 'Diploma'] }),
    h('Diploma'),
    f('dip_inst', 'Institute name', 'text', { req: true, max: 100, half: true, show: ['after_ssc', '!', 'Class XII / HSC'] }),
    f('dip_board', 'Board / university', 'text', { req: true, max: 80, half: true, show: ['after_ssc', '!', 'Class XII / HSC'] }),
    f('dip_year', 'Year of passing', 'select', { options: YEARS, req: true, third: true, show: ['after_ssc', '!', 'Class XII / HSC'] }),
    f('dip_result', 'Result status', 'select', { options: RESULT, req: true, third: true, show: ['after_ssc', '!', 'Class XII / HSC'] }),
    f('dip_marks', 'Percentage / CGPA', 'marks', { third: true, show: ['after_ssc', '!', 'Class XII / HSC'] }),
    h('Graduation (for PG programmes)'),
    f('ug_univ', 'University', 'text', { max: 100, half: true, reqIf: ['level', '=', 'PG'] }),
    f('ug_degree', 'Name of degree', 'text', { max: 60, half: true, reqIf: ['level', '=', 'PG'] }),
    f('ug_year', 'Year of passing', 'select', { options: YEARS, third: true }),
    f('ug_result', 'Result status', 'select', { options: RESULT, third: true }),
    f('ug_marks', 'Percentage / CGPA', 'marks', { third: true }),
    h('More about you'),
    f('medium', 'Medium of instruction in previous education', 'select', { options: ['English', 'Marathi', 'Hindi', 'Semi-English', 'Other'], half: true }),
    f('english_test', 'English proficiency test (if any)', 'select', { options: ['None', 'IELTS', 'TOEFL', 'PTE', 'Other'], half: true }),
    f('english_score', 'Test score obtained / maximum', 'text', { max: 20, half: true, show: ['english_test', '!', 'None'] }),
    f('hostel', 'Do you need on-campus accommodation (hostel)?', 'select', { options: YN, req: true, half: true }),
    f('medical', 'Any medical condition or disability we should know about?', 'select', { options: YN, half: true }),
    f('medical_note', 'Please specify', 'text', { max: 150, half: true, show: ['medical', '=', 'Yes'] }),
    f('work_exp', 'Do you have work experience?', 'select', { options: YN, half: true }),
    f('work_org', 'Organisation · designation · months', 'text', { max: 150, half: true, show: ['work_exp', '=', 'Yes'] }),
  ] },
  { id: 'documents', title: 'Documents', icon: '📎', docs: true, fields: [] },
  { id: 'declaration', title: 'Declaration', icon: '✍️', fields: [
    f('declare', 'I declare that the information given in this application is true. If any information is found to be incorrect or misleading at any point, my candidature / admission may be cancelled and the University may take action as it deems fit.', 'check', { req: true }),
    f('applicant_name', 'Applicant name (as signature)', 'text', { req: true, max: 80, half: true }),
    f('parent_name', 'Parent / guardian name', 'text', { req: true, max: 80, half: true }),
    f('place', 'Place', 'text', { req: true, max: 60, half: true }),
  ] },
];

// Documents the student can upload (images are compressed in the browser before upload)
const DOCS = [
  ['photo', 'Passport-size photo', true], ['signature', 'Signature', true], ['aadhaar', 'Aadhaar card', false], ['ssc', 'Class X / SSC marksheet', false],
  ['hsc', 'Class XII / HSC marksheet', false], ['diploma', 'Diploma marksheet', false], ['graduation', 'Graduation marksheet', false],
  ['entrance', 'Entrance exam scorecard', false], ['leaving', 'School / college leaving certificate', false], ['other', 'Any other document', false],
].map(([k, label, req]) => ({ k, label, req }));

const ALL = SECTIONS.flatMap((s) => s.fields.filter((x) => x.k));
const shown = (fld, d) => {
  if (!fld.show) return true;
  const [k, op, v] = fld.show, cur = d[k] || '';
  return op === '=' ? cur === v : cur !== v && cur !== '';
};
const reqd = (fld, d) => (fld.req || (fld.reqIf && (d[fld.reqIf[0]] || '') === fld.reqIf[2])) && shown(fld, d);

// Clean + check submitted data. Returns { data, errors } (errors keyed by field).
function check(input, { final = false, levels, isValid } = {}) {
  const d = {}, errors = {};
  for (const fld of ALL) {
    let v = input[fld.k];
    if (fld.type === 'check') v = v === true || v === 'true' || v === 'on';
    else v = String(v ?? '').replace(/[\u0000-\u001F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, fld.max || 120);
    if (fld.type === 'tel' && v) v = v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10);
    if (fld.type === 'aadhaar' && v) v = v.replace(/\D/g, '');
    if (fld.type === 'pin' && v) v = v.replace(/\D/g, '');
    if (fld.options && v && !fld.options.includes(v)) v = '';
    d[fld.k] = v;
  }
  if (!final) return { data: d, errors };
  for (const fld of ALL) {
    const v = d[fld.k];
    if (reqd(fld, d) && (fld.type === 'check' ? !v : !v)) { errors[fld.k] = 'Required'; continue; }
    if (!v || !shown(fld, d)) continue;
    if (fld.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errors[fld.k] = 'Enter a valid email';
    if (fld.type === 'tel' && !/^[6-9]\d{9}$/.test(v)) errors[fld.k] = 'Enter a 10-digit mobile number';
    if (fld.type === 'pin' && !/^\d{6}$/.test(v)) errors[fld.k] = 'Enter the 6-digit pincode';
    if (fld.type === 'aadhaar' && !/^\d{12}$/.test(v)) errors[fld.k] = 'Aadhaar has 12 digits';
    if (fld.type === 'marks' && !/^\d{1,3}(\.\d{1,2})?$/.test(v)) errors[fld.k] = 'Enter a number, e.g. 78.5';
    if (fld.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[fld.k] = 'Choose a date';
  }
  if (d.dob && /^\d{4}/.test(d.dob)) { const y = +d.dob.slice(0, 4), now = new Date().getFullYear(); if (y > now - 14 || y < now - 70) errors.dob = 'Please check the date of birth'; }
  if (isValid && !isValid(d.level, d.programme, d.branch || '')) errors.programme = 'Please choose the programme (and branch for B.Tech / M.Tech)';
  return { data: d, errors };
}

// Label/value rows for the admin view and the PDF
function rows(d) {
  return SECTIONS.filter((s) => !s.docs).map((s) => { let head = '';
    const labelled = s.fields.map((x) => { if (x.type === 'h') head = x.label.replace(/ \(.*\)$/, '').replace('Address for correspondence', 'Correspondence'); return { ...x, label: head && ['academics', 'address'].includes(s.id) && x.k ? `${head} · ${x.label}` : x.label }; });
    return { title: s.title, items: labelled.filter((x) => x.k && shown(x, d) && d[x.k] !== '' && d[x.k] !== undefined && d[x.k] !== false)
    .map((x) => [x.type === 'check' ? 'Declaration' : x.label, x.type === 'check' ? 'I agree' : x.type === 'aadhaar' ? String(d[x.k]).replace(/^(\d{4})\d{4}/, '$1XXXX') : String(d[x.k])]) }; })
    .filter((s) => s.items.length);
}

module.exports = { SECTIONS, DOCS, check, rows };
