/**
 * Dashboard + reports. All figures are computed in SQL / decimal on the server.
 *
 * "Billing documents" = invoices (not draft/cancelled/void) + recurring/accepted estimates that are not yet invoiced.
 * Under the 100%-payment rule money is collected against estimates first, so they must be part of billing/pending/overdue.
 * GST on collections = each payment's share of its document's GST (payment / grand_total * gst_total).
 */
const { pool } = require('../config/db');
const { D, money } = require('../utils/money');
const { today, addMonths, fmt, parse, MONTHS } = require('../utils/dates');
const { resolvePeriod } = require('../utils/period');
const { getSettings } = require('./settings');

const docsUnion = (companyId) => ({
  sql: `SELECT 'INVOICE' AS doc_type, i.id, i.invoice_number AS doc_no, i.customer_id, i.customer_name, i.invoice_date AS doc_date, i.due_date,
          i.taxable_amount, i.cgst, i.sgst, i.igst, i.gst_total, i.grand_total, i.amount_paid, i.balance_due, i.status
        FROM invoices i WHERE i.company_id = ? AND i.status NOT IN ('DRAFT','CANCELLED','VOID')
        UNION ALL
        SELECT 'ESTIMATE', e.id, e.estimate_number, e.customer_id, e.customer_name, e.estimate_date, e.due_date,
          e.taxable_amount, e.cgst, e.sgst, e.igst, e.gst_total, e.grand_total, e.amount_paid, e.balance_due, e.status
        FROM estimates e WHERE e.company_id = ? AND e.status IN ('AUTO_GENERATED','ACCEPTED','PAYMENT_PENDING','PAID')`,
  params: [companyId, companyId],
});

const PAY_GST_SQL = 'ROUND(p.amount * COALESCE(i.gst_total, e.gst_total) / NULLIF(COALESCE(i.grand_total, e.grand_total), 0), 2)';
const PAY_JOIN = 'FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN estimates e ON e.id = p.estimate_id';

const n = (v) => Number(money(v));

async function kpis(companyId, from, to) {
  const t = today();
  const { sql, params } = docsUnion(companyId);
  const [[b]] = await pool.query(
    `SELECT COALESCE(SUM(grand_total),0) billing, COALESCE(SUM(gst_total),0) gst_invoiced,
            COALESCE(SUM(CASE WHEN balance_due > 0 THEN balance_due END),0) pending,
            COALESCE(SUM(CASE WHEN balance_due > 0 AND due_date IS NOT NULL AND due_date < ? THEN balance_due END),0) overdue,
            COUNT(*) doc_count
     FROM (${sql}) d WHERE doc_date BETWEEN ? AND ?`, [t, ...params, from, to]);
  const [[c]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount),0) collected, COALESCE(SUM(${PAY_GST_SQL}),0) gst_collected ${PAY_JOIN}
     WHERE p.company_id=? AND p.status='VALID' AND p.payment_date BETWEEN ? AND ?`, [companyId, from, to]);
  const settings = await getSettings(pool, companyId);
  const gstInvoiced = D(b.gst_invoiced); const gstCollected = D(c.gst_collected);
  const basis = settings.raw.gst_calculation_basis === 'invoices' ? 'invoices' : 'collections';
  return {
    totalBilling: n(b.billing), totalCollected: n(c.collected), totalPending: n(b.pending), totalOverdue: n(b.overdue),
    gstInvoiced: n(gstInvoiced), gstCollected: n(gstCollected), gstPayable: n(basis === 'collections' ? gstCollected : gstInvoiced),
    gstBasis: basis, documentCount: Number(b.doc_count),
    labels: { gstCollected: settings.raw.gst_collections_label, gstPayable: settings.raw.gst_payable_label },
  };
}

function last12Months(nowStr) {
  const { y, m } = parse(nowStr); const out = [];
  for (let k = 11; k >= 0; k -= 1) { const d = addMonths(fmt(y, m, 1), -k, 1); out.push(d.slice(0, 7)); }
  return out;
}
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1][0]}${MONTHS[Number(ym.slice(5, 7)) - 1].slice(1).toLowerCase()} ${ym.slice(2, 4)}`;

