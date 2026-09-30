const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr = (v) => `₹${nf.format(Number(v || 0))}`;
export const num = (v) => nf.format(Number(v || 0));
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}-${M[+m - 1]}-${y}`; };
export const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in browser's local zone
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const label = (s) => String(s || '').replace(/_/g, ' ');

export const STATUS_COLOR = {
  DRAFT: 'gray', AUTO_GENERATED: 'blue', SENT: 'blue', VIEWED: 'blue', ACCEPTED: 'teal', REJECTED: 'red', EXPIRED: 'gray', PAYMENT_PENDING: 'amber', PAID: 'green',
  CONVERTED: 'green', CANCELLED: 'red', ISSUED: 'blue', PARTIALLY_PAID: 'amber', OVERDUE: 'red', VOID: 'gray', ACTIVE: 'green', INACTIVE: 'gray', PAUSED: 'amber', ENDED: 'gray', VALID: 'green',
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'PAYMENT_GATEWAY', 'OTHER'];
export const TERMS = [[0, 'Immediate'], [7, '7 Days'], [15, '15 Days'], [30, '30 Days'], [45, '45 Days'], [60, '60 Days']];
export const PERIODS = [['today', 'Today'], ['this_week', 'This Week'], ['this_month', 'This Month'], ['prev_month', 'Previous Month'], ['this_quarter', 'This Quarter'], ['this_fy', 'This Financial Year'], ['prev_fy', 'Previous Financial Year'], ['this_year', 'This Calendar Year'], ['all', 'All Time'], ['custom', 'Custom Range']];
export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
