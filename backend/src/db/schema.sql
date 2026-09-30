-- Billing & Invoice Management System : schema (MySQL 8+ / MariaDB 10.5+)
-- All money columns are DECIMAL(15,2). Timestamps are stored in UTC.

CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  logo MEDIUMTEXT NULL,                       -- data URL (png/jpg), kept small
  address VARCHAR(500) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  country VARCHAR(100) NULL DEFAULT 'India',
  pin_code VARCHAR(20) NULL,
  mobile VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  website VARCHAR(200) NULL,
  gstin VARCHAR(20) NULL,
  pan VARCHAR(20) NULL,
  cin VARCHAR(30) NULL,
  bank_name VARCHAR(150) NULL,
  account_number VARCHAR(50) NULL,
  ifsc VARCHAR(20) NULL,
  branch VARCHAR(150) NULL,
  upi_id VARCHAR(100) NULL,
  invoice_prefix VARCHAR(20) NULL,
  default_gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  payment_terms_days INT NOT NULL DEFAULT 15,
  terms_and_conditions TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  mobile VARCHAR(30) NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('ADMIN','STAFF') NOT NULL DEFAULT 'STAFF',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_company (company_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  company_name VARCHAR(200) NULL,
  contact_person VARCHAR(150) NULL,
  mobile VARCHAR(30) NULL,
  email VARCHAR(190) NULL,
  billing_address VARCHAR(500) NULL,
  shipping_address VARCHAR(500) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  country VARCHAR(100) NULL DEFAULT 'India',
  pin_code VARCHAR(20) NULL,
  gstin VARCHAR(20) NULL,
  pan VARCHAR(20) NULL,
  customer_type ENUM('INDIVIDUAL','BUSINESS','COMPANY','OTHER') NOT NULL DEFAULT 'BUSINESS',
  payment_terms_days INT NULL,
  default_gst_rate DECIMAL(5,2) NULL,
  notes TEXT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_customers_company (company_id, deleted_at),
  KEY idx_customers_name (name),
  KEY idx_customers_mobile (mobile),
  KEY idx_customers_email (email),
  CONSTRAINT fk_customers_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  designation VARCHAR(100) NULL,
  email VARCHAR(190) NULL,
  mobile VARCHAR(30) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contacts_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gst_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  rate DECIMAL(5,2) NOT NULL,
  label VARCHAR(50) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gst_company_rate (company_id, rate),
  CONSTRAINT fk_gst_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settings (company_id, setting_key),
  CONSTRAINT fk_settings_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gap-free, concurrency-safe numbering. doc_type: INVOICE (monthly reset), ESTIMATE (monthly), RECEIPT (yearly, month=0)
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  doc_type VARCHAR(20) NOT NULL DEFAULT 'INVOICE',
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_seq (company_id, doc_type, year, month),
  CONSTRAINT fk_seq_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_cycles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  billing_frequency ENUM('MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','CUSTOM') NOT NULL DEFAULT 'MONTHLY',
  custom_interval_days INT NULL,
  billing_day TINYINT UNSIGNED NOT NULL DEFAULT 1,
  billing_amount DECIMAL(15,2) NOT NULL,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  item_description VARCHAR(300) NOT NULL DEFAULT 'Monthly service charges',
  hsn_sac VARCHAR(20) NULL,
  payment_terms_days INT NOT NULL DEFAULT 10,
  auto_create_estimate TINYINT(1) NOT NULL DEFAULT 1,
  auto_convert_invoice TINYINT(1) NOT NULL DEFAULT 1,
  reminder_days VARCHAR(100) NULL,             -- CSV e.g. "7,3,1,0"; NULL => company default
  start_date DATE NOT NULL,
  end_date DATE NULL,
  next_billing_date DATE NOT NULL,
  last_billing_date DATE NULL,
  status ENUM('ACTIVE','PAUSED','ENDED') NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cycles_due (company_id, status, next_billing_date),
  CONSTRAINT fk_cycles_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_cycles_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  estimate_id INT UNSIGNED NULL,
  invoice_number VARCHAR(30) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  payment_terms_days INT NOT NULL DEFAULT 0,
  supply_type ENUM('INTRA_STATE','INTER_STATE') NOT NULL DEFAULT 'INTRA_STATE',
  customer_name VARCHAR(200) NOT NULL,
  customer_gstin VARCHAR(20) NULL,
  billing_address VARCHAR(700) NULL,
  shipping_address VARCHAR(700) NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  taxable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst DECIMAL(15,2) NOT NULL DEFAULT 0,
  gst_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_due DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','VOID') NOT NULL DEFAULT 'ISSUED',
  notes TEXT NULL,
  terms TEXT NULL,
  cancel_reason VARCHAR(300) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_number (company_id, invoice_number),
  KEY idx_invoices_customer (customer_id),
  KEY idx_invoices_status (company_id, status, due_date),
  KEY idx_invoices_date (company_id, invoice_date),
  CONSTRAINT fk_invoices_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  description VARCHAR(500) NOT NULL,
  hsn_sac VARCHAR(20) NULL,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  unit VARCHAR(20) NULL,
  rate DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  taxable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  gst_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  KEY idx_invitems_invoice (invoice_id),
  CONSTRAINT fk_invitems_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  estimate_number VARCHAR(30) NOT NULL,
  estimate_date DATE NOT NULL,
  valid_until DATE NULL,
  due_date DATE NULL,                          -- payment due date (used for overdue tracking)
  payment_terms_days INT NOT NULL DEFAULT 0,
  supply_type ENUM('INTRA_STATE','INTER_STATE') NOT NULL DEFAULT 'INTRA_STATE',
  customer_name VARCHAR(200) NOT NULL,
  customer_gstin VARCHAR(20) NULL,
  billing_address VARCHAR(700) NULL,
  shipping_address VARCHAR(700) NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  taxable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst DECIMAL(15,2) NOT NULL DEFAULT 0,
  gst_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_due DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('DRAFT','AUTO_GENERATED','SENT','VIEWED','ACCEPTED','REJECTED','EXPIRED','PAYMENT_PENDING','PAID','CONVERTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  billing_cycle_id INT UNSIGNED NULL,
  billing_period CHAR(7) NULL,                 -- 'YYYY-MM' (idempotency key for recurring billing)
  converted_invoice_id INT UNSIGNED NULL,
  sent_at TIMESTAMP NULL,
  accepted_at TIMESTAMP NULL,
  notes TEXT NULL,
  terms TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_estimate_number (company_id, estimate_number),
  UNIQUE KEY uq_estimate_cycle_period (billing_cycle_id, billing_period),
  KEY idx_estimates_customer (customer_id),
  KEY idx_estimates_status (company_id, status),
  KEY idx_estimates_date (company_id, estimate_date),
  CONSTRAINT fk_estimates_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_estimates_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_estimates_cycle FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id),
  CONSTRAINT fk_estimates_invoice FOREIGN KEY (converted_invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimate_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  estimate_id INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  description VARCHAR(500) NOT NULL,
  hsn_sac VARCHAR(20) NULL,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  unit VARCHAR(20) NULL,
  rate DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  taxable_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  gst_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  KEY idx_estitems_estimate (estimate_id),
  CONSTRAINT fk_estitems_estimate FOREIGN KEY (estimate_id) REFERENCES estimates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  estimate_id INT UNSIGNED NULL,
  invoice_id INT UNSIGNED NULL,
  receipt_number VARCHAR(30) NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method ENUM('CASH','BANK_TRANSFER','UPI','CHEQUE','CARD','PAYMENT_GATEWAY','OTHER') NOT NULL DEFAULT 'BANK_TRANSFER',
  transaction_id VARCHAR(100) NULL,
  reference_number VARCHAR(100) NULL,
  bank VARCHAR(100) NULL,
  notes TEXT NULL,
  status ENUM('VALID','CANCELLED') NOT NULL DEFAULT 'VALID',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_receipt (company_id, receipt_number),
  KEY idx_payments_customer (customer_id),
  KEY idx_payments_estimate (estimate_id),
  KEY idx_payments_invoice (invoice_id),
  KEY idx_payments_date (company_id, payment_date, status),
  CONSTRAINT fk_payments_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_payments_estimate FOREIGN KEY (estimate_id) REFERENCES estimates(id),
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  billing_cycle_id INT UNSIGNED NOT NULL,
  billing_period CHAR(7) NOT NULL,
  status ENUM('FAILED','SUCCESS') NOT NULL DEFAULT 'FAILED',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  admin_notified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_billing_job (billing_cycle_id, billing_period),
  CONSTRAINT fk_jobs_cycle FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,                   -- NULL => visible to all users of the company
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(500) NOT NULL,
  reference_type VARCHAR(30) NULL,
  reference_id INT UNSIGNED NULL,
  dedupe_key VARCHAR(190) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_dedupe (company_id, dedupe_key),
  KEY idx_notif_company (company_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  module VARCHAR(40) NOT NULL,
  record_id VARCHAR(40) NULL,
  old_value MEDIUMTEXT NULL,
  new_value MEDIUMTEXT NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_module (module, record_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