async function dashboard(companyId, q) {
  const t = today();
  const period = resolvePeriod(q.period, q.from, q.to, t);
  const summary = await kpis(companyId, period.from, period.to);
  const months = last12Months(t);
  const start = `${months[0]}-01`;
  const { sql, params } = docsUnion(companyId);

  const [payRows] = await pool.query(
    `SELECT DATE_FORMAT(p.payment_date,'%Y-%m') ym, SUM(p.amount) collected, SUM(${PAY_GST_SQL}) gst ${PAY_JOIN}
     WHERE p.company_id=? AND p.status='VALID' AND p.payment_date >= ? GROUP BY ym`, [companyId, start]);
  const [billRows] = await pool.query(`SELECT DATE_FORMAT(doc_date,'%Y-%m') ym, SUM(grand_total) billed FROM (${sql}) d WHERE doc_date >= ? GROUP BY ym`, [...params, start]);
  const pm = Object.fromEntries(payRows.map((r) => [r.ym, r])); const bm = Object.fromEntries(billRows.map((r) => [r.ym, r]));
  const monthly = months.map((ym) => ({ month: monthLabel(ym), collected: n(pm[ym]?.collected || 0), billed: n(bm[ym]?.billed || 0), gst: n(pm[ym]?.gst || 0) }));

  const [top] = await pool.query(
    `SELECT customer_id, customer_name, SUM(balance_due) outstanding FROM (${sql}) d WHERE balance_due > 0 GROUP BY customer_id, customer_name ORDER BY outstanding DESC LIMIT 5`, params);
  const [overdue] = await pool.query(
    `SELECT doc_type, id, doc_no, customer_name, due_date, balance_due, DATEDIFF(?, due_date) days_overdue FROM (${sql}) d
     WHERE balance_due > 0 AND due_date IS NOT NULL AND due_date < ? ORDER BY days_overdue DESC LIMIT 8`, [t, ...params, t]);
  const [upcoming] = await pool.query(
    `SELECT bc.id, bc.customer_id, COALESCE(c.company_name, c.name) customer_name, bc.next_billing_date,
            ROUND(bc.billing_amount * (1 + bc.gst_rate/100), 2) amount, bc.billing_frequency
     FROM billing_cycles bc JOIN customers c ON c.id = bc.customer_id
     WHERE bc.company_id=? AND bc.status='ACTIVE' ORDER BY bc.next_billing_date ASC LIMIT 8`, [companyId]);

  const pendingOnly = Math.max(summary.totalPending - summary.totalOverdue, 0);
  return {
    period: { key: q.period || 'this_month', ...period },
    ...summary,
    charts: {
      monthly,
      paymentStatus: [
        { name: 'Collected', value: summary.totalCollected }, { name: 'Pending', value: pendingOnly }, { name: 'Overdue', value: summary.totalOverdue },
      ],
      topOutstanding: top.map((r) => ({ customer_id: r.customer_id, name: r.customer_name, outstanding: n(r.outstanding) })),
    },
    overdueList: overdue.map((r) => ({ ...r, balance_due: n(r.balance_due), days_overdue: Number(r.days_overdue) })),
    upcomingBilling: upcoming.map((r) => ({ ...r, amount: n(r.amount) })),
  };
}

/* ------------------------------------------------------------------ report registry */

const M = 'money'; const T = 'text'; const DT = 'date'; const NUM = 'number';

async function reportCollection(companyId, q, per) {
  const k = await kpis(companyId, per.from, per.to);
  const { sql, params } = docsUnion(companyId);
  const [bill] = await pool.query(`SELECT DATE_FORMAT(doc_date,'%Y-%m') ym, SUM(grand_total) billed, SUM(gst_total) gst FROM (${sql}) d WHERE doc_date BETWEEN ? AND ? GROUP BY ym`, [...params, per.from, per.to]);
  const [pay] = await pool.query(`SELECT DATE_FORMAT(p.payment_date,'%Y-%m') ym, SUM(p.amount) collected, SUM(${PAY_GST_SQL}) gst ${PAY_JOIN} WHERE p.company_id=? AND p.status='VALID' AND p.payment_date BETWEEN ? AND ? GROUP BY ym`, [companyId, per.from, per.to]);
  const yms = [...new Set([...bill.map((r) => r.ym), ...pay.map((r) => r.ym)])].sort();
  const bm = Object.fromEntries(bill.map((r) => [r.ym, r])); const pm = Object.fromEntries(pay.map((r) => [r.ym, r]));
  return {
    title: 'Collection Report',
    summary: [
      { label: 'Total Invoice Value', value: k.totalBilling, money: true }, { label: 'Total Collected', value: k.totalCollected, money: true },
      { label: 'Total Pending', value: k.totalPending, money: true }, { label: 'Total Overdue', value: k.totalOverdue, money: true },
    ],
    columns: [{ key: 'month', label: 'Month', type: T }, { key: 'billed', label: 'Billed', type: M }, { key: 'collected', label: 'Collected', type: M }, { key: 'gst_collected', label: 'GST on Collections', type: M }],
    rows: yms.map((ym) => ({ month: monthLabel(ym), billed: money(bm[ym]?.billed || 0), collected: money(pm[ym]?.collected || 0), gst_collected: money(pm[ym]?.gst || 0) })),
  };
}

