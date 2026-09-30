/**
 * Ledger service: estimates, invoices and payments.
 * Every function that changes money takes an open transaction connection (`conn`) and takes row locks
 * (SELECT ... FOR UPDATE) so concurrent requests are serialized and numbering/payment checks are race-free.
 */
const { pool } = require('../config/db');
const { D, money } = require('../utils/money');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { today, addDays } = require('../utils/dates');
const { nextInvoiceNumber, nextEstimateNumber, nextReceiptNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const { computeDocument, detectSupplyType, meetsConversionThreshold, deriveInvoiceStatus } = require('./calc');
const { getSettings } = require('./settings');
const { notify } = require('./notifications');

const PAYABLE_ESTIMATE_STATUSES = ['AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED', 'PAYMENT_PENDING'];
const EDITABLE_ESTIMATE_STATUSES = ['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED'];
const PAYABLE_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

/* ------------------------------------------------------------------ helpers */

async function getCompany(db, companyId) {
  const [[c]] = await db.query('SELECT * FROM companies WHERE id=?', [companyId]);
  if (!c) throw notFound('Company');
  return c;
}
async function getCustomer(db, companyId, id) {
  const [[c]] = await db.query('SELECT * FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL', [id, companyId]);
  if (!c) throw badRequest('CUSTOMER_NOT_FOUND', 'Customer not found');
  return c;
}
const fullAddress = (c, which = 'billing') => {
  const line = which === 'shipping' ? (c.shipping_address || c.billing_address) : c.billing_address;
  return [line, c.city, c.state, c.pin_code].filter(Boolean).join(', ') || null;
};

/** Build header + computed items/totals from an API payload. */
async function prepareDocument(db, companyId, payload, dateField) {
  const company = await getCompany(db, companyId);
  const customer = await getCustomer(db, companyId, payload.customer_id);
  const supply_type = detectSupplyType(company.state, customer.state, payload.supply_type);
  const defaultRate = customer.default_gst_rate != null ? customer.default_gst_rate : company.default_gst_rate;
  const items = payload.items.map((it) => ({ ...it, gst_rate: it.gst_rate != null && it.gst_rate !== '' ? it.gst_rate : defaultRate }));
  const { items: computed, totals } = computeDocument(items, supply_type);
  const docDate = payload[dateField] || today();
  const terms_days = payload.payment_terms_days != null ? payload.payment_terms_days
    : (customer.payment_terms_days != null ? customer.payment_terms_days : company.payment_terms_days);
  return {
    company, customer, supply_type, computed, totals, docDate, terms_days,
    due_date: addDays(docDate, Number(terms_days)),
    header: {
      customer_id: customer.id,
      customer_name: customer.company_name || customer.name,
      customer_gstin: customer.gstin || null,
      billing_address: fullAddress(customer, 'billing'),
      shipping_address: fullAddress(customer, 'shipping'),
    },
  };
}

async function validPaid(conn, where, id) {
  const [[r]] = await conn.query(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE ${where}=? AND status='VALID'`, [id]);
  return D(r.paid);
}

/* ------------------------------------------------------------------ estimates */

async function insertEstimateItems(conn, estimateId, items) {
  for (const it of items) {
    await conn.query(
      `INSERT INTO estimate_items (estimate_id, sort_order, description, hsn_sac, quantity, unit, rate, discount, taxable_amount, gst_rate, gst_amount, total_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [estimateId, it.sort_order, it.description, it.hsn_sac, it.quantity, it.unit, it.rate, it.discount, it.taxable_amount, it.gst_rate, it.gst_amount, it.total_amount]
    );
  }
}

async function createEstimate(conn, { companyId, user, req, payload, status = 'DRAFT', cycle = null, billingPeriod = null }) {
  const settings = await getSettings(conn, companyId);
  const p = await prepareDocument(conn, companyId, payload, 'estimate_date');
  const number = await nextEstimateNumber(conn, companyId, p.docDate);
  const valid_until = payload.valid_until || addDays(p.docDate, settings.num('estimate_validity_days') || 15);
  const t = p.totals;
  const [r] = await conn.query(
    `INSERT INTO estimates (company_id, customer_id, estimate_number, estimate_date, valid_until, due_date, payment_terms_days, supply_type,
       customer_name, customer_gstin, billing_address, shipping_address, subtotal, discount, taxable_amount, cgst, sgst, igst, gst_total,
       grand_total, amount_paid, balance_due, status, billing_cycle_id, billing_period, notes, terms, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
    [companyId, p.header.customer_id, number, p.docDate, valid_until, p.due_date, p.terms_days, p.supply_type,
      p.header.customer_name, p.header.customer_gstin, p.header.billing_address, p.header.shipping_address,
      t.subtotal, t.discount, t.taxable_amount, t.cgst, t.sgst, t.igst, t.gst_total, t.grand_total, t.grand_total,
      status, cycle ? cycle.id : null, billingPeriod, payload.notes || null,
      payload.terms !== undefined && payload.terms !== null ? payload.terms : p.company.terms_and_conditions, user ? user.id : null]
  );
  await insertEstimateItems(conn, r.insertId, p.computed);
  await audit(conn, { req, user, companyId, action: 'CREATE', module: 'ESTIMATE', recordId: r.insertId, newValue: { number, grand_total: t.grand_total, status } });
  return { id: r.insertId, number };
}

async function lockEstimate(conn, companyId, id) {
  const [[e]] = await conn.query('SELECT * FROM estimates WHERE id=? AND company_id=? FOR UPDATE', [id, companyId]);
  if (!e) throw notFound('Estimate');
  return e;
}

async function updateEstimate(conn, { companyId, user, req, id, payload }) {
  const e = await lockEstimate(conn, companyId, id);
  if (!EDITABLE_ESTIMATE_STATUSES.includes(e.status)) throw conflict('NOT_EDITABLE', `An estimate in ${e.status} status cannot be edited`);
  if (D(e.amount_paid).gt(0)) throw conflict('NOT_EDITABLE', 'An estimate that already has payments cannot be edited');
  const p = await prepareDocument(conn, companyId, payload, 'estimate_date');
  const t = p.totals;
  await conn.query(
    `UPDATE estimates SET customer_id=?, estimate_date=?, valid_until=?, due_date=?, payment_terms_days=?, supply_type=?, customer_name=?, customer_gstin=?,
       billing_address=?, shipping_address=?, subtotal=?, discount=?, taxable_amount=?, cgst=?, sgst=?, igst=?, gst_total=?, grand_total=?, balance_due=?,
       notes=?, terms=? WHERE id=?`,
    [p.header.customer_id, p.docDate, payload.valid_until || e.valid_until, p.due_date, p.terms_days, p.supply_type, p.header.customer_name, p.header.customer_gstin,
      p.header.billing_address, p.header.shipping_address, t.subtotal, t.discount, t.taxable_amount, t.cgst, t.sgst, t.igst, t.gst_total, t.grand_total, t.grand_total,
      payload.notes || null, payload.terms !== undefined ? payload.terms : e.terms, id]
  );
  await conn.query('DELETE FROM estimate_items WHERE estimate_id=?', [id]);
  await insertEstimateItems(conn, id, p.computed);
  await audit(conn, { req, user, companyId, action: 'UPDATE', module: 'ESTIMATE', recordId: id, oldValue: { grand_total: e.grand_total }, newValue: { grand_total: t.grand_total } });
  return id;
}

/** send | accept | reject | cancel */
async function changeEstimateStatus(conn, { companyId, user, req, id, action, sentByEmail = false }) {
  const e = await lockEstimate(conn, companyId, id);
  const hasPayments = D(e.amount_paid).gt(0);
  let next;
  switch (action) {
    case 'send':
      if (!['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED'].includes(e.status)) throw conflict('INVALID_STATUS', `Cannot send an estimate in ${e.status} status`);
      next = e.status === 'AUTO_GENERATED' ? 'AUTO_GENERATED' : 'SENT';
      await conn.query('UPDATE estimates SET status=?, sent_at=UTC_TIMESTAMP() WHERE id=?', [next, id]);
      break;
    case 'accept':
      if (!['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED'].includes(e.status)) throw conflict('INVALID_STATUS', `Cannot accept an estimate in ${e.status} status`);
      next = 'ACCEPTED';
      await conn.query('UPDATE estimates SET status=?, accepted_at=UTC_TIMESTAMP() WHERE id=?', [next, id]);
      break;
    case 'reject':
      if (hasPayments || !['SENT', 'VIEWED', 'ACCEPTED', 'AUTO_GENERATED'].includes(e.status)) throw conflict('INVALID_STATUS', 'This estimate cannot be rejected');
      next = 'REJECTED';
      await conn.query('UPDATE estimates SET status=? WHERE id=?', [next, id]);
      break;
    case 'cancel':
      if (hasPayments) throw conflict('HAS_PAYMENTS', 'Cancel the recorded payments first');
      if (['CONVERTED', 'CANCELLED'].includes(e.status)) throw conflict('INVALID_STATUS', `Estimate is already ${e.status}`);
      next = 'CANCELLED';
      await conn.query('UPDATE estimates SET status=? WHERE id=?', [next, id]);
      break;
    default: throw badRequest('INVALID_ACTION', 'Unknown action');
  }
  await audit(conn, { req, user, companyId, action: action.toUpperCase(), module: 'ESTIMATE', recordId: id, oldValue: { status: e.status }, newValue: { status: next, sentByEmail } });
  return next;
}

/** Recompute paid/balance/status for an (unconverted) estimate from its valid payments. */
async function recalcEstimate(conn, id) {
  const [[e]] = await conn.query('SELECT id, grand_total, status FROM estimates WHERE id=?', [id]);
  if (!e || ['CONVERTED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'DRAFT'].includes(e.status)) return e;
  const paid = await validPaid(conn, 'estimate_id', id);
  const balance = D(e.grand_total).minus(paid);
  let status = e.status;
  if (balance.lte(0)) status = 'PAID';
  else if (paid.gt(0)) status = 'PAYMENT_PENDING';
  else if (['PAID', 'PAYMENT_PENDING'].includes(e.status)) status = 'ACCEPTED';
  await conn.query(
    'UPDATE estimates SET amount_paid=?, balance_due=?, status=?, accepted_at=COALESCE(accepted_at, IF(?=\'PAID\' OR ?=\'PAYMENT_PENDING\', UTC_TIMESTAMP(), NULL)) WHERE id=?',
    [money(paid), money(balance.lt(0) ? 0 : balance), status, status, status, id]
  );
  return { ...e, status, paid: money(paid), balance: money(balance) };
}

/* ------------------------------------------------------------------ invoices */

async function insertInvoice(conn, { companyId, user, estimateId = null, invoiceDate, termsDays, dueDate, header, supplyType, items, totals, notes, terms }) {
  const number = await nextInvoiceNumber(conn, companyId, invoiceDate); // locks the monthly sequence row
  const [r] = await conn.query(
    `INSERT INTO invoices (company_id, customer_id, estimate_id, invoice_number, invoice_date, due_date, payment_terms_days, supply_type,
       customer_name, customer_gstin, billing_address, shipping_address, subtotal, discount, taxable_amount, cgst, sgst, igst, gst_total,
       grand_total, amount_paid, balance_due, status, notes, terms, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'ISSUED',?,?,?)`,
    [companyId, header.customer_id, estimateId, number, invoiceDate, dueDate, termsDays, supplyType,
      header.customer_name, header.customer_gstin, header.billing_address, header.shipping_address,
      totals.subtotal, totals.discount, totals.taxable_amount, totals.cgst, totals.sgst, totals.igst, totals.gst_total,
      totals.grand_total, totals.grand_total, notes || null, terms || null, user ? user.id : null]
  );
  for (const it of items) {
    await conn.query(
      `INSERT INTO invoice_items (invoice_id, sort_order, description, hsn_sac, quantity, unit, rate, discount, taxable_amount, gst_rate, gst_amount, total_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.insertId, it.sort_order, it.description, it.hsn_sac, it.quantity, it.unit, it.rate, it.discount, it.taxable_amount, it.gst_rate, it.gst_amount, it.total_amount]
    );
  }
  return { id: r.insertId, number };
}

