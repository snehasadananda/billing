import { useState, useEffect } from 'react';
import { api, errMsg } from '../api.js';
import { useFetch, PageHeader, Card, Table, Loading, ErrorBox, Field, Badge, Modal, useToast, Pagination } from '../ui.jsx';
import { fdate, STATES, TERMS } from '../format.js';
import { useAuth } from '../auth.jsx';

function CompanyTab() {
  const toast = useToast(); const { reloadCompany, isAdmin } = useAuth(); const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState({});
  useEffect(() => { api.get('/settings/company').then(({ data }) => setF(Object.fromEntries(Object.entries(data.data).map(([k, v]) => [k, v ?? ''])))); }, []);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const logo = (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 400000) { toast('Logo must be under 400 KB', 'err'); return; } const r = new FileReader(); r.onload = () => setF({ ...f, logo: r.result }); r.readAsDataURL(file); };
  const save = async () => {
    setBusy(true); setErrs({});
    try { const body = { ...f }; ['id', 'created_at', 'updated_at'].forEach((k) => delete body[k]); await api.put('/settings/company', body); toast('Company profile saved'); reloadCompany(); }
    catch (e) { const d = e.response?.data?.details; if (d) setErrs(Object.fromEntries(d.map((i) => [i.field, i.message]))); toast(errMsg(e), 'err'); }
    setBusy(false);
  };
  const T = (k, l, p = {}) => <Field label={l} error={errs[k]}><input value={f[k]} onChange={set(k)} disabled={!isAdmin} {...p} /></Field>;
  return (
    <Card title="Company profile" actions={isAdmin && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
      <p className="muted">These details print automatically on every estimate, invoice and receipt.{!isAdmin && ' Only administrators can edit them.'}</p>
      <div className="form">
        {T('name', 'Company name *')}{T('mobile', 'Mobile')}{T('email', 'Email')}{T('website', 'Website')}
        <Field label="Logo (PNG/JPG, under 400 KB)"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={logo} disabled={!isAdmin} />{f.logo && <img alt="logo" src={f.logo} style={{ maxHeight: 50, marginTop: 6, objectFit: 'contain', alignSelf: 'flex-start' }} />}</Field>
        <Field label="Address" wide><textarea value={f.address} onChange={set('address')} disabled={!isAdmin} /></Field>
        {T('city', 'City')}<Field label="State (drives CGST/SGST vs IGST)"><input list="cstates" value={f.state} onChange={set('state')} disabled={!isAdmin} /><datalist id="cstates">{STATES.map((s) => <option key={s} value={s} />)}</datalist></Field>{T('country', 'Country')}{T('pin_code', 'PIN code')}
        {T('gstin', 'GSTIN', { maxLength: 15 })}{T('pan', 'PAN')}{T('cin', 'CIN')}
        {T('bank_name', 'Bank name')}{T('account_number', 'Account number')}{T('ifsc', 'IFSC')}{T('branch', 'Branch')}{T('upi_id', 'UPI ID')}
        <Field label="Default GST rate %"><input type="number" step="0.01" value={f.default_gst_rate} onChange={set('default_gst_rate')} disabled={!isAdmin} /></Field>
        <Field label="Default payment terms"><select value={f.payment_terms_days} onChange={set('payment_terms_days')} disabled={!isAdmin}>{[...new Set([...TERMS.map((t) => t[0]), Number(f.payment_terms_days)])].map((v) => <option key={v} value={v}>{v === 0 ? 'Immediate' : `${v} Days`}</option>)}</select></Field>
        <Field label="Default terms & conditions" wide><textarea rows={4} value={f.terms_and_conditions} onChange={set('terms_and_conditions')} disabled={!isAdmin} /></Field>
      </div>
    </Card>
  );
}