async function reportSales(companyId, q, per) {
  const [rows] = await pool.query(
    `SELECT invoice_number, invoice_date, customer_name, taxable_amount, gst_total, grand_total, amount_paid, balance_due, status FROM invoices
     WHERE company_id=? AND status NOT IN ('DRAFT','CANCELLED','VOID') AND invoice_date BETWEEN ? AND ? ORDER BY invoice_date DESC, id DESC`, [companyId, per.from, per.to]);
  const tot = rows.reduce((a, r) => ({ taxable: a.taxable.plus(r.taxable_amount), gst: a.gst.plus(r.gst_total), total: a.total.plus(r.grand_total) }), { taxable: D(0), gst: D(0), total: D(0) });
  return {
    title: 'Sales Report',
    summary: [{ label: 'Invoices', value: rows.length }, { label: 'Taxable Sales', value: money(tot.taxable), money: true }, { label: 'GST', value: money(tot.gst), money: true }, { label: 'Invoice Value', value: money(tot.total), money: true }],
    columns: [{ key: 'invoice_number', label: 'Invoice', type: T }, { key: 'invoice_date', label: 'Date', type: DT }, { key: 'customer_name', label: 'Customer', type: T }, { key: 'taxable_amount', label: 'Taxable', type: M }, { key: 'gst_total', label: 'GST', type: M }, { key: 'grand_total', label: 'Total', type: M }, { key: 'amount_paid', label: 'Paid', type: M }, { key: 'balance_due', label: 'Balance', type: M }, { key: 'status', label: 'Status', type: T }],
    rows,
  };
}

