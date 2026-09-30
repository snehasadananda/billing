import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, errMsg } from '../api.js';
import { useFetch, PageHeader, Card, Table, Pagination, Loading, ErrorBox, Field, Badge, useToast, Confirm } from '../ui.jsx';
import { inr, fdate, STATES, TERMS } from '../format.js';

export function CustomerList() {
  const nav = useNavigate(); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, meta, loading, error, reload } = useFetch(() => api.get('/customers', { params: { q: term, status, page, limit: 25 } }), [term, status, page]);
  return (
    <>
      <PageHeader title="Customers"><Link className="btn primary" to="/customers/new">+ Add Customer</Link></PageHeader>
      <Card>
        <div className="row gap wrap" style={{ marginBottom: 12 }}>
          <input style={{ maxWidth: 320 }} placeholder="Search name, mobile, email, GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>ACTIVE</option><option>INACTIVE</option></select>
        </div>
        {error && <ErrorBox msg={error} retry={reload} />}{loading && !data ? <Loading /> :
          <Table rows={data} onRow={(r) => nav(`/customers/${r.id}`)} cols={[
            { key: 'name', label: 'Customer', render: (r) => <><b>{r.name}</b>{r.company_name && <div className="muted">{r.company_name}</div>}</> },
            { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN', render: (r) => r.gstin || '-' },
            { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => inr(r.outstanding) }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }]} />}
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

const EMPTY = { name: '', company_name: '', contact_person: '', mobile: '', email: '', billing_address: '', shipping_address: '', city: '', state: '', country: 'India', pin_code: '', gstin: '', pan: '', customer_type: 'BUSINESS', payment_terms_days: '', default_gst_rate: '', notes: '', status: 'ACTIVE' };

export function CustomerForm() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const [f, setF] = useState(EMPTY); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState({});
  useEffect(() => { if (id) api.get(`/customers/${id}`).then(({ data }) => setF({ ...EMPTY, ...Object.fromEntries(Object.entries(data.data).map(([k, v]) => [k, v ?? ''])) })); }, [id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrs({});
    try {
      const body = { ...f }; delete body.summary;
      const { data } = id ? await api.put(`/customers/${id}`, body) : await api.post('/customers', body);
      toast('Customer saved'); nav(`/customers/${id || data.data.id}`);
    } catch (x) { const d = x.response?.data?.details; if (d) setErrs(Object.fromEntries(d.map((i) => [i.field, i.message]))); toast(errMsg(x), 'err'); }
    setBusy(false);
  };
  const T = (k, l, p = {}) => <Field label={l} error={errs[k]}><input value={f[k]} onChange={set(k)} {...p} /></Field>;
  return (
    <>
      <PageHeader title={id ? 'Edit Customer' : 'Add Customer'} />
      <form onSubmit={save}><Card>
        <div className="form">
          {T('name', 'Customer name *', { required: true })}{T('company_name', 'Company name')}{T('contact_person', 'Contact person')}
          {T('mobile', 'Mobile')}{T('email', 'Email', { type: 'email' })}
          <Field label="Customer type"><select value={f.customer_type} onChange={set('customer_type')}>{['INDIVIDUAL', 'BUSINESS', 'COMPANY', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Billing address" wide><textarea value={f.billing_address} onChange={set('billing_address')} /></Field>
          <Field label="Shipping address (blank = same as billing)" wide><textarea value={f.shipping_address} onChange={set('shipping_address')} /></Field>
          {T('city', 'City')}
          <Field label="State" hint="Decides CGST+SGST (same state) or IGST"><input list="states" value={f.state} onChange={set('state')} /><datalist id="states">{STATES.map((s) => <option key={s} value={s} />)}</datalist></Field>
          {T('pin_code', 'PIN code')}{T('country', 'Country')}{T('gstin', 'GSTIN', { maxLength: 15, style: { textTransform: 'uppercase' } })}{T('pan', 'PAN')}
          <Field label="Payment terms"><select value={f.payment_terms_days} onChange={set('payment_terms_days')}><option value="">Company default</option>{TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Default GST rate %"><input type="number" step="0.01" value={f.default_gst_rate} onChange={set('default_gst_rate')} placeholder="Company default" /></Field>
          <Field label="Status"><select value={f.status} onChange={set('status')}><option>ACTIVE</option><option>INACTIVE</option></select></Field>
          <Field label="Notes" wide><textarea value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="row gap end" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></div>
      </Card></form>
    </>
  );
}

export function CustomerDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const [del, setDel] = useState(false);
  const { data: c, loading, error } = useFetch(() => api.get(`/customers/${id}`), [id]);
  const { data: tx } = useFetch(() => api.get(`/customers/${id}/transactions`), [id]);
  const remove = async () => { try { await api.delete(`/customers/${id}`); toast('Customer deleted'); nav('/customers'); } catch (e) { toast(errMsg(e), 'err'); setDel(false); } };
  if (loading) return <Loading />; if (error) return <ErrorBox msg={error} />; if (!c) return null;
  const s = c.summary;
  return (
    <>
      <PageHeader title={c.name} sub={c.company_name}>
        <Link className="btn" to={`/customers/${id}/edit`}>Edit</Link><Link className="btn" to={`/estimates/new?customer=${id}`}>New Estimate</Link><Link className="btn" to={`/billing?customer=${id}`}>Billing cycle</Link><button className="btn danger" onClick={() => setDel(true)}>Delete</button>
      </PageHeader>
      <div className="kpis">
        <div className="kpi"><div className="kpi-t">Total Billing</div><div className="kpi-v">{inr(s.total_billing)}</div><div className="kpi-s">{s.total_estimates} estimates</div></div>
        <div className="kpi green"><div className="kpi-t">Total Paid</div><div className="kpi-v">{inr(s.total_paid)}</div></div>
        <div className="kpi amber"><div className="kpi-t">Pending</div><div className="kpi-v">{inr(s.total_pending)}</div></div>
        <div className="kpi red"><div className="kpi-t">Overdue</div><div className="kpi-v">{inr(s.total_overdue)}</div></div>
        <div className="kpi purple"><div className="kpi-t">GST Collected</div><div className="kpi-v">{inr(s.total_gst_collected)}</div></div>
      </div>
      <Card title="Customer information"><div className="kv">
        {[['Mobile', c.mobile], ['Email', c.email], ['Contact person', c.contact_person], ['Type', c.customer_type], ['GSTIN', c.gstin], ['PAN', c.pan], ['State', c.state], ['Payment terms', c.payment_terms_days != null ? `${c.payment_terms_days} days` : 'Company default'], ['Billing address', [c.billing_address, c.city, c.pin_code].filter(Boolean).join(', ')], ['Notes', c.notes]].map(([k, v]) => <div key={k}><b>{k}</b>{v || '-'}</div>)}
      </div></Card>
      {tx && <>
        <Card title="Estimates"><Table rows={tx.estimates} onRow={(r) => nav(`/estimates/${r.id}`)} cols={[{ key: 'estimate_number', label: 'Number' }, { key: 'estimate_date', label: 'Date', render: (r) => fdate(r.estimate_date) }, { key: 'grand_total', label: 'Total', align: 'right', render: (r) => inr(r.grand_total) }, { key: 'balance_due', label: 'Balance', align: 'right', render: (r) => inr(r.balance_due) }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }]} /></Card>
        <Card title="Invoices"><Table rows={tx.invoices} onRow={(r) => nav(`/invoices/${r.id}`)} cols={[{ key: 'invoice_number', label: 'Number' }, { key: 'invoice_date', label: 'Date', render: (r) => fdate(r.invoice_date) }, { key: 'due_date', label: 'Due', render: (r) => fdate(r.due_date) }, { key: 'grand_total', label: 'Total', align: 'right', render: (r) => inr(r.grand_total) }, { key: 'balance_due', label: 'Balance', align: 'right', render: (r) => inr(r.balance_due) }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }]} /></Card>
        <Card title="Payments"><Table rows={tx.payments} cols={[{ key: 'payment_date', label: 'Date', render: (r) => fdate(r.payment_date) }, { key: 'receipt_number', label: 'Receipt' }, { key: 'document', label: 'Against' }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) }, { key: 'payment_method', label: 'Method' }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }]} /></Card>
      </>}
      {del && <Confirm danger title="Delete customer?" message="The customer will be hidden but all billing history is kept. This is blocked if unpaid documents exist." yes="Delete" onYes={remove} onNo={() => setDel(false)} />}
    </>
  );
}
