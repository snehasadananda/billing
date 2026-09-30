const env = require('../config/env');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Today's date (YYYY-MM-DD) in the business timezone. */
function today(tz = env.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const parse = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
};
const fmt = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addDays(dateStr, n) {
  const { y, m, d } = parse(dateStr);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from a to b (b - a) */
function diffDays(a, b) {
  const pa = parse(a); const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}
/** Add months keeping a preferred day-of-month (clamped to month length). */
function addMonths(dateStr, n, preferredDay) {
  const { y, m, d } = parse(dateStr);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const day = Math.min(preferredDay || d, daysInMonth(ny, nm));
  return fmt(ny, nm, day);
}
const monthAbbr = (dateStr) => MONTHS[parse(dateStr).m - 1];
const yearOf = (dateStr) => parse(dateStr).y;
const monthOf = (dateStr) => parse(dateStr).m;
const periodOf = (dateStr) => dateStr.slice(0, 7); // YYYY-MM
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

module.exports = { today, addDays, diffDays, addMonths, monthAbbr, yearOf, monthOf, periodOf, isValidDate, parse, fmt, daysInMonth, MONTHS };
