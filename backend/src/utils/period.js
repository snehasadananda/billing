const { today, addDays, parse, fmt, daysInMonth, addMonths } = require('./dates');

/** Indian financial year start year for a date (FY starts 1 April). */
function fyStartYear(dateStr) {
  const { y, m } = parse(dateStr);
  return m >= 4 ? y : y - 1;
}

/**
 * Resolve a named period to { from, to, label } (inclusive, YYYY-MM-DD).
 * period: today | this_week | this_month | prev_month | this_quarter | this_fy | prev_fy |
 *         this_year | prev_year | custom | all
 */
function resolvePeriod(period = 'this_month', customFrom, customTo, now = today()) {
  const { y, m, d } = parse(now);
  switch (period) {
    case 'today': return { from: now, to: now, label: 'Today' };
    case 'this_week': {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      const monday = addDays(now, -((dow + 6) % 7));
      return { from: monday, to: addDays(monday, 6), label: 'This Week' };
    }
    case 'this_month': return { from: fmt(y, m, 1), to: fmt(y, m, daysInMonth(y, m)), label: 'This Month' };
    case 'prev_month': {
      const first = addMonths(fmt(y, m, 1), -1, 1);
      const p = parse(first);
      return { from: first, to: fmt(p.y, p.m, daysInMonth(p.y, p.m)), label: 'Previous Month' };
    }
    case 'this_quarter': { // Indian FY quarters: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar
      const offset = (m - 4 + 12) % 12;
      const start = addMonths(fmt(y, m, 1), -(offset % 3), 1);
      const end = addMonths(start, 2, 1);
      const pe = parse(end);
      return { from: start, to: fmt(pe.y, pe.m, daysInMonth(pe.y, pe.m)), label: 'This Quarter' };
    }
    case 'this_fy': { const s = fyStartYear(now); return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` }; }
    case 'prev_fy': { const s = fyStartYear(now) - 1; return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` }; }
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Calendar ${y}` };
    case 'prev_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `Calendar ${y - 1}` };
    case 'all': return { from: '1970-01-01', to: '2999-12-31', label: 'All time' };
    case 'custom':
    default: {
      if (customFrom && customTo) return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` };
      return { from: fmt(y, m, 1), to: fmt(y, m, daysInMonth(y, m)), label: 'This Month' };
    }
  }
}

module.exports = { resolvePeriod, fyStartYear };