function GstTab() {
  const toast = useToast(); const { isAdmin } = useAuth(); const [rate, setRate] = useState('');
  const { data, loading, reload } = useFetch(() => api.get('/gst/rates'), []);
  const add = async () => { try { await api.post('/gst/rates', { rate }); setRate(''); toast('GST rate added'); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const toggle = async (r) => { try { await api.put(`/gst/rates/${r.id}`, { is_active: !r.is_active }); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <Card title="GST rates" actions={isAdmin && <div className="row gap"><input type="number" step="0.01" placeholder="Custom rate %" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 140 }} /><button className="btn primary" disabled={!rate} onClick={add}>Add rate</button></div>}>
      {loading && !data ? <Loading /> : <Table rows={data} cols={[{ key: 'label', label: 'Rate', render: (r) => <b>{Number(r.rate)}%</b> }, { key: 's', label: 'Status', render: (r) => <Badge status={r.is_active ? 'ACTIVE' : 'INACTIVE'} /> }, { key: 'a', label: '', render: (r) => isAdmin && <button className="btn sm" onClick={() => toggle(r)}>{r.is_active ? 'Disable' : 'Enable'}</button> }]} />}
      <p className="muted">Rates are never hard-coded. Disabled rates disappear from the item dropdown but stay on old documents.</p>
    </Card>
  );
}

const BOOLS = [['invoice_requires_full_payment', 'Require full payment before an estimate can be converted to an invoice'], ['auto_create_recurring_estimate', 'Automatically create estimates for recurring billing'], ['auto_convert_to_invoice', 'Automatically convert recurring estimates to invoices once fully paid'], ['billing_reminder_on_due_date', 'Remind on the payment due date'], ['post_due_reminders', 'Send reminders after the due date'], ['allow_advance_payments', 'Allow payments larger than the outstanding amount (advance payments)']];

function RulesTab() {
  const toast = useToast(); const { isAdmin } = useAuth(); const [s, setS] = useState(null); const [emailOk, setEmailOk] = useState(false);
  useEffect(() => { api.get('/settings/business').then(({ data }) => { setS(data.data.settings); setEmailOk(data.data.email_configured); }); }, []);
  if (!s) return <Loading />;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? String(e.target.checked) : e.target.value });
  const save = async () => { try { await api.put('/settings/business', { settings: s }); toast('Settings saved'); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <>
      <Card title="Invoice & payment rules" actions={isAdmin && <button className="btn primary" onClick={save}>Save</button>}>
        <div className="grid">{BOOLS.map(([k, l]) => <label key={k} className="chk"><input type="checkbox" disabled={!isAdmin} checked={s[k] === 'true'} onChange={set(k)} />{l}</label>)}</div>
        <div className="form" style={{ marginTop: 14 }}>
          <Field label="Payment threshold for invoicing (%)"><input type="number" min="1" max="100" value={s.invoice_conversion_payment_threshold} onChange={set('invoice_conversion_payment_threshold')} disabled={!isAdmin} /></Field>
          <Field label="GST calculation basis"><select value={s.gst_calculation_basis} onChange={set('gst_calculation_basis')} disabled={!isAdmin}><option value="collections">On collections (payments received)</option><option value="invoices">On invoices issued</option></select></Field>
          <Field label="Estimate validity (days)"><input type="number" value={s.estimate_validity_days} onChange={set('estimate_validity_days')} disabled={!isAdmin} /></Field>
          <Field label="Label: GST associated with collections"><input value={s.gst_collections_label} onChange={set('gst_collections_label')} disabled={!isAdmin} /></Field>
          <Field label="Label: GST payable"><input value={s.gst_payable_label} onChange={set('gst_payable_label')} disabled={!isAdmin} /></Field>
        </div>
        <div className="alert blue" style={{ marginTop: 12, marginBottom: 0 }}>“GST on Collections” is a management figure (each payment's proportionate share of the document's GST). It is not automatically your legal GST liability — confirm treatment with your tax advisor.</div>
      </Card>
      <Card title="Notifications & reminders" actions={isAdmin && <button className="btn primary" onClick={save}>Save</button>}>
        <div className="form">
          <Field label="Billing reminders (days before billing date)" hint="e.g. 7,3,1,0  (0 = on the billing date)"><input value={s.billing_reminder_days} onChange={set('billing_reminder_days')} disabled={!isAdmin} /></Field>
          <Field label="Collection reminders (days after estimate creation)" hint="while unpaid"><input value={s.collection_reminder_days_after} onChange={set('collection_reminder_days_after')} disabled={!isAdmin} /></Field>
          <Field label="Overdue reminders (days after due date)"><input value={s.overdue_reminder_days_after} onChange={set('overdue_reminder_days_after')} disabled={!isAdmin} /></Field>
        </div>
        <p className="muted">In-app notifications are always on. Email sending is {emailOk ? <b>configured</b> : <b>not configured</b>} (set SMTP_* values in the backend <code>.env</code>).</p>
      </Card>
    </>
  );
}

