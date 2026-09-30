const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { D } = require('../utils/money');

const FONT_REG = path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');
const HAS_FONTS = fs.existsSync(FONT_REG) && fs.existsSync(FONT_BOLD);
const CUR = HAS_FONTS ? '₹' : 'Rs.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}-${MONTHS[Number(m) - 1]}-${y}`; };
const inr = (v) => `${CUR}${Number(D(v).toFixed(2)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => Number(D(v).toFixed(2)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* amount in words (Indian numbering) */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  let s = '';
  if (n >= 100) { s += `${ONES[Math.floor(n / 100)]} Hundred `; n %= 100; }
  if (n >= 20) { s += `${TENS[Math.floor(n / 10)]} `; n %= 10; }
  if (n > 0) s += `${ONES[n]} `;
  return s;
}
function amountInWords(v) {
  const [rupeesStr, paiseStr] = D(v).toFixed(2).split('.');
  let n = parseInt(rupeesStr, 10); const paise = parseInt(paiseStr, 10);
  if (n === 0 && paise === 0) return 'Zero Rupees Only';
  let w = '';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thou = Math.floor(n / 1000); n %= 1000;
  if (crore) w += `${below1000(crore)}Crore `;
  if (lakh) w += `${below1000(lakh)}Lakh `;
  if (thou) w += `${below1000(thou)}Thousand `;
  if (n) w += below1000(n);
  w = w.trim();
  let out = w ? `Rupees ${w}` : '';
  if (paise) out += `${out ? ' and ' : ''}${below1000(paise).trim()} Paise`;
  return `${out} Only`;
}

function toBuffer(build, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, ...opts });
    if (HAS_FONTS) { doc.registerFont('R', FONT_REG); doc.registerFont('B', FONT_BOLD); }
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); doc.end(); } catch (e) { reject(e); }
  });
}
const reg = (doc) => doc.font(HAS_FONTS ? 'R' : 'Helvetica');
const bold = (doc) => doc.font(HAS_FONTS ? 'B' : 'Helvetica-Bold');

function drawLogo(doc, company, x, y) {
  if (!company.logo || !String(company.logo).startsWith('data:image')) return false;
  try {
    const b64 = company.logo.split(',')[1];
    doc.image(Buffer.from(b64, 'base64'), x, y, { fit: [70, 60] });
    return true;
  } catch (_) { return false; }
}

function header(doc, company, title, meta) {
  const left = doc.page.margins.left; const right = doc.page.width - doc.page.margins.right;
  let y = doc.page.margins.top;
  const hasLogo = drawLogo(doc, company, left, y);
  const tx = hasLogo ? left + 80 : left;
  bold(doc).fontSize(15).fillColor('#111').text(company.name || '', tx, y, { width: 300 });
  reg(doc).fontSize(8.5).fillColor('#444');
  const addr = [company.address, [company.city, company.state, company.pin_code].filter(Boolean).join(', '), company.country].filter(Boolean).join(', ');
  if (addr) doc.text(addr, tx, doc.y, { width: 300 });
  const ids = [company.gstin && `GSTIN: ${company.gstin}`, company.pan && `PAN: ${company.pan}`, company.cin && `CIN: ${company.cin}`].filter(Boolean).join('   ');
  if (ids) doc.text(ids, tx, doc.y, { width: 300 });
  const contact = [company.mobile, company.email, company.website].filter(Boolean).join('  |  ');
  if (contact) doc.text(contact, tx, doc.y, { width: 300 });
  const leftEnd = doc.y;

  bold(doc).fontSize(17).fillColor('#1d4ed8').text(title, right - 200, y, { width: 200, align: 'right' });
  reg(doc).fontSize(9).fillColor('#222');
  meta.forEach(([k, v]) => { doc.text(`${k}: ${v}`, right - 200, doc.y, { width: 200, align: 'right' }); });
  const yEnd = Math.max(leftEnd, doc.y) + 8;
  doc.moveTo(left, yEnd).lineTo(right, yEnd).lineWidth(0.7).strokeColor('#bbb').stroke();
  doc.fillColor('#000');
  return yEnd + 10;
}

const COLS = [
  { k: 'n', l: '#', w: 20, a: 'left' }, { k: 'd', l: 'Description', w: 150, a: 'left' }, { k: 'q', l: 'Qty', w: 38, a: 'right' },
  { k: 'r', l: 'Rate', w: 58, a: 'right' }, { k: 'ds', l: 'Disc.', w: 45, a: 'right' }, { k: 't', l: 'Taxable', w: 62, a: 'right' },
  { k: 'g', l: 'GST%', w: 32, a: 'right' }, { k: 'ga', l: 'GST', w: 50, a: 'right' }, { k: 'tt', l: 'Total', w: 60, a: 'right' },
];

function itemsTable(doc, items, y) {
  const left = doc.page.margins.left;
  const total = COLS.reduce((s, c) => s + c.w, 0);
  const head = (yy) => {
    doc.rect(left, yy, total, 18).fill('#eef2ff'); doc.fillColor('#111'); bold(doc).fontSize(8);
    let x = left; COLS.forEach((c) => { doc.text(c.l, x + 3, yy + 5, { width: c.w - 6, align: c.a }); x += c.w; });
    return yy + 18;
  };
  y = head(y);
  items.forEach((it, i) => {
    const descText = `${it.description}${it.hsn_sac ? `\nHSN/SAC: ${it.hsn_sac}` : ''}`;
    reg(doc).fontSize(8.5);
    const h = Math.max(doc.heightOfString(descText, { width: COLS[1].w - 6 }), 12) + 8;
    if (y + h > doc.page.height - 130) { doc.addPage(); y = head(doc.page.margins.top); }
    const vals = { n: i + 1, d: descText, q: `${D(it.quantity).toFixed(3).replace(/\.?0+$/, '')}${it.unit ? ` ${it.unit}` : ''}`, r: num(it.rate), ds: num(it.discount), t: num(it.taxable_amount), g: `${D(it.gst_rate).toFixed(0)}%`, ga: num(it.gst_amount), tt: num(it.total_amount) };
    let x = left; reg(doc).fontSize(8.5).fillColor('#111');
    COLS.forEach((c) => { doc.text(String(vals[c.k]), x + 3, y + 4, { width: c.w - 6, align: c.a }); x += c.w; });
    y += h; doc.moveTo(left, y).lineTo(left + total, y).lineWidth(0.4).strokeColor('#ddd').stroke();
  });
  return y + 8;
}

function totalsBlock(doc, d, y) {
  const right = doc.page.width - doc.page.margins.right; const labelX = right - 230; const w = 230;
  if (y > doc.page.height - 260) { doc.addPage(); y = doc.page.margins.top; }
  const rows = [['Subtotal', d.subtotal], ['Discount', d.discount], ['Taxable Amount', d.taxable_amount]];
  if (D(d.cgst).gt(0) || D(d.sgst).gt(0)) { rows.push(['CGST', d.cgst], ['SGST', d.sgst]); }
  if (D(d.igst).gt(0)) rows.push(['IGST', d.igst]);
  rows.push(['Total GST', d.gst_total]);
  reg(doc).fontSize(9).fillColor('#222');
  rows.forEach(([k, v]) => { doc.text(k, labelX, y, { width: w - 90 }); doc.text(inr(v), labelX + w - 90, y, { width: 90, align: 'right' }); y += 14; });
  doc.moveTo(labelX, y).lineTo(right, y).lineWidth(0.6).strokeColor('#999').stroke(); y += 4;
  bold(doc).fontSize(11).text('Grand Total', labelX, y, { width: w - 90 }); doc.text(inr(d.grand_total), labelX + w - 90, y, { width: 90, align: 'right' });
  return y + 22;
}

function footer(doc, company, d, y, { showPayment }) {
  const left = doc.page.margins.left; const right = doc.page.width - doc.page.margins.right;
  if (y > doc.page.height - 200) { doc.addPage(); y = doc.page.margins.top; }
  reg(doc).fontSize(8.5).fillColor('#222');
  doc.text(`Amount in words: ${amountInWords(d.grand_total)}`, left, y, { width: right - left }); y = doc.y + 8;

  if (showPayment) {
    bold(doc).fontSize(9).text('Payment Information', left, y); y = doc.y + 2; reg(doc).fontSize(8.5);
    doc.text(`Amount Paid: ${inr(d.amount_paid)}     Balance Due: ${inr(d.balance_due)}`, left, y); y = doc.y;
    const pay = (d.payments || []).filter((p) => p.status === 'VALID');
    pay.slice(0, 5).forEach((p) => { doc.text(`${fmtDate(p.payment_date)}  ${inr(p.amount)}  ${String(p.payment_method).replace('_', ' ')}${p.transaction_id ? `  Txn: ${p.transaction_id}` : ''}${p.reference_number ? `  Ref: ${p.reference_number}` : ''}`, left, y); y = doc.y; });
    y += 6;
  }

  const bank = [company.bank_name && `Bank: ${company.bank_name}`, company.account_number && `A/c No: ${company.account_number}`, company.ifsc && `IFSC: ${company.ifsc}`, company.branch && `Branch: ${company.branch}`, company.upi_id && `UPI: ${company.upi_id}`].filter(Boolean);
  if (bank.length) { bold(doc).fontSize(9).text('Bank Details', left, y); y = doc.y + 2; reg(doc).fontSize(8.5).text(bank.join('   |   '), left, y, { width: right - left }); y = doc.y + 8; }
  if (d.notes) { bold(doc).fontSize(9).text('Notes', left, y); y = doc.y + 2; reg(doc).fontSize(8.5).text(d.notes, left, y, { width: right - left }); y = doc.y + 8; }
  if (d.terms) { bold(doc).fontSize(9).text('Terms & Conditions', left, y); y = doc.y + 2; reg(doc).fontSize(8).fillColor('#444').text(d.terms, left, y, { width: right - left - 150 }); y = doc.y + 8; }
  reg(doc).fontSize(8.5).fillColor('#222').text(`For ${company.name || ''}`, right - 160, Math.max(y, doc.page.height - 110), { width: 160, align: 'right' });
  doc.text('Authorized Signatory', right - 160, doc.page.height - 70, { width: 160, align: 'right' });
}

function partyBlock(doc, d, y) {
  const left = doc.page.margins.left; const w = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 15) / 2;
  const box = (title, name, addr, gstin, x) => {
    doc.rect(x, y, w, 70).lineWidth(0.5).strokeColor('#ccc').stroke();
    bold(doc).fontSize(8).fillColor('#666').text(title, x + 6, y + 5);
    bold(doc).fontSize(10).fillColor('#111').text(name || '', x + 6, y + 17, { width: w - 12 });
    reg(doc).fontSize(8.5).fillColor('#333').text(addr || '', x + 6, doc.y, { width: w - 12, height: 30 });
    if (gstin) doc.text(`GSTIN: ${gstin}`, x + 6, y + 56, { width: w - 12 });
  };
  box('BILL TO', d.customer_name, d.billing_address, d.customer_gstin, left);
  box('SHIP TO', d.customer_name, d.shipping_address || d.billing_address, null, left + w + 15);
  return y + 80;
}

function documentPdf(kind, company, d) {
  const isInvoice = kind === 'INVOICE';
  return toBuffer((doc) => {
    const meta = isInvoice
      ? [['Invoice No', d.invoice_number], ['Invoice Date', fmtDate(d.invoice_date)], ['Due Date', fmtDate(d.due_date)], ['Status', d.status.replace('_', ' ')]]
      : [['Estimate No', d.estimate_number], ['Date', fmtDate(d.estimate_date)], ['Valid Until', fmtDate(d.valid_until)], ['Payment Due', fmtDate(d.due_date)], ['Status', d.status.replace('_', ' ')]];
    let y = header(doc, company, isInvoice ? 'TAX INVOICE' : 'ESTIMATE', meta);
    y = partyBlock(doc, d, y);
    y = itemsTable(doc, d.items, y);
    y = totalsBlock(doc, d, y);
    footer(doc, company, d, y, { showPayment: true });
  });
}

function receiptPdf(company, p, doc_) {
  return toBuffer((doc) => {
    let y = header(doc, company, 'PAYMENT RECEIPT', [['Receipt No', p.receipt_number || '-'], ['Payment Date', fmtDate(p.payment_date)]]);
    const left = doc.page.margins.left; const w = doc.page.width - left - doc.page.margins.right;
    const rows = [
      ['Received From', doc_.customer_name], ['Against', doc_.number], ['Amount Received', inr(p.amount)], ['Amount in Words', amountInWords(p.amount)],
      ['Payment Method', String(p.payment_method).replace('_', ' ')], ['Transaction ID', p.transaction_id || '-'], ['Reference No', p.reference_number || '-'], ['Bank', p.bank || '-'],
      ['Document Total', inr(doc_.grand_total)], ['Balance After This Payment', inr(doc_.balance_due)],
    ];
    y += 10;
    rows.forEach(([k, v]) => {
      reg(doc).fontSize(9).fillColor('#666').text(k, left, y, { width: 160 });
      bold(doc).fontSize(10).fillColor('#111').text(String(v), left + 170, y, { width: w - 170 });
      y = doc.y + 8;
    });
    if (p.status === 'CANCELLED') bold(doc).fontSize(16).fillColor('#dc2626').text('CANCELLED', left, y + 10);
    reg(doc).fontSize(8.5).fillColor('#222').text(`For ${company.name || ''}`, doc.page.width - 200, doc.page.height - 110, { width: 160, align: 'right' });
    doc.text('Authorized Signatory', doc.page.width - 200, doc.page.height - 70, { width: 160, align: 'right' });
  });
}

/** Generic report PDF: { title, periodLabel, summary:[{label,value,money}], columns:[{key,label,type}], rows } */
function reportPdf(company, report) {
  const landscape = report.columns.length > 6;
  return toBuffer((doc) => {
    const left = doc.page.margins.left; const W = doc.page.width - left - doc.page.margins.right;
    bold(doc).fontSize(15).fillColor('#111').text(company.name || '', left, doc.page.margins.top);
    bold(doc).fontSize(12).fillColor('#1d4ed8').text(report.title);
    reg(doc).fontSize(9).fillColor('#555').text(`${report.periodLabel || ''}   |   Generated ${fmtDate(new Date().toISOString())}`);
    let y = doc.y + 8;
    (report.summary || []).forEach((s) => {
      reg(doc).fontSize(9.5).fillColor('#222').text(s.label, left, y, { width: W * 0.6 });
      bold(doc).text(s.money ? inr(s.value) : String(s.value), left + W * 0.6, y, { width: W * 0.4, align: 'right' }); y = doc.y + 3;
    });
    y += 8;
    const cols = report.columns; const cw = W / cols.length;
    const head = (yy) => { doc.rect(left, yy, W, 18).fill('#eef2ff'); doc.fillColor('#111'); bold(doc).fontSize(8); cols.forEach((c, i) => doc.text(c.label, left + i * cw + 3, yy + 5, { width: cw - 6, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left' })); return yy + 18; };
    y = head(y);
    reg(doc).fontSize(8);
    report.rows.forEach((r) => {
      if (y > doc.page.height - 60) { doc.addPage(); y = head(doc.page.margins.top); reg(doc).fontSize(8); }
      cols.forEach((c, i) => {
        const raw = r[c.key]; const txt = raw == null ? '' : c.type === 'money' ? num(raw) : c.type === 'date' ? fmtDate(raw) : String(raw);
        doc.fillColor('#111').text(txt, left + i * cw + 3, y + 3, { width: cw - 6, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left', lineBreak: false, ellipsis: true });
      });
      y += 15; doc.moveTo(left, y).lineTo(left + W, y).lineWidth(0.3).strokeColor('#ddd').stroke();
    });
    if (report.rows.length === 0) doc.text('No records for the selected period.', left, y + 6);
  }, { layout: landscape ? 'landscape' : 'portrait' });
}

module.exports = { documentPdf, receiptPdf, reportPdf, amountInWords, fmtDate, inr };