async function reportGst(companyId, q, per) {
  const { sql, params } = docsUnion(companyId);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(doc_date,'%Y-%m') ym, SUM(taxable_amount) taxable, SUM(cgst) cgst, SUM(sgst) sgst, SUM(igst) igst, SUM(gst_total) gst
     FROM (${sql}) d WHERE doc_date BETWEEN ? AND ? GROUP BY ym ORDER BY ym`, [...params, per.from, per.to]);
  const [pay] = await pool.query(`SELECT DATE_FORMAT(p.payment_date,'%Y-%m') ym, SUM(${PAY_GST_SQL}) gst ${PAY_JOIN} WHERE p.company_id=? AND p.status='VALID' AND p.payment_date BETWEEN ? AND ? GROUP BY ym`, [companyId, per.from, per.to]);
  const pm = Object.fromEntries(pay.map((r) => [r.ym, r.gst]));
  const sum = (key) => rows.reduce((a, r) => a.plus(r[key]), D(0));
  const settings = await getSettings(pool, companyId);
  const gstColl = pay.reduce((a, r) => a.plus(r.gst), D(0));
  return {
    title: 'GST Report',
    summary: [
      { label: 'Taxable Sales', value: money(sum('taxable')), money: true }, { label: 'CGST', value: money(sum('cgst')), money: true }, { label: 'SGST', value: money(sum('sgst')), money: true },
      { label: 'IGST', value: money(sum('igst')), money: true }, { label: 'Total GST Invoiced', value: money(sum('gst')), money: true },
      { label: settings.raw.gst_collections_label || 'GST on Collections', value: money(gstColl), money: true },
    ],
    note: 'GST on Collections is a management/reporting figure (each payment\'s proportionate share of GST). It is not the legally final GST liability; confirm with your tax advisor.',
    columns: [{ key: 'month', label: 'Month', type: T }, { key: 'taxable', label: 'Taxable', type: M }, { key: 'cgst', label: 'CGST', type: M }, { key: 'sgst', label: 'SGST', type: M }, { key: 'igst', label: 'IGST', type: M }, { key: 'gst', label: 'Total GST', type: M }, { key: 'gst_collected', label: 'GST on Collections', type: M }],
    rows: rows.map((r) => ({ month: monthLabel(r.ym), taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, gst: r.gst, gst_collected: pm[r.ym] || '0.00' })),
  };
}

async function reportCustomers(companyId, q, per) {
  const t = today(); const { sql, params } = docsUnion(companyId);
  const [rows] = await pool.query(
    `SELECT customer_name, COUNT(*) documents, SUM(grand_total) billed, SUM(amount_paid) paid,
            SUM(CASE WHEN balance_due > 0 THEN balance_due ELSE 0 END) pending,
            SUM(CASE WHEN balance_due > 0 AND due_date < ? THEN balance_due ELSE 0 END) overdue
     FROM (${sql}) d WHERE doc_date BETWEEN ? AND ? GROUP BY customer_id, customer_name ORDER BY billed DESC`, [t, ...params, per.from, per.to]);
  return {
    title: 'Customer-wise Report', summary: [{ label: 'Customers', value: rows.length }],
    columns: [{ key: 'customer_name', label: 'Customer', type: T }, { key: 'documents', label: 'Docs', type: NUM }, { key: 'billed', label: 'Billed', type: M }, { key: 'paid', label: 'Paid', type: M }, { key: 'pending', label: 'Pending', type: M }, { key: 'overdue', label: 'Overdue', type: M }],
    rows,
  };
}

async function reportOutstanding(companyId, q, per, kind = 'outstanding') {
  const t = today(); const { sql, params } = docsUnion(companyId);
  const overdueOnly = kind === 'overdue' || q.overdue_only === 'true';
  const [rows] = await pool.query(
    `SELECT doc_type, doc_no, customer_name, doc_date, due_date, grand_total, amount_paid, balance_due,
            CASE WHEN due_date < ? THEN DATEDIFF(?, due_date) ELSE 0 END days_overdue
     FROM (${sql}) d WHERE balance_due > 0 ${overdueOnly ? 'AND due_date < ?' : ''} ORDER BY due_date ASC`, overdueOnly ? [t, t, ...params, t] : [t, t, ...params]);
  const total = rows.reduce((a, r) => a.plus(r.balance_due), D(0));
  return {
    title: overdueOnly ? 'Overdue Report' : (kind === 'pending' ? 'Pending Report' : 'Outstanding Report'), periodLabel: 'As of today',
    summary: [{ label: 'Documents', value: rows.length }, { label: overdueOnly ? 'Total Overdue' : 'Total Outstanding', value: money(total), money: true }],
    columns: [{ key: 'doc_no', label: 'Document', type: T }, { key: 'customer_name', label: 'Customer', type: T }, { key: 'doc_date', label: 'Date', type: DT }, { key: 'due_date', label: 'Due', type: DT }, { key: 'grand_total', label: 'Total', type: M }, { key: 'amount_paid', label: 'Paid', type: M }, { key: 'balance_due', label: 'Balance', type: M }, { key: 'days_overdue', label: 'Days Overdue', type: NUM }],
    rows,
  };
}

async function reportPayments(companyId, q, per) {
  const where = ["p.company_id=?", "p.status='VALID'", 'p.payment_date BETWEEN ? AND ?']; const args = [companyId, per.from, per.to];
  if (q.customer_id) { where.push('p.customer_id=?'); args.push(Number(q.customer_id)); }
  if (q.method) { where.push('p.payment_method=?'); args.push(q.method); }
  if (q.invoice) { where.push('(i.invoice_number LIKE ? OR e.estimate_number LIKE ?)'); args.push(`%${q.invoice}%`, `%${q.invoice}%`); }
  if (q.min) { where.push('p.amount >= ?'); args.push(q.min); }
  if (q.max) { where.push('p.amount <= ?'); args.push(q.max); }
  const [rows] = await pool.query(
    `SELECT p.payment_date, c.name customer_name, COALESCE(i.invoice_number, e.estimate_number) document, p.amount, p.payment_method, p.transaction_id, p.reference_number, u.name created_by, p.receipt_number
     FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN estimates e ON e.id=p.estimate_id LEFT JOIN users u ON u.id=p.created_by
     WHERE ${where.join(' AND ')} ORDER BY p.payment_date DESC, p.id DESC`, args);
  const total = rows.reduce((a, r) => a.plus(r.amount), D(0));
  return {
    title: 'Payment Report',
    summary: [{ label: 'Payments', value: rows.length }, { label: 'Total Received', value: money(total), money: true }],
    columns: [{ key: 'payment_date', label: 'Date', type: DT }, { key: 'customer_name', label: 'Customer', type: T }, { key: 'document', label: 'Document', type: T }, { key: 'amount', label: 'Amount', type: M }, { key: 'payment_method', label: 'Method', type: T }, { key: 'transaction_id', label: 'Txn ID', type: T }, { key: 'reference_number', label: 'Reference', type: T }, { key: 'created_by', label: 'By', type: T }],
    rows,
  };
}

async function reportEstimates(companyId, q, per) {
  const [rows] = await pool.query(
    `SELECT estimate_number, estimate_date, customer_name, grand_total, amount_paid, status FROM estimates
     WHERE company_id=? AND estimate_date BETWEEN ? AND ? ORDER BY estimate_date DESC, id DESC`, [companyId, per.from, per.to]);
  const c = (...s) => rows.filter((r) => s.includes(r.status)).length;
  return {
    title: 'Estimate Report',
    summary: [
      { label: 'Created', value: rows.length }, { label: 'Accepted (incl. paid / converted)', value: c('ACCEPTED', 'PAYMENT_PENDING', 'PAID', 'CONVERTED') }, { label: 'Rejected', value: c('REJECTED') },
      { label: 'Expired', value: c('EXPIRED') }, { label: 'Pending', value: c('DRAFT', 'SENT', 'VIEWED', 'AUTO_GENERATED', 'ACCEPTED', 'PAYMENT_PENDING') }, { label: 'Converted', value: c('CONVERTED') },
    ],
    columns: [{ key: 'estimate_number', label: 'Estimate', type: T }, { key: 'estimate_date', label: 'Date', type: DT }, { key: 'customer_name', label: 'Customer', type: T }, { key: 'grand_total', label: 'Total', type: M }, { key: 'amount_paid', label: 'Paid', type: M }, { key: 'status', label: 'Status', type: T }],
    rows,
  };
}

async function reportMonthly(companyId, q) {
  const ym = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : today().slice(0, 7);
  const from = `${ym}-01`; const per = resolvePeriod('custom', from, `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate()).padStart(2, '0')}`);
  const k = await kpis(companyId, per.from, per.to);
  const [[inv]] = await pool.query("SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) v FROM invoices WHERE company_id=? AND status NOT IN ('DRAFT','CANCELLED','VOID') AND invoice_date BETWEEN ? AND ?", [companyId, per.from, per.to]);
  const label = `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  return {
    title: `Monthly Report - ${label}`, periodLabel: label,
    summary: [
      { label: 'Invoices', value: inv.c }, { label: 'Invoice Value', value: money(inv.v), money: true }, { label: 'Total Billing (incl. open estimates)', value: k.totalBilling, money: true },
      { label: 'Collected', value: k.totalCollected, money: true }, { label: 'Pending', value: k.totalPending, money: true }, { label: 'Overdue', value: k.totalOverdue, money: true },
      { label: 'GST Invoiced', value: k.gstInvoiced, money: true }, { label: 'GST Associated With Collected Amount', value: k.gstCollected, money: true },
    ],
    columns: [], rows: [],
  };
}

const REPORTS = {
  collection: reportCollection, sales: reportSales, gst: reportGst, customers: reportCustomers, customer: reportCustomers,
  outstanding: (c, q, p) => reportOutstanding(c, q, p, 'outstanding'), pending: (c, q, p) => reportOutstanding(c, q, p, 'pending'), overdue: (c, q, p) => reportOutstanding(c, q, p, 'overdue'),
  payments: reportPayments, estimates: reportEstimates, monthly: (c, q) => reportMonthly(c, q),
};

async function runReport(companyId, type, q) {
  const fn = REPORTS[type];
  if (!fn) return null;
  const per = resolvePeriod(q.period || 'this_month', q.from, q.to);
  const rep = await fn(companyId, q, per);
  return { from: per.from, to: per.to, ...rep, periodLabel: rep.periodLabel || per.label };
}

module.exports = { kpis, dashboard, runReport, docsUnion, PAY_GST_SQL, PAY_JOIN };
