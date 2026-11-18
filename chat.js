// "Ask ADYPU" chatbot. Works offline from the knowledge base below (facts taken from adypu.edu.in).
// If ANTHROPIC_API_KEY is set, questions are answered by Claude, grounded on the same knowledge base
// and told not to invent facts. Keep this file updated when university details change.
const { LEVELS, ENGINEERING_BRANCHES, FEE_TABLE, FEE_YEAR } = require('./courses');
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const normP = (x) => String(x).toLowerCase().replace(/[^a-z]/g, '');
function feeReply(t) {
  const words = (x) => String(x).toLowerCase().replace(/\./g, '').replace(/\((honours|hons)\)|admin|mgmt|&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = ` ${words(t)} `, qc = q.replace(/ /g, '');
  const progs = [...new Set(FEE_TABLE.map((r) => r.programme))].filter((p) => { const k = words(p); return q.includes(` ${k} `) || (k.length > 4 && qc.includes(k.replace(/ /g, ''))) || (k === 'law' && /\b(llb|law)\b/.test(q)) || (/hospitality|tourism/.test(k) && /\b(hotel|hospitality|tourism|culinary)\b/.test(q)) || (k === 'ma psychology' && /\bma\b.*psycholog/.test(q)); })
    .filter((p, _, all) => !(all.some((x) => /hospitality/i.test(x)) && /^B\.Sc$|^M\.Sc Physics$/.test(p) && /\b(hotel|hospitality|tourism)\b/.test(q)));
  const rows = progs.length ? FEE_TABLE.filter((r) => progs.includes(r.programme)) : [];
  if (rows.length) return `Annual tuition fees (${FEE_YEAR}):\n` + rows.map((r) => `• ${r.programme}${r.branch ? ' – ' + r.branch : ''}: **${inr(r.fee)}**`).join('\n') + '\n\nHostel, exam and other charges are extra. The admissions team will confirm the full fee and any scholarship.';
  const by = {}; FEE_TABLE.forEach((r) => { by[r.programme] = by[r.programme] || []; by[r.programme].push(r.fee); });
  return `Annual tuition fees (${FEE_YEAR}) start from:\n` + Object.entries(by).map(([p, f]) => `• ${p}: ${Math.min(...f) === Math.max(...f) ? inr(f[0]) : inr(Math.min(...f)) + ' – ' + inr(Math.max(...f))}`).join('\n') + '\n\nAsk e.g. "B.Tech fees" for each specialisation.';
}
const COURSES = LEVELS;
const CONTACTS = require('./contacts');
const fmtPh = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const queryContacts = () => CONTACTS.map((c) => `• **${c.name}:** ${fmtPh(c.phone)}`).join('\n');

const KB = {
  address: 'D Y Patil Knowledge City, Charholi Bk., Via Lohegaon, Pune – 411081, Maharashtra',
  email: 'info@adypu.edu.in',
  officeHours: 'Mon–Fri, 9:30 am – 5:30 pm',
  admissionHours: 'Mon–Sat, 9:30 am – 6:30 pm and Sun, 9:30 am – 5:30 pm',
  phones: {
    Engineering: '+91 89564 87911, +91 91750 67360', Management: '+91 89564 87916', Design: '+91 89564 87916',
    Law: '+91 91750 69861, +91 90289 54966', 'Liberal Arts': '+91 98232 63300', 'Hotel Management': '+91 79062 85013',
  },
  schools: ['Engineering', 'Management', 'Design', 'Hospitality & Hotel Administration', 'Law', 'Liberal Arts', 'Architecture', 'Film & Media', 'Science', 'Allied Health Sciences'],
  centres: ['Center for Advanced Indian Sciences', 'Center for Distance and Online Education (adypuonline.com)'],
  links: {
    apply: 'https://admissions.adypu.edu.in', howToApply: 'https://adypu.edu.in/how-to-apply/', eligibility: 'https://adypu.edu.in/eligibility-for-admission/',
    acet: 'https://adypu.edu.in/admissions/about-acet', ug: 'https://adypu.edu.in/undergraduate-programs', pg: 'https://adypu.edu.in/postgraduate-programs',
    phd: 'https://adypu.edu.in/doctoral-program', contact: 'https://adypu.edu.in/contact-us', placements: 'https://adypu.edu.in/placements/',
    tour: 'https://adypu.edu.in/campus-tour', disclosures: 'https://adypu.edu.in/admissions/mandatory-disclosures', site: 'https://adypu.edu.in',
  },
};

const L = (url, label) => `[${label}](${url})`;
const phoneList = () => Object.entries(KB.phones).map(([k, v]) => `• **${k}:** ${v}`).join('\n');
const programmeHint = (text) => {
  const t = text.toLowerCase();
  if (/[bm]\.?\s?tech|engineer|cse|computer|cyber|software|\bai\b|data science|biomedical|biotech|mechanical|robotic|automation|electronic|civil/.test(t)) return 'Engineering';
  if (/mba|management|bba/.test(t)) return 'Management';
  if (/law|llb|legal/.test(t)) return 'Law';
  if (/design|b\.?des/.test(t)) return 'Design';
  if (/hotel|hospitality|bhm/.test(t)) return 'Hotel Management';
  if (/mca/.test(t)) return 'Engineering';
  return null;
};
const callSchool = (text) => {
  const s = programmeHint(text);
  return `Please call ${CONTACTS.map((c) => `**${c.name}** (${fmtPh(c.phone)})`).join(' or ')}` + (s ? `, or the **School of ${s}** admissions team on **${KB.phones[s]}**.` : '.');
};

const INTENTS = [
  { id: 'greet', re: /^(hi|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b/i,
    reply: () => "Hello! 👋 I'm the ADYPU admission assistant. Ask me about programmes, how to apply, contact numbers, campus life or office hours." },
  { id: 'programmes', re: /programme|program|course|branch|speciali[sz]ation|[bm]\.?\s?tech|mba|mca|degree|offer|\bug\b|\bpg\b|post ?grad|under ?grad|mechanical|civil|robotic/i,
    reply: () => `ADYPU offers undergraduate, postgraduate and Ph.D. programmes, with **75+ undergraduate specialisations**, a flexible NEP 2020–aligned curriculum and minors.\n\n**On this enquiry form (AY 2026-27):**\n🎓 **UG:** ${LEVELS.UG.map((p) => p.name).join(', ')}\n🎓 **PG:** ${LEVELS.PG.map((p) => p.name).join(', ')}\n⚙️ **B.Tech branches:** ${LEVELS.UG[0].branches.join(', ')}\n\n**Schools:** ${KB.schools.join(', ')}.\n\nFull lists: ${L(KB.links.ug, 'UG programmes')} · ${L(KB.links.pg, 'PG programmes')} · ${L(KB.links.phd, 'Ph.D.')}` },
  { id: 'apply', re: /apply|application|admission process|how (do|can|to) (i )?(get|take|join)|register|procedure|steps|acet|entrance|cet\b/i,
    reply: () => `**How to apply:**\n1. Submit this enquiry form so a counsellor can guide you.\n2. Apply online on the ${L(KB.links.apply, 'ADYPU admissions portal')}.\n3. Some programmes use the **ADYPU Common Entrance Test (ACET)**. See ${L(KB.links.acet, 'About ACET')}.\n\nDetails: ${L(KB.links.howToApply, 'How to apply')} · ${L(KB.links.eligibility, 'Eligibility')}` },
  { id: 'eligibility', re: /eligib|criteria|percentage|marks|qualif|12th|hsc|jee|mht/i,
    reply: (t) => `Eligibility differs by programme. See the ${L(KB.links.eligibility, 'eligibility page')}, or for an exact answer: ${callSchool(t)}` },
  { id: 'fees', re: /fee|fees|cost|price|tuition|charges|kitni|kiti/i,
    reply: (t) => feeReply(t) },
  { id: 'scholarship', re: /scholar|discount|concession|financial aid|loan/i,
    reply: (t) => `ADYPU lists scholarships, but criteria and amounts are shared by the admissions team. ${callSchool(t)}` },
  { id: 'hostel', re: /hostel|accommodation|stay|room|mess|food|pg\b/i,
    reply: () => `For hostel and accommodation details please email **${KB.email}** or call the admissions team of your school:\n${phoneList()}` },
  { id: 'placements', re: /placement|job|recruit|package|salary|company|internship/i,
    reply: (t) => `Placement information is on the ${L(KB.links.placements, 'placements page')}. For figures for your programme: ${callSchool(t)}` },
  { id: 'contact', re: /contact|phone|number|call|mobile|whatsapp|email|mail|helpline|talk/i,
    reply: (t) => { const sc = programmeHint(t);
      return `📞 **For further connection & queries:**\n${queryContacts()}\n\n` + (sc ? `**School of ${sc} admissions:** ${KB.phones[sc]}\n✉️ ${KB.email}`
        : `**School admissions desks:**\n${phoneList()}\n\n✉️ ${KB.email}\n🕘 Admissions office: ${KB.admissionHours} (IST)`); } },
  { id: 'hours', re: /time|timing|hours|open|close|sunday|saturday|visit/i,
    reply: () => `🕘 **Admissions office:** ${KB.admissionHours} (IST)\n🏢 **General office:** ${KB.officeHours} (IST, except public holidays)\n\nYou can also take a ${L(KB.links.tour, 'virtual campus tour')}.` },
  { id: 'location', re: /where|location|address|reach|map|direction|campus|lohegaon|charholi|pune/i,
    reply: () => `📍 **${KB.address}**\n\nThe campus is in D Y Patil Knowledge City on the Lohegaon side of Pune. Take a ${L(KB.links.tour, 'virtual campus tour')}.` },
  { id: 'life', re: /club|event|fest|sport|cultur|life|activit|impetus|incubat|startup|entrepreneur/i,
    reply: () => `🎉 **Campus life at ADYPU:**\n• **Impetus**, the annual sports event (football, cricket, basketball, volleyball, athletics, badminton, table tennis, chess and more)\n• **#TECH**, **Ablaze**, **Chatori Galli** and **Alchemy** (School of Design), plus a **National Moot Court** (School of Law)\n• Clubs, a Wellness Centre, an Incubator and an Entrepreneurship & Innovation Centre` },
  { id: 'international', re: /international|abroad|foreign|exchange|global|mou|collaborat/i,
    reply: () => 'ADYPU has partnerships with universities in the US, UK and Europe, immersion programmes and an International Academic Council. A Mid Sweden University delegation recently visited to strengthen academic collaboration.' },
  { id: 'approval', re: /ugc|aicte|approv|recogni|accredit|naac|nirf|rank|valid|genuine|disclos/i,
    reply: () => `For official approvals and recognitions, please see the university's ${L(KB.links.disclosures, 'mandatory disclosures page')}.` },
  { id: 'phd', re: /ph\.?d|doctoral|research/i,
    reply: () => `ADYPU runs a doctoral (Ph.D.) programme. Details: ${L(KB.links.phd, 'Doctoral programme')}. For specifics, email ${KB.email}.` },
  { id: 'online', re: /online|distance|cdoe|remote/i,
    reply: () => 'ADYPU has a **Center for Distance and Online Education**. Visit adypuonline.com for its programmes.' },
  { id: 'callback', re: /call ?back|callback|counsel|guide me|help me choose|confused/i,
    reply: () => "I'd be happy to get a counsellor to call you! 📞 Fill in the enquiry form on this page (it takes under a minute) and our team will contact you." },
  { id: 'thanks', re: /thank|thanks|dhanyavad|shukriya|ok|great|nice/i,
    reply: () => "You're welcome! 😊 All the best for your journey. Anything else I can help with?" },
];

// Most specific intents first, so "fees for B.Tech" is about fees, not programmes.
const ORDER = ['greet', 'callback', 'fees', 'scholarship', 'eligibility', 'apply', 'hostel', 'placements', 'approval', 'phd', 'online',
  'international', 'life', 'hours', 'contact', 'location', 'programmes', 'thanks'];
INTENTS.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
INTENTS.find((i) => i.id === 'greet').re = /^(hi+|hello|hey|namaste|namaskar|good (morning|afternoon|evening))[\s!.]*$/i;
INTENTS.find((i) => i.id === 'thanks').re = /\b(thank(s| you)?|dhanyavad|shukriya|ok(ay)?|great|nice)\b/i;

const CHIPS = ['Programmes', 'How to apply', 'Contact numbers', 'Fees', 'Hostel', 'Campus life', 'Location', 'Request a call back'];
const FALLBACK = () => `I'm not sure about that one. For further connection & queries, please call:\n${queryContacts()}\n\nor email **${KB.email}**.`;

function ruleAnswer(text) {
  const t = String(text || '').trim();
  const hit = INTENTS.find((i) => i.re.test(t));
  return { reply: hit ? hit.reply(t) : FALLBACK(), intent: hit ? hit.id : 'fallback', chips: CHIPS };
}

// Optional: Claude, grounded on the knowledge base.
const SYSTEM_PREFIX = () => `Contact persons for further connection and queries (always offer these first): ${CONTACTS.map((c) => `${c.name} ${fmtPh(c.phone)}`).join('; ')}.\n`;
const SYSTEM = `You are "Ask ADYPU", the friendly admissions assistant on the Ajeenkya DY Patil University (ADYPU), Pune enquiry page.
Answer ONLY from the facts below. If the answer is not in the facts (e.g. eligibility percentages, hostel charges, placement numbers, dates), say you don't have that detail and give the relevant school's admissions phone number and ${KB.email}. Never invent numbers, rankings or approvals.
Keep answers short (under 90 words), warm and encouraging, suitable for students and parents. Reply in the user's language (English, Hindi or Marathi). Use **bold** for key items and [label](url) for links. Encourage filling the enquiry form on this page for a counsellor call-back.

FACTS:
${JSON.stringify({ ...KB, formProgrammes: COURSES, ugSpecialisations: '75+', curriculum: 'Flexible, NEP 2020 aligned, minors, interdisciplinary T-shaped approach',
  admissions: 'Applications open via admissions.adypu.edu.in; ADYPU Common Entrance Test (ACET) for some programmes',
  campusLife: 'Impetus annual sports event; #TECH, Ablaze, Chatori Galli, Alchemy (Design), National Moot Court (Law); clubs; Wellness Centre; Incubator; Entrepreneurship & Innovation Centre',
  international: 'Partnerships with universities in the US, UK and Europe; immersion programmes; International Academic Council; Mid Sweden University delegation visit' })}`;

async function answer(text, history = []) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return ruleAnswer(text);
  try {
    const msgs = [...history.slice(-6).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) })), { role: 'user', content: String(text).slice(0, 800) }];
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.CHAT_MODEL || 'claude-haiku-5-5', max_tokens: 400, system: SYSTEM_PREFIX() + SYSTEM, messages: msgs }),
    });
    const j = await r.json();
    const reply = j?.content?.map((c) => c.text || '').join('').trim();
    if (!r.ok || !reply) throw new Error(JSON.stringify(j).slice(0, 200));
    return { reply, intent: 'ai', chips: CHIPS };
  } catch (e) {
    console.error('Chat AI error, using knowledge base:', e.message);
    return ruleAnswer(text);
  }
}

module.exports = { answer, CHIPS };
