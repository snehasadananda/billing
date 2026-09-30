const { monthAbbr, yearOf, monthOf } = require('./dates');

/**
 * Atomically reserve the next serial for (company, docType, year, month).
 * MUST be called inside a transaction: the row lock on the sequence row is held until commit,
 * so two concurrent transactions can never receive the same number.
 */
async function nextSerial(conn, companyId, docType, year, month) {
  await conn.query(
    `INSERT INTO invoice_sequences (company_id, doc_type, year, month, last_number)
     VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE id = id`,
    [companyId, docType, year, month]
  );
  const [rows] = await conn.query(
    'SELECT id, last_number FROM invoice_sequences WHERE company_id=? AND doc_type=? AND year=? AND month=? FOR UPDATE',
    [companyId, docType, year, month]
  );
  const next = Number(rows[0].last_number) + 1;
  await conn.query('UPDATE invoice_sequences SET last_number=? WHERE id=?', [next, rows[0].id]);
  return next;
}

const pad = (n, w) => String(n).padStart(w, '0');

/** Invoice number: MMMYYYYNNN e.g. AUG2026001. Serial resets each month. */
async function nextInvoiceNumber(conn, companyId, invoiceDate) {
  const y = yearOf(invoiceDate); const m = monthOf(invoiceDate);
  const n = await nextSerial(conn, companyId, 'INVOICE', y, m);
  return `${monthAbbr(invoiceDate)}${y}${pad(n, 3)}`;
}

/** Estimate number: EST-YYYYMM-NNNN (monthly serial). */
async function nextEstimateNumber(conn, companyId, estimateDate) {
  const y = yearOf(estimateDate); const m = monthOf(estimateDate);
  const n = await nextSerial(conn, companyId, 'ESTIMATE', y, m);
  return `EST-${y}${pad(m, 2)}-${pad(n, 4)}`;
}

/** Receipt number: REC + YYYY + NNNN (yearly serial), e.g. REC20260001. */
async function nextReceiptNumber(conn, companyId, paymentDate) {
  const y = yearOf(paymentDate);
  const n = await nextSerial(conn, companyId, 'RECEIPT', y, 0);
  return `REC${y}${pad(n, 4)}`;
}

module.exports = { nextSerial, nextInvoiceNumber, nextEstimateNumber, nextReceiptNumber };