function UsersTab() {
  const toast = useToast(); const { data, loading, reload } = useFetch(() => api.get('/users'), []); const [edit, setEdit] = useState(null);
  const save = async () => {
    try { if (edit.id) await api.put(`/users/${edit.id}`, { name: edit.name, mobile: edit.mobile || null, role: edit.role, status: edit.status, ...(edit.password ? { password: edit.password } : {}) }); else await api.post('/users', { name: edit.name, email: edit.email, mobile: edit.mobile || null, role: edit.role, password: edit.password }); toast('User saved'); setEdit(null); reload(); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  return (
    <Card title="Users" actions={<button className="btn primary" onClick={() => setEdit({ name: '', email: '', mobile: '', role: 'STAFF', status: 'ACTIVE', password: '' })}>+ Add user</button>}>
      {loading && !data ? <Loading /> : <Table rows={data} cols={[{ key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', render: (r) => <Badge status={r.role === 'ADMIN' ? 'PAID' : 'SENT'}>{r.role}</Badge> }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }, { key: 'last_login', label: 'Last login', render: (r) => fdate(r.last_login) }, { key: 'a', label: '', render: (r) => <button className="btn sm" onClick={() => setEdit({ ...r, mobile: r.mobile || '', password: '' })}>Edit</button> }]} />}
      {edit && <Modal title={edit.id ? 'Edit user' : 'Add user'} onClose={() => setEdit(null)}><div className="grid">
        <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        {!edit.id && <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>}
        <Field label="Mobile"><input value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></Field>
        <Field label="Role"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="ADMIN">Administrator</option><option value="STAFF">Staff</option></select></Field>
        {edit.id && <Field label="Status"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></Field>}
        <Field label={edit.id ? 'New password (leave blank to keep)' : 'Password'} hint="8+ characters, letters and numbers"><input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
        <div className="row gap end"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div></div></Modal>}
    </Card>
  );
}

function SystemTab() {
  const [page, setPage] = useState(1); const [module, setModule] = useState('');
  const b = useFetch(() => api.get('/settings/backup-status'), []); const a = useFetch(() => api.get('/settings/audit-logs', { params: { page, module: module || undefined, limit: 25 } }), [page, module]);
  return (
    <>
      <Card title="Backup status">{b.error && <ErrorBox msg={b.error} />}{b.data && (b.data.last_backup ? <div className={`alert ${b.data.healthy ? 'blue' : 'amber'}`}>Last backup: <b>{b.data.last_backup.file}</b> · {new Date(b.data.last_backup.modified).toLocaleString()} · {(b.data.last_backup.size / 1024).toFixed(0)} KB ({b.data.age_hours} h ago){!b.data.healthy && ' — older than 36 hours, please check your backup cron job.'}</div> : <div className="alert amber">No backups found in <code>{b.data.backup_dir}</code>. Set up the daily backup cron job (see README).</div>)}</Card>
      <Card title="Audit trail" actions={<select value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }}><option value="">All modules</option>{['AUTH', 'CUSTOMER', 'ESTIMATE', 'INVOICE', 'PAYMENT', 'BILLING_CYCLE', 'GST_RATE', 'SETTINGS', 'COMPANY', 'USER'].map((m) => <option key={m}>{m}</option>)}</select>}>
        {a.loading && !a.data ? <Loading /> : <Table rows={a.data} cols={[{ key: 'created_at', label: 'Time (UTC)', render: (r) => r.created_at }, { key: 'user_name', label: 'User', render: (r) => r.user_name || '-' }, { key: 'action', label: 'Action' }, { key: 'module', label: 'Module' }, { key: 'record_id', label: 'Record' }, { key: 'new_value', label: 'Details', render: (r) => <span className="muted" style={{ wordBreak: 'break-all' }}>{(r.new_value || '').slice(0, 90)}</span> }, { key: 'ip_address', label: 'IP' }]} />}
        <Pagination meta={a.meta} onPage={setPage} />
      </Card>
    </>
  );
}

export default function Settings() {
  const { isAdmin } = useAuth(); const tabs = [['company', 'Company'], ['gst', 'GST'], ['rules', 'Invoice & Notifications'], ...(isAdmin ? [['users', 'Users'], ['system', 'Backup & Audit']] : [])]; const [t, setT] = useState('company');
  return (
    <>
      <PageHeader title="Settings" />
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => setT(k)}>{l}</button>)}</div>
      {t === 'company' && <CompanyTab />}{t === 'gst' && <GstTab />}{t === 'rules' && <RulesTab />}{t === 'users' && isAdmin && <UsersTab />}{t === 'system' && isAdmin && <SystemTab />}
    </>
  );
}