/** Manually created invoice (payments may be collected afterwards, partial payments supported). */
async function createInvoice(conn, { companyId, user, req, payload }) {
  const p = await prepareDocument(conn, companyId, payload, 'invoice_date');
  const inv = await insertInvoice(conn, {
    companyId, user, invoiceDate: p.docDate, termsDays: p.terms_days, dueDate: p.due_date, header: p.header,
    supplyType: p.supply_type, items: p.computed, totals: p.totals, notes: payload.notes,
    terms: payload.terms !== undefined && payload.terms !== null ? payload.terms : p.company.terms_and_conditions,
  });
  await audit(conn, { req, user, companyId, action: 'CREATE', module: 'INVOICE', recordId: inv.id, newValue: { number: inv.number, grand_total: p.totals.grand_total } });
  await notify(conn, { companyId, type: 'INVOICE_GENERATED', title: 'Invoice generated', message: `Invoice ${inv.number} generated for ${p.header.customer_name}. Amount: Rs. ${p.totals.grand_total}`, refType: 'INVOICE', refId: inv.id, dedupeKey: `inv-gen:${inv.id}` });
  return inv;
}

async function lockInvoice(conn, companyId, id) {
  const [[i]] = await conn.query('SELECT * FROM invoices WHERE id=? AND company_id=? FOR UPDATE', [id, companyId]);
  if (!i) throw notFound('Invoice');
  return i;
}

