// City / district → region mapping. Maharashtra districts map to their administrative
// division; other entries map to the state name. Anything unknown becomes "Other".
const MH_DIVISIONS = {
  'Pune Division': ['Pune', 'Pimpri-Chinchwad', 'Pimpri Chinchwad', 'Satara', 'Sangli', 'Kolhapur', 'Solapur', 'Baramati'],
  'Konkan / Mumbai Division': ['Mumbai', 'Mumbai City', 'Mumbai Suburban', 'Navi Mumbai', 'Thane', 'Palghar', 'Raigad', 'Ratnagiri', 'Sindhudurg', 'Kalyan', 'Panvel', 'Vasai-Virar'],
  'Nashik Division': ['Nashik', 'Ahmednagar', 'Ahilyanagar', 'Dhule', 'Jalgaon', 'Nandurbar'],
  'Chhatrapati Sambhajinagar Division': ['Chhatrapati Sambhajinagar', 'Aurangabad', 'Jalna', 'Beed', 'Latur', 'Dharashiv', 'Osmanabad', 'Nanded', 'Parbhani', 'Hingoli'],
  'Amravati Division': ['Amravati', 'Akola', 'Buldhana', 'Washim', 'Yavatmal'],
  'Nagpur Division': ['Nagpur', 'Wardha', 'Bhandara', 'Gondia', 'Chandrapur', 'Gadchiroli'],
};
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
  'Chandigarh', 'Puducherry', 'Andaman and Nicobar Islands', 'Lakshadweep', 'Dadra and Nagar Haveli and Daman and Diu'];
// A few big non-Maharashtra cities, so typing a city still finds its state.
const CITY_STATE = {
  'Bengaluru': 'Karnataka', 'Bangalore': 'Karnataka', 'Hyderabad': 'Telangana', 'Chennai': 'Tamil Nadu', 'Kolkata': 'West Bengal',
  'Ahmedabad': 'Gujarat', 'Surat': 'Gujarat', 'Vadodara': 'Gujarat', 'Indore': 'Madhya Pradesh', 'Bhopal': 'Madhya Pradesh',
  'Jaipur': 'Rajasthan', 'Lucknow': 'Uttar Pradesh', 'Patna': 'Bihar', 'Ranchi': 'Jharkhand', 'Raipur': 'Chhattisgarh',
  'New Delhi': 'Delhi', 'Gurugram': 'Haryana', 'Noida': 'Uttar Pradesh', 'Panaji': 'Goa', 'Belagavi': 'Karnataka', 'Belgaum': 'Karnataka',
  'Guwahati': 'Assam', 'Bhubaneswar': 'Odisha', 'Kochi': 'Kerala', 'Thiruvananthapuram': 'Kerala', 'Dehradun': 'Uttarakhand', 'Srinagar': 'Jammu and Kashmir',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const LOOKUP = new Map();
for (const [div, list] of Object.entries(MH_DIVISIONS)) list.forEach((c) => LOOKUP.set(norm(c), { city: c, region: div, state: 'Maharashtra' }));
for (const s of STATES) LOOKUP.set(norm(s), { city: s, region: s, state: s });
for (const [c, s] of Object.entries(CITY_STATE)) LOOKUP.set(norm(c), { city: c, region: s, state: s });
LOOKUP.set(norm('Maharashtra'), { city: 'Maharashtra', region: 'Maharashtra (other)', state: 'Maharashtra' });

function resolveRegion(city) {
  const hit = LOOKUP.get(norm(city));
  return hit ? { region: hit.region, state: hit.state } : { region: 'Other', state: '' };
}
// Suggestions shown to students while typing.
const CITY_SUGGESTIONS = [...Object.values(MH_DIVISIONS).flat().filter((c, i, a) => a.indexOf(c) === i && !/ City| Suburban|Osmanabad|Aurangabad|Ahmednagar|Pimpri Chinchwad/.test(c)),
  ...Object.keys(CITY_STATE).filter((c) => !['Bangalore', 'Belgaum'].includes(c)), ...STATES].sort();
const REGIONS = [...Object.keys(MH_DIVISIONS), 'Maharashtra (other)', ...STATES, 'Other'];

module.exports = { resolveRegion, CITY_SUGGESTIONS, REGIONS };
