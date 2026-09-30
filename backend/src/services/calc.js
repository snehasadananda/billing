const { D, r2, money } = require('../utils/money');
const { badRequest } = require('../utils/errors');

/**
 * Server-side GST / totals engine. The frontend NEVER decides final amounts.
 *
 * item: { description, hsn_sac, quantity, unit, rate, discount (amount), gst_rate }
 * supplyType: 'INTRA_STATE' (CGST + SGST) | 'INTER_STATE' (IGST)
 */
function computeDocument(rawItems, supplyType) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw badRequest('NO_ITEMS', 'At least one item is required');

  let subtotal = D(0); let discount = D(0); let taxable = D(0); let gst = D(0);
  const items = rawItems.map((it, idx) => {
    const qty = D(it.quantity); const rate = D(it.rate); const disc = D(it.discount || 0); const gstRate = D(it.gst_rate || 0);
    if (qty.lte(0)) throw badRequest('INVALID_ITEM', `Item ${idx + 1}: quantity must be greater than zero`);
    if (rate.lt(0)) throw badRequest('INVALID_ITEM', `Item ${idx + 1}: rate cannot be negative`);
    if (disc.lt(0)) throw badRequest('INVALID_ITEM', `Item ${idx + 1}: discount cannot be negative`);
    if (gstRate.lt(0) || gstRate.gt(100)) throw badRequest('INVALID_ITEM', `Item ${idx + 1}: GST rate must be between 0 and 100`);

    const gross = r2(qty.mul(rate));
    if (disc.gt(gross)) throw badRequest('INVALID_ITEM', `Item ${idx + 1}: discount cannot exceed the item amount`);
    const tx = gross.minus(r2(disc));
    const g = r2(tx.mul(gstRate).div(100));
    subtotal = subtotal.plus(gross); discount = discount.plus(r2(disc)); taxable = taxable.plus(tx); gst = gst.plus(g);
    return {
      sort_order: idx,
      description: String(it.description).trim(),
      hsn_sac: it.hsn_sac || null,
      quantity: qty.toDecimalPlaces(3).toFixed(3),
      unit: it.unit || null,
      rate: money(rate),
      discount: money(disc),
      taxable_amount: money(tx),
      gst_rate: gstRate.toDecimalPlaces(2).toFixed(2),
      gst_amount: money(g),
      total_amount: money(tx.plus(g)),
    };
  });

  let cgst = D(0); let sgst = D(0); let igst = D(0);
  if (supplyType === 'INTER_STATE') igst = gst;
  else { cgst = r2(gst.div(2)); sgst = gst.minus(cgst); }

  return {
    items,
    totals: {
      subtotal: money(subtotal), discount: money(discount), taxable_amount: money(taxable),
      cgst: money(cgst), sgst: money(sgst), igst: money(igst),
      gst_total: money(gst), grand_total: money(taxable.plus(gst)),
    },
  };
}

/** Intra-state when company and customer state match (case-insensitive); otherwise inter-state. */
function detectSupplyType(companyState, customerState, override) {
  if (override === 'INTRA_STATE' || override === 'INTER_STATE') return override;
  const a = String(companyState || '').trim().toLowerCase();
  const b = String(customerState || '').trim().toLowerCase();
  if (!a || !b) return 'INTRA_STATE';
  return a === b ? 'INTRA_STATE' : 'INTER_STATE';
}

/** Payment threshold rule (Rule A). paid/total are money strings. */
function meetsConversionThreshold(total, paid, settings) {
  if (!settings.bool('invoice_requires_full_payment')) return true;
  const threshold = D(settings.num('invoice_conversion_payment_threshold') || 100);
  if (D(total).lte(0)) return true;
  return D(paid).mul(100).gte(D(total).mul(threshold));
}

/** Invoice status from amounts + due date (Rules 5-7). */
function deriveInvoiceStatus({ status, grand_total, amount_paid, due_date }, todayStr) {
  if (['DRAFT', 'CANCELLED', 'VOID'].includes(status)) return status;
  const balance = D(grand_total).minus(D(amount_paid));
  if (balance.lte(0)) return 'PAID';
  if (due_date && todayStr > String(due_date).slice(0, 10)) return 'OVERDUE';
  if (D(amount_paid).gt(0)) return 'PARTIALLY_PAID';
  return 'ISSUED';
}

module.exports = { computeDocument, detectSupplyType, meetsConversionThreshold, deriveInvoiceStatus };
