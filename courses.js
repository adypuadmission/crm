// Single source of truth for programmes and tuition fees (ADYPU Fee Structure, AY 2026-27).
// Level (UG / PG) → Programme → Specialisation. Used by the enquiry form, admission form, fee calculation,
// server validation, chatbot, filters, uploads and reports. Edit fees here only.
//   [school, programme, icon, [[specialisation, tuition fee ₹], ...]]   (a programme without specialisations has one entry with '')
const CATALOGUE = {
  UG: [
    ['School of Engineering', 'B.Tech', '🛠️', [
      ['CSE – Cyber Security', 300000], ['CSE – Software Engineering', 300000], ['Artificial Intelligence & Data Science', 300000],
      ['Electronics & Computer Engineering', 150000], ['Civil Engineering', 150000], ['Mechanical – Automobile Engineering', 150000],
      ['Mechanical – 3D Printing & Design', 150000], ['Biotechnology – Medical', 250000], ['Biotechnology – Bioinformatics', 250000],
      ['Biotechnology – Food Technology', 250000], ['Biomedical Engineering', 150000]]],
    ['School of Management', 'BBA', '📊', [['Sales & Marketing', 230000], ['Finance', 230000], ['Entrepreneurship & Innovation', 230000], ['Fintech', 230000]]],
    ['School of Computer Applications', 'BCA', '🖥️', [['', 200000]]],
    ['School of Design', 'B.Des', '🎨', [['Transportation Design', 600000], ['UI / UX Design', 350000], ['Product Design', 350000], ['Visual Communication', 350000],
      ['Fashion Design', 350000], ['Interior Design', 350000]]],
    ['School of Law', 'Law', '⚖️', [['BA LLB', 200000], ['BBA LLB', 200000], ['LLB', 200000]]],
    ['School of Hotel Management', 'B.Sc Hospitality & Hotel Admin.', '🏨', [['Culinary Arts', 175000], ['Travel & Tourism', 175000], ['Hotel Management', 175000]]],
    ['School of Science', 'B.Sc', '🔭', [['Physics', 150000], ['Computer Science', 150000], ['Data Science', 150000], ['Forensics', 150000]]],
    ['School of Liberal Arts', 'BA (Honours)', '📖', [['English', 150000], ['Psychology', 150000], ['Economics', 150000], ['International Studies', 150000]]],
    ['School of Design', 'Certificate in Clay Modelling', '🏺', [['6 Months', 150000], ['3 Months', 90000]]],
  ],
  PG: [
    ['School of Engineering', 'M.Tech', '🔬', [['AI & Machine Learning', 100000], ['Biomedical', 100000], ['Biotechnology', 100000], ['Construction', 100000],
      ['Robotics', 100000], ['Electric Vehicles', 100000]]],
    ['School of Management', 'MBA', '📈', [['Marketing', 350000], ['Finance', 350000]]],
    ['School of Computer Applications', 'MCA', '💻', [['', 210000]]],
    ['School of Design', 'M.Des', '✏️', [['Transportation Design', 700000], ['UI / UX Design', 500000]]],
    ['School of Design', 'PG Diploma in Digital Modelling', '🧊', [['', 275000]]],
    ['School of Law', 'LLM', '🏛️', [['', 200000]]],
    ['School of Liberal Arts', 'MA Psychology', '🧠', [['Industrial Psychology', 150000], ['Counselling Psychology', 150000]]],
    ['School of Hotel Management', 'M.Sc Hospitality & Tourism Mgmt.', '🛎️', [['', 200000]]],
    ['School of Science', 'M.Sc Physics', '⚛️', [['', 175000]]],
  ],
};
// Admissions are for AY 2027-28; until the 2027-28 fee structure is published, the AY 2026-27 fees are shown as indicative.
const FEE_YEAR = 'AY 2027-28, indicative as per AY 2026-27 fee structure';

// Build everything the portal needs from a catalogue in the format above (also used for each college's own catalogue)
function build(catalogue) {
  const LV = Object.fromEntries(Object.entries(catalogue).map(([lv, list]) => [lv, list.map(([school, name, icon, specs]) => {
    const branches = specs.map((x) => x[0]).filter(Boolean);
    return { name, school, icon, ...(branches.length ? { branches } : {}), fee: branches.length ? undefined : specs[0][1],
      fees: branches.length ? Object.fromEntries(specs) : undefined, sub: branches.length ? `${String(school).replace(/^(School|Faculty|Department) of /, '')} · ${branches.length} options` : String(school).replace(/^(School|Faculty|Department) of /, '') };
  })]));
  if (!LV.UG) LV.UG = []; if (!LV.PG) LV.PG = [];
  const FT = Object.entries(LV).flatMap(([lv, list]) => list.flatMap((p) => (p.branches ? p.branches.map((b) => ({ level: lv, school: p.school, programme: p.name, branch: b, fee: p.fees[b] }))
    : [{ level: lv, school: p.school, programme: p.name, branch: '', fee: p.fee }])));
  const tech = [...LV.UG, ...LV.PG].filter((p) => /tech|engineering/i.test(p.name) && p.branches).flatMap((p) => p.branches);
  return { LEVELS: LV, FEE_TABLE: FT, ENGINEERING_BRANCHES: [...new Set(tech)] };
}
const DEFAULT = build(CATALOGUE);
const tenant = require('./tenant');
// the current college's catalogue (ADYPU's by default)
const cat = () => { const t = tenant.als.getStore(); return (t && t.catalogue) || DEFAULT; };
const objProxy = (key) => new Proxy({}, {
  get: (_, p) => cat()[key][p], has: (_, p) => p in cat()[key], ownKeys: () => Reflect.ownKeys(cat()[key]),
  getOwnPropertyDescriptor: (_, p) => (p in cat()[key] ? { value: cat()[key][p], enumerable: true, configurable: true, writable: true } : undefined),
});
const arrProxy = (key) => new Proxy([], { get: (_, p) => { const a = cat()[key]; const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; } });
const LEVELS = objProxy('LEVELS'), FEE_TABLE = arrProxy('FEE_TABLE'), ENGINEERING_BRANCHES = arrProxy('ENGINEERING_BRANCHES');
const feeYear = () => { const t = tenant.als.getStore(); return (t && t.feeYear) || FEE_YEAR; };

// "B.Tech – Civil Engineering" or "MCA"
const courseLabel = (programme, branch) => (branch ? `${programme} – ${branch}` : programme);
function findProgramme(level, programme) { return (LEVELS[level] || []).find((p) => p.name === programme) || null; }
function isValid(level, programme, branch) {
  const p = findProgramme(level, programme);
  if (!p) return false;
  return p.branches ? p.branches.includes(branch) : !branch;
}
// Annual tuition fee for a programme / specialisation (₹), or null if unknown
function tuitionFee(level, programme, branch) {
  const p = findProgramme(level, programme) || [...(LEVELS.UG || []), ...(LEVELS.PG || [])].find((x) => x.name === programme);
  if (!p) return null;
  return p.branches ? (p.fees[branch] ?? null) : p.fee;
}

module.exports = { LEVELS, ENGINEERING_BRANCHES, FEE_YEAR, FEE_TABLE, feeYear, courseLabel, findProgramme, isValid, tuitionFee, build, CATALOGUE };