async function recalcInvoice(conn, id) {
  const [[i]] = await conn.query('SELECT id, grand_total, due_date, status FROM invoices WHERE id=?', [id]);
  if (!i) return null;
  const paid = await validPaid(conn, 'invoice_id', id);
  const balance = D(i.grand_total).minus(paid);
  const status = deriveInvoiceStatus({ status: i.status, grand_total: i.grand_total, amount_paid: money(paid), due_date: i.due_date }, today());
  await conn.query('UPDATE invoices SET amount_paid=?, balance_due=?, status=? WHERE id=?', [money(paid), money(balance.lt(0) ? 0 : balance), status, id]);
  return { id, status, amount_paid: money(paid), balance_due: money(balance.lt(0) ? 0 : balance) };
}

/** Rule A: convert an estimate to an invoice only after 100% payment (configurable) - verified on the server. */
async function convertEstimate(conn, { companyId, user, req, estimateId, auto = false }) {
  const e = await lockEstimate(conn, companyId, estimateId);
  if (e.status === 'CONVERTED' && e.converted_invoice_id) {
    const [[inv]] = await conn.query('SELECT id, invoice_number FROM invoices WHERE id=?', [e.converted_invoice_id]);
    return { id: inv.id, number: inv.invoice_number, alreadyConverted: true };
  }
  if (['DRAFT', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(e.status)) throw conflict('INVALID_STATUS', `An estimate in ${e.status} status cannot be converted`);

  const settings = await getSettings(conn, companyId);
  const paid = await validPaid(conn, 'estimate_id', estimateId);           // recomputed from payments, never trusted from client
  const outstanding = D(e.grand_total).minus(paid);
  if (!meetsConversionThreshold(e.grand_total, paid, settings)) {
    throw conflict('PAYMENT_INCOMPLETE', `Full payment is required before invoicing. Outstanding amount: Rs. ${money(outstanding)}`);
  }

  const [items] = await conn.query('SELECT * FROM estimate_items WHERE estimate_id=? ORDER BY sort_order, id', [estimateId]);
  const invoiceDate = today();
  const inv = await insertInvoice(conn, {
    companyId, user, estimateId, invoiceDate, termsDays: e.payment_terms_days, dueDate: addDays(invoiceDate, e.payment_terms_days || 0),
    header: { customer_id: e.customer_id, customer_name: e.customer_name, customer_gstin: e.customer_gstin, billing_address: e.billing_address, shipping_address: e.shipping_address },
    supplyType: e.supply_type, items,
    totals: { subtotal: e.subtotal, discount: e.discount, taxable_amount: e.taxable_amount, cgst: e.cgst, sgst: e.sgst, igst: e.igst, gst_total: e.gst_total, grand_total: e.grand_total },
    notes: e.notes, terms: e.terms,
  });
  await conn.query("UPDATE payments SET invoice_id=? WHERE estimate_id=? AND status='VALID'", [inv.id, estimateId]);
  await recalcInvoice(conn, inv.id);
  await conn.query("UPDATE estimates SET status='CONVERTED', converted_invoice_id=? WHERE id=?", [inv.id, estimateId]);

  await audit(conn, { req, user, companyId, action: auto ? 'AUTO_CONVERT' : 'CONVERT', module: 'ESTIMATE', recordId: estimateId, oldValue: { status: e.status }, newValue: { status: 'CONVERTED', invoice: inv.number } });
  await audit(conn, { req, user, companyId, action: 'CREATE', module: 'INVOICE', recordId: inv.id, newValue: { number: inv.number, from_estimate: e.estimate_number } });
  await notify(conn, { companyId, type: 'INVOICE_GENERATED', title: 'Invoice generated', message: `Invoice ${inv.number} generated for ${e.customer_name} from estimate ${e.estimate_number}.`, refType: 'INVOICE', refId: inv.id, dedupeKey: `inv-gen:${inv.id}` });
  return { id: inv.id, number: inv.number, alreadyConverted: false };
}

async function cancelInvoice(conn, { companyId, user, req, id, reason, type }) {
  const i = await lockInvoice(conn, companyId, id);
  if (['CANCELLED', 'VOID'].includes(i.status)) throw conflict('INVALID_STATUS', `Invoice is already ${i.status}`);
  const paid = await validPaid(conn, 'invoice_id', id);
  if (paid.gt(0)) throw conflict('HAS_PAYMENTS', 'This invoice has payments recorded. Cancel those payments first (they will be kept in the audit trail).');
  const status = type === 'VOID' ? 'VOID' : 'CANCELLED';
  await conn.query('UPDATE invoices SET status=?, cancel_reason=?, balance_due=0 WHERE id=?', [status, reason || null, id]);
  await audit(conn, { req, user, companyId, action: status, module: 'INVOICE', recordId: id, oldValue: { status: i.status }, newValue: { status, reason } });
  return status;
}

/** Edit non-financial invoice fields only. Amount changes = cancel + re-issue (audit-friendly). */
async function updateInvoice(conn, { companyId, user, req, id, payload }) {
  const i = await lockInvoice(conn, companyId, id);
  if (['CANCELLED', 'VOID'].includes(i.status)) throw conflict('INVALID_STATUS', 'A cancelled/void invoice cannot be edited');
  const dueDate = payload.due_date || i.due_date;
  await conn.query('UPDATE invoices SET notes=?, terms=?, due_date=? WHERE id=?', [payload.notes ?? i.notes, payload.terms ?? i.terms, dueDate, id]);
  await recalcInvoice(conn, id);
  await audit(conn, { req, user, companyId, action: 'UPDATE', module: 'INVOICE', recordId: id, oldValue: { due_date: i.due_date, notes: i.notes }, newValue: { due_date: dueDate, notes: payload.notes } });
}

/* ------------------------------------------------------------------ payments */

async function recordPayment(conn, { companyId, user, req, payload }) {
  const settings = await getSettings(conn, companyId);
  const amount = D(payload.amount);
  if (amount.lte(0)) throw badRequest('INVALID_AMOUNT', 'Payment amount must be greater than zero');
  if (!payload.estimate_id && !payload.invoice_id) throw badRequest('DOCUMENT_REQUIRED', 'Select an estimate or an invoice for this payment');

  let doc; let kind;
  if (payload.invoice_id) {
    kind = 'INVOICE';
    doc = await lockInvoice(conn, companyId, payload.invoice_id);
    if (!PAYABLE_INVOICE_STATUSES.includes(doc.status)) throw conflict('INVALID_STATUS', `Payments cannot be recorded against an invoice in ${doc.status} status`);
  } else {
    kind = 'ESTIMATE';
    doc = await lockEstimate(conn, companyId, payload.estimate_id);
    if (doc.status === 'CONVERTED') throw conflict('ALREADY_CONVERTED', 'This estimate is already invoiced. Record the payment against the invoice.');
    if (!PAYABLE_ESTIMATE_STATUSES.includes(doc.status)) throw conflict('INVALID_STATUS', `Payments cannot be recorded against an estimate in ${doc.status} status. Send or accept it first.`);
  }

  const paidSoFar = await validPaid(conn, kind === 'INVOICE' ? 'invoice_id' : 'estimate_id', doc.id);
  const outstanding = D(doc.grand_total).minus(paidSoFar);
  if (amount.gt(outstanding) && !settings.bool('allow_advance_payments')) {
    throw badRequest('PAYMENT_EXCEEDS_OUTSTANDING', `Payment exceeds the outstanding amount of Rs. ${money(outstanding.lt(0) ? 0 : outstanding)}`);
  }

  const paymentDate = payload.payment_date || today();
  const receipt = await nextReceiptNumber(conn, companyId, paymentDate);
  const [r] = await conn.query(
    `INSERT INTO payments (company_id, customer_id, estimate_id, invoice_id, receipt_number, payment_date, amount, payment_method, transaction_id, reference_number, bank, notes, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'VALID',?)`,
    [companyId, doc.customer_id, kind === 'ESTIMATE' ? doc.id : (doc.estimate_id || null), kind === 'INVOICE' ? doc.id : null, receipt, paymentDate, money(amount),
      payload.payment_method || 'BANK_TRANSFER', payload.transaction_id || null, payload.reference_number || null, payload.bank || null, payload.notes || null, user ? user.id : null]
  );
  const paymentId = r.insertId;

  let result = { payment_id: paymentId, receipt_number: receipt, invoice: null };
  if (kind === 'INVOICE') {
    // payments on an invoice created from an estimate keep estimate_id for history
    await recalcInvoice(conn, doc.id);
  } else {
    const est = await recalcEstimate(conn, doc.id);
    const fullyPaid = est.status === 'PAID';
    if (fullyPaid && doc.billing_cycle_id && settings.bool('auto_convert_to_invoice')) {
      const inv = await convertEstimate(conn, { companyId, user, req, estimateId: doc.id, auto: true });
      result.invoice = { id: inv.id, number: inv.number };
    }
    result.estimate_status = fullyPaid ? (result.invoice ? 'CONVERTED' : 'PAID') : est.status;
  }

  await audit(conn, { req, user, companyId, action: 'RECORD_PAYMENT', module: 'PAYMENT', recordId: paymentId, newValue: { amount: money(amount), kind, document_id: doc.id, receipt } });
  const label = kind === 'INVOICE' ? doc.invoice_number : doc.estimate_number;
  await notify(conn, { companyId, type: 'PAYMENT_RECEIVED', title: 'Payment received', message: `Payment of Rs. ${money(amount)} received from ${doc.customer_name} against ${label}.`, refType: 'PAYMENT', refId: paymentId, dedupeKey: `pay:${paymentId}` });
  return result;
}

async function updatePayment(conn, { companyId, user, req, id, payload }) {
  const [[p]] = await conn.query('SELECT * FROM payments WHERE id=? AND company_id=? FOR UPDATE', [id, companyId]);
  if (!p) throw notFound('Payment');
  if (payload.status === 'CANCELLED' && p.status !== 'CANCELLED') {
    // lock the parent document first (same order as recordPayment) to avoid races
    if (p.invoice_id) await lockInvoice(conn, companyId, p.invoice_id);
    else if (p.estimate_id) await lockEstimate(conn, companyId, p.estimate_id);
    await conn.query("UPDATE payments SET status='CANCELLED' WHERE id=?", [id]);
    if (p.invoice_id) await recalcInvoice(conn, p.invoice_id);
    else if (p.estimate_id) await recalcEstimate(conn, p.estimate_id);
    await audit(conn, { req, user, companyId, action: 'CANCEL_PAYMENT', module: 'PAYMENT', recordId: id, oldValue: { status: p.status, amount: p.amount }, newValue: { status: 'CANCELLED', reason: payload.notes } });
  }
  await conn.query(
    'UPDATE payments SET transaction_id=?, reference_number=?, bank=?, notes=? WHERE id=?',
    [payload.transaction_id ?? p.transaction_id, payload.reference_number ?? p.reference_number, payload.bank ?? p.bank, payload.notes ?? p.notes, id]
  );
  return id;
}

/* ------------------------------------------------------------------ status maintenance & loaders */

async function refreshStatuses(db, companyId) {
  const t = today();
  await (db || pool).query(
    "UPDATE invoices SET status='OVERDUE' WHERE company_id=? AND status IN ('ISSUED','PARTIALLY_PAID') AND balance_due > 0 AND due_date < ?",
    [companyId, t]
  );
  await (db || pool).query(
    "UPDATE estimates SET status='EXPIRED' WHERE company_id=? AND status IN ('DRAFT','SENT','VIEWED') AND valid_until IS NOT NULL AND valid_until < ? AND amount_paid = 0",
    [companyId, t]
  );
}

async function loadEstimate(db, companyId, id) {
  const [[e]] = await db.query(
    `SELECT e.*, inv.invoice_number AS converted_invoice_number FROM estimates e
     LEFT JOIN invoices inv ON inv.id = e.converted_invoice_id WHERE e.id=? AND e.company_id=?`, [id, companyId]);
  if (!e) throw notFound('Estimate');
  const [items] = await db.query('SELECT * FROM estimate_items WHERE estimate_id=? ORDER BY sort_order, id', [id]);
  const [payments] = await db.query("SELECT * FROM payments WHERE estimate_id=? ORDER BY payment_date, id", [id]);
  e.is_overdue = D(e.balance_due).gt(0) && !!e.due_date && e.due_date < today() && PAYABLE_ESTIMATE_STATUSES.includes(e.status);
  return { ...e, items, payments };
}

async function loadInvoice(db, companyId, id) {
  const [[i]] = await db.query(
    `SELECT i.*, est.estimate_number FROM invoices i LEFT JOIN estimates est ON est.id = i.estimate_id WHERE i.id=? AND i.company_id=?`, [id, companyId]);
  if (!i) throw notFound('Invoice');
  const [items] = await db.query('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order, id', [id]);
  const [payments] = await db.query("SELECT * FROM payments WHERE invoice_id=? ORDER BY payment_date, id", [id]);
  return { ...i, items, payments };
}

module.exports = {
  getCompany, getCustomer, createEstimate, updateEstimate, changeEstimateStatus, recalcEstimate,
  createInvoice, convertEstimate, cancelInvoice, updateInvoice, recalcInvoice,
  recordPayment, updatePayment, refreshStatuses, loadEstimate, loadInvoice,
  PAYABLE_ESTIMATE_STATUSES,
};
