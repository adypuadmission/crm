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
const FEE_YEAR = 'AY 2026-27';

const LEVELS = Object.fromEntries(Object.entries(CATALOGUE).map(([lv, list]) => [lv, list.map(([school, name, icon, specs]) => {
  const branches = specs.map((s) => s[0]).filter(Boolean);
  return { name, school, icon, ...(branches.length ? { branches } : {}), fee: branches.length ? undefined : specs[0][1],
    fees: branches.length ? Object.fromEntries(specs) : undefined, sub: branches.length ? `${school.replace('School of ', '')} · ${branches.length} options` : school.replace('School of ', '') };
})]));
// Engineering specialisations (B.Tech + M.Tech) — used by the chatbot and the QR poster
const ENGINEERING_BRANCHES = [...LEVELS.UG[0].branches, ...LEVELS.PG[0].branches];

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
  const p = findProgramme(level, programme) || [...LEVELS.UG, ...LEVELS.PG].find((x) => x.name === programme);
  if (!p) return null;
  return p.branches ? (p.fees[branch] ?? null) : p.fee;
}
// Every programme as a flat list (for the fee table)
const FEE_TABLE = Object.entries(LEVELS).flatMap(([lv, list]) => list.flatMap((p) => (p.branches ? p.branches.map((b) => ({ level: lv, school: p.school, programme: p.name, branch: b, fee: p.fees[b] }))
  : [{ level: lv, school: p.school, programme: p.name, branch: '', fee: p.fee }])));

module.exports = { LEVELS, ENGINEERING_BRANCHES, FEE_YEAR, FEE_TABLE, courseLabel, findProgramme, isValid, tuitionFee };
