const { z, dateStr, optStr, idNum } = require('./http');

/** Numbers arrive as strings or numbers; kept as strings so decimal math never touches floats. */
const numStr = z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Enter a valid number');

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(500),
  hsn_sac: optStr(20),
  quantity: numStr,
  unit: optStr(20),
  rate: numStr,
  discount: numStr.optional().default('0'),
  gst_rate: numStr.optional().nullable(),
});

const baseDoc = {
  customer_id: idNum,
  payment_terms_days: z.coerce.number().int().min(0).max(365).optional().nullable(),
  supply_type: z.enum(['INTRA_STATE', 'INTER_STATE']).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Add at least one item').max(200),
  notes: optStr(2000),
  terms: optStr(5000),
};

const estimateSchema = z.object({ ...baseDoc, estimate_date: dateStr.optional(), valid_until: dateStr.optional().nullable() });
const invoiceSchema = z.object({ ...baseDoc, invoice_date: dateStr.optional() });

const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'PAYMENT_GATEWAY', 'OTHER'];
const paymentSchema = z.object({
  estimate_id: idNum.optional().nullable(),
  invoice_id: idNum.optional().nullable(),
  amount: numStr,
  payment_date: dateStr.optional(),
  payment_method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  transaction_id: optStr(100), reference_number: optStr(100), bank: optStr(100), notes: optStr(1000),
});

module.exports = { numStr, itemSchema, estimateSchema, invoiceSchema, paymentSchema, PAYMENT_METHODS };
