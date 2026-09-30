# Billing & Invoice Management System

React 18 + Vite · Node.js/Express · MySQL 8 (MariaDB 10.5+ also works). Built from the SRS in `docs/`.

## Quick start (local)
```bash
# 1. Create an empty MySQL database and user
# 2. Backend
cd backend
cp .env.example .env        # set DB_*, JWT_SECRET (32+ chars); NODE_ENV=development locally
npm install
npm run migrate             # creates all tables
npm run seed                # company + GST rates + default settings + admin user
npm run dev                 # http://localhost:5000
# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :5000)
```
Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`, then open **Settings → Company** and set your **State** and GSTIN.

Tests (API running against a seeded database): `cd backend && BASE=http://localhost:5000 npm test`

## Business rules implemented (enforced on the server)
* **Rule A - 100% payment before invoice.** `POST /api/estimates/:id/convert` recomputes payments from the database inside a row-locked transaction and refuses with `PAYMENT_INCOMPLETE` until the outstanding amount is 0. The rule and threshold are settings.
* **Invoice numbers `MMMYYYYNNN`** (e.g. `AUG2026001`); serial resets every month; generated only by the backend from `invoice_sequences` using `SELECT ... FOR UPDATE`; `UNIQUE (company_id, invoice_number)` is the second safety net. Covered by a 25-way concurrent test.
* **GST** computed on the server with `decimal.js`; all money columns are `DECIMAL(15,2)`. CGST+SGST vs IGST from company/customer state (overridable). Rates are configurable, never hard-coded.
* **GST on collections** = each payment x (document GST / document total). The dashboard keeps *GST Invoiced*, *GST on Collections* and *GST Payable* separate; the basis is a setting. It is a management figure, not a legal liability.
* **Rule C - recurring billing.** An hourly scheduler creates one estimate per customer/billing period (`UNIQUE (billing_cycle_id, billing_period)` makes it idempotent), sends de-duplicated reminders (before/on billing date, while unpaid, after due date), retries failures and notifies admins after 3 failed attempts, and auto-invoices when 100% is received.
* Payments cannot exceed the outstanding amount (unless advance payments are enabled); partial payments supported; cancelling a payment recalculates the document and is audit-logged. Financial records are cancelled/voided, never deleted.
* Overdue = outstanding > 0 and today > due date. Indian financial year (Apr-Mar) presets on the dashboard and reports.
* Audit log covers logins, customers, estimates, invoices, payments, GST/company/settings changes and users.

## Security
bcrypt password hashing, JWT (HS256), role-based access (Admin/Staff), zod validation, parameterised SQL, helmet headers, strict CORS allow-list, login + global rate limiting, CSV formula-injection guard, no secrets in the frontend. The JWT is sent in an `Authorization` header (not a cookie), so CSRF does not apply.

## Known simplifications (V1)
* A payment belongs to one document (no splitting one payment across several invoices); the `payment_allocations` table from the SRS is not created.
* Email needs SMTP settings in `.env`. WhatsApp, payment gateway and customer portal are future modules.
* `customer_contacts` table exists but has no UI yet.
* The token is stored in `localStorage`; move to httpOnly cookies + CSRF token if you add a public customer portal.

Hosting: see `deploy/DEPLOY.md`.
