// Default business settings (stored per company in the `settings` table; never hard-coded in logic)
module.exports = {
  invoice_requires_full_payment: 'true',
  invoice_conversion_payment_threshold: '100',
  gst_calculation_basis: 'collections', // 'collections' | 'invoices'
  auto_create_recurring_estimate: 'true',
  auto_convert_to_invoice: 'true',
  billing_reminder_days: '7,3,1,0',          // before / on billing date
  collection_reminder_days_after: '1,3,7',   // after estimate creation while unpaid
  overdue_reminder_days_after: '1,3,7,15,30',// after due date while unpaid
  billing_reminder_on_due_date: 'true',
  post_due_reminders: 'true',
  allow_advance_payments: 'false',
  estimate_validity_days: '15',
  email_notifications: 'false',
  gst_payable_label: 'GST Payable',
  gst_collections_label: 'GST on Collections',
};
