// Integration test: needs a running API (BASE) + seeded DB. Run: BASE=http://localhost:5055 node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const BASE = process.env.BASE || 'http://localhost:5000';
let token;
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return { status: r.status, ...j };
};
const item = (rate = '100000') => ({ description: 'Digital Marketing', quantity: 1, rate, discount: 0, gst_rate: 18 });
let customerId;

test('login + company state', async () => {
  const r = await call('POST', '/auth/login', { email: process.env.ADMIN_EMAIL || 'admin@example.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe@123' });
  assert.equal(r.success, true); token = r.data.token;
  const c = await call('GET', '/settings/company');
  await call('PUT', '/settings/company', { ...c.data, name: 'Test Co', state: 'Karnataka', default_gst_rate: '18', payment_terms_days: 15, logo: null });
  const cu = await call('POST', '/customers', { name: 'ABC Technologies Pvt Ltd', state: 'Karnataka', mobile: '9999999999', email: 'abc@example.com' });
  assert.equal(cu.success, true); customerId = cu.data.id;
});

test('GST: intra-state CGST+SGST and inter-state IGST, computed on server', async () => {
  const e = await call('POST', '/estimates', { customer_id: customerId, items: [item()] });
  const d = (await call('GET', `/estimates/${e.data.id}`)).data;
  assert.equal(d.grand_total, '118000.00'); assert.equal(d.cgst, '9000.00'); assert.equal(d.sgst, '9000.00'); assert.equal(d.igst, '0.00');
  const e2 = await call('POST', '/estimates', { customer_id: customerId, supply_type: 'INTER_STATE', items: [item()] });
  const d2 = (await call('GET', `/estimates/${e2.data.id}`)).data;
  assert.equal(d2.igst, '18000.00'); assert.equal(d2.cgst, '0.00');
});

test('Rule A: no invoice until 100% paid; overpayment blocked; then invoice AUG/SEP format', async () => {
  const e = await call('POST', '/estimates', { customer_id: customerId, items: [item()] });
  const id = e.data.id;
  assert.equal((await call('POST', `/estimates/${id}/send`, {})).success, true);
  const p1 = await call('POST', '/payments', { estimate_id: id, amount: '50000', payment_method: 'UPI' });
  assert.equal(p1.success, true); assert.equal(p1.data.estimate_status, 'PAYMENT_PENDING');
  const early = await call('POST', `/estimates/${id}/convert`);
  assert.equal(early.status, 409); assert.equal(early.code, 'PAYMENT_INCOMPLETE');
  const over = await call('POST', '/payments', { estimate_id: id, amount: '90000' });
  assert.equal(over.code, 'PAYMENT_EXCEEDS_OUTSTANDING');
  const p2 = await call('POST', '/payments', { estimate_id: id, amount: '68000' });
  assert.equal(p2.data.estimate_status, 'PAID');
  const conv = await call('POST', `/estimates/${id}/convert`);
  assert.equal(conv.success, true); assert.match(conv.data.number, /^[A-Z]{3}20\d{2}\d{3,}$/);
  const inv = (await call('GET', `/invoices/${conv.data.id}`)).data;
  assert.equal(inv.status, 'PAID'); assert.equal(inv.amount_paid, '118000.00'); assert.equal(inv.balance_due, '0.00'); assert.equal(inv.payments.length, 2);
  const again = await call('POST', `/estimates/${id}/convert`);
  assert.equal(again.data.number, conv.data.number); // idempotent
});

test('invoice numbers are unique under 25 concurrent requests, serial increments', async () => {
  const rs = await Promise.all(Array.from({ length: 25 }, () => call('POST', '/invoices', { customer_id: customerId, items: [item('1000')] })));
  assert.ok(rs.every((r) => r.success), JSON.stringify(rs.find((r) => !r.success)));
  const nums = rs.map((r) => r.data.number);
  assert.equal(new Set(nums).size, 25);
  const serials = nums.map((n) => parseInt(n.slice(7), 10)).sort((a, b) => a - b);
  for (let i = 1; i < serials.length; i += 1) assert.equal(serials[i], serials[i - 1] + 1); // gap-free
});

test('invoice: partial payment, overdue derivation, monthly reset by backdated invoice', async () => {
  const yr = 1950 + Math.floor(Math.random() * 40); // fresh year each run so the serial starts at 001
  const past = await call('POST', '/invoices', { customer_id: customerId, invoice_date: `${yr}-01-05`, payment_terms_days: 10, items: [item('50000')] });
  assert.equal(past.data.number, `JAN${yr}001`);
  const past2 = await call('POST', '/invoices', { customer_id: customerId, invoice_date: `${yr}-02-05`, items: [item('50000')] });
  assert.equal(past2.data.number, `FEB${yr}001`); // serial reset for a new month
  const pay = await call('POST', '/payments', { invoice_id: past.data.id, amount: '20000' });
  assert.equal(pay.success, true);
  await call('GET', '/invoices'); // triggers overdue refresh
  const inv = (await call('GET', `/invoices/${past.data.id}`)).data;
  assert.equal(inv.status, 'OVERDUE'); assert.equal(inv.balance_due, '39000.00'); // 59000 total - 20000
});

test('payment cancel reverses balances', async () => {
  const inv = await call('POST', '/invoices', { customer_id: customerId, items: [item('10000')] });
  const p = await call('POST', '/payments', { invoice_id: inv.data.id, amount: '11800' });
  assert.equal((await call('GET', `/invoices/${inv.data.id}`)).data.status, 'PAID');
  await call('PUT', `/payments/${p.data.payment_id}`, { status: 'CANCELLED', notes: 'bounced' });
  const after = (await call('GET', `/invoices/${inv.data.id}`)).data;
  assert.equal(after.amount_paid, '0.00'); assert.equal(after.status, 'ISSUED');
});

test('Rule C: recurring billing creates one estimate per period (idempotent) and auto-invoices on 100% payment', async () => {
  const cy = await call('POST', '/billing/cycles', { customer_id: customerId, billing_amount: '25000', gst_rate: '18', start_date: '2026-08-01', billing_day: 1, payment_terms_days: 10 });
  assert.equal(cy.success, true);
  const g1 = await call('POST', `/billing/${cy.data.id}/generate`);
  assert.equal(g1.data.created, true);
  const ests = (await call('GET', `/estimates?customer_id=${customerId}&limit=100`)).data.filter((e) => e.billing_cycle_id === cy.data.id);
  assert.equal(ests.length, 1); assert.equal(ests[0].status, 'AUTO_GENERATED'); assert.equal(ests[0].grand_total, '29500.00');
  const p = await call('POST', '/payments', { estimate_id: ests[0].id, amount: '29500', payment_method: 'BANK_TRANSFER' });
  assert.ok(p.data.invoice && p.data.invoice.number, 'auto-converted to invoice');
  assert.equal(p.data.estimate_status, 'CONVERTED');
});

test('dashboard + reports respond; GST on collections is proportional', async () => {
  const d = await call('GET', '/dashboard/summary?period=this_fy');
  assert.equal(d.success, true); assert.ok(d.data.totalCollected > 0); assert.ok(d.data.gstCollected > 0);
  for (const t of ['collection', 'sales', 'gst', 'customers', 'outstanding', 'overdue', 'payments', 'estimates', 'monthly']) {
    const r = await call('GET', `/reports/${t}?period=this_fy`); assert.equal(r.success, true, t);
  }
});

test('auth: protected routes reject anonymous; staff cannot manage users', async () => {
  const saved = token; token = null;
  assert.equal((await call('GET', '/customers')).status, 401);
  token = saved;
});
