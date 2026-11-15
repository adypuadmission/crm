// Single source of truth for programmes: Level (UG / PG) → Programme → Branch (engineering only).
// Used by the form, server validation, chatbot, filters and reports.
const ENGINEERING_BRANCHES = [
  'Computer Science & Engineering',
  'Software Engineering',
  'Cybersecurity',
  'AI & Data Science',
  'Biomedical Engineering',
  'Biotechnology',
  'Mechanical Engineering',
  'Robotics & Automation',
  'Electronics & Computer Engineering',
  'Civil Engineering',
];

const LEVELS = {
  UG: [
    { name: 'B.Tech', branches: ENGINEERING_BRANCHES },
    { name: 'Law' },
    { name: 'Design' },
    { name: 'Hotel Management' },
  ],
  PG: [
    { name: 'M.Tech', branches: ENGINEERING_BRANCHES },
    { name: 'MBA' },
    { name: 'MCA' },
  ],
};

// "B.Tech – Mechanical Engineering" or "MBA"
const courseLabel = (programme, branch) => (branch ? `${programme} – ${branch}` : programme);

function findProgramme(level, programme) {
  return (LEVELS[level] || []).find((p) => p.name === programme) || null;
}
function isValid(level, programme, branch) {
  const p = findProgramme(level, programme);
  if (!p) return false;
  return p.branches ? p.branches.includes(branch) : !branch;
}

module.exports = { LEVELS, ENGINEERING_BRANCHES, courseLabel, findProgramme, isValid };
