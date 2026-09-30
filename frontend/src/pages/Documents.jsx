import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { api, errMsg, openFile } from '../api.js';
import { useFetch, PageHeader, Card, Table, Pagination, Loading, ErrorBox, Field, Badge, Modal, useToast, Confirm } from '../ui.jsx';
import { inr, fdate, todayStr, TERMS, label } from '../format.js';
import { useAuth } from '../auth.jsx';
import { PaymentForm } from './Payments.jsx';

const EST_STATUSES = ['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'PAYMENT_PENDING', 'PAID', 'CONVERTED', 'CANCELLED'];
const INV_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'VOID'];

function Filters({ f, setF, statuses }) {
  return (
    <div className="row gap wrap" style={{ marginBottom: 12 }}>
      <input style={{ maxWidth: 260 }} placeholder="Search number, customer, mobile, email…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} /><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} />
      <input type="number" style={{ width: 120 }} placeholder="Min ₹" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value, page: 1 })} /><input type="number" style={{ width: 120 }} placeholder="Max ₹" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value, page: 1 })} />
    </div>
  );
}
const useFilters = () => { const [f, setF] = useState({ q: '', status: '', from: '', to: '', min: '', max: '', page: 1 }); const [dq, setDq] = useState(''); useEffect(() => { const t = setTimeout(() => setDq(f.q), 300); return () => clearTimeout(t); }, [f.q]); return [f, setF, { ...f, q: dq, limit: 25 }]; };

export function EstimateList() {
  const nav = useNavigate(); const [f, setF, params] = useFilters();
  const { data, meta, loading, error, reload } = useFetch(() => api.get('/estimates', { params }), [JSON.stringify(params)]);
  return (
    <>
      <PageHeader title="Estimates"><Link className="btn primary" to="/estimates/new">+ Create Estimate</Link></PageHeader>
      <Card><Filters f={f} setF={setF} statuses={EST_STATUSES} />
        {error && <ErrorBox msg={error} retry={reload} />}{loading && !data ? <Loading /> :
          <Table rows={data} onRow={(r) => nav(`/estimates/${r.id}`)} cols={[
            { key: 'estimate_number', label: 'Number', render: (r) => <b>{r.estimate_number}</b> }, { key: 'customer_name', label: 'Customer' }, { key: 'estimate_date', label: 'Date', render: (r) => fdate(r.estimate_date) },
            { key: 'grand_total', label: 'Total', align: 'right', render: (r) => inr(r.grand_total) }, { key: 'balance_due', label: 'Balance', align: 'right', render: (r) => inr(r.balance_due) },
            { key: 'status', label: 'Status', render: (r) => <><Badge status={r.status} />{r.is_overdue && <> <Badge status="OVERDUE" /></>}</> }]} />}
        <Pagination meta={meta} onPage={(page) => setF({ ...f, page })} />
      </Card>
    </>
  );
}

export function InvoiceList() {
  const nav = useNavigate(); const [f, setF, params] = useFilters();
  const { data, meta, loading, error, reload } = useFetch(() => api.get('/invoices', { params }), [JSON.stringify(params)]);
  return (
    <>
      <PageHeader title="Invoices"><Link className="btn primary" to="/invoices/new">+ Create Invoice</Link></PageHeader>
      <Card><Filters f={f} setF={setF} statuses={INV_STATUSES} />
        {error && <ErrorBox msg={error} retry={reload} />}{loading && !data ? <Loading /> :
          <Table rows={data} onRow={(r) => nav(`/invoices/${r.id}`)} cols={[
            { key: 'invoice_number', label: 'Invoice', render: (r) => <b>{r.invoice_number}</b> }, { key: 'customer_name', label: 'Customer' }, { key: 'invoice_date', label: 'Date', render: (r) => fdate(r.invoice_date) }, { key: 'due_date', label: 'Due', render: (r) => fdate(r.due_date) },
            { key: 'grand_total', label: 'Total', align: 'right', render: (r) => inr(r.grand_total) }, { key: 'balance_due', label: 'Balance', align: 'right', render: (r) => inr(r.balance_due) }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> }]} />}
        <Pagination meta={meta} onPage={(page) => setF({ ...f, page })} />
      </Card>
    </>
  );
}

/* ---------- create / edit form (estimate or invoice) ---------- */
const blankItem = (rate) => ({ description: '', hsn_sac: '', quantity: '1', unit: 'Nos', rate: '', discount: '0', gst_rate: rate });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function DocForm({ kind }) {
  const { id } = useParams(); const [sp] = useSearchParams(); const nav = useNavigate(); const toast = useToast(); const { company } = useAuth();
  const { data: customers } = useFetch(() => api.get('/customers', { params: { limit: 200, status: 'ACTIVE' } }), []);
  const { data: rates } = useFetch(() => api.get('/gst/rates'), []);
  const [f, setF] = useState({ customer_id: sp.get('customer') || '', date: todayStr(), valid_until: '', payment_terms_days: '', supply_type: '', notes: '', terms: '' });
  const [items, setItems] = useState([blankItem('')]); const [busy, setBusy] = useState(false); const [defRate, setDefRate] = useState('18');
  const cust = (customers || []).find((c) => String(c.id) === String(f.customer_id));
  useEffect(() => { api.get('/settings/company').then(({ data }) => { setDefRate(String(Number(data.data.default_gst_rate))); }); }, []);
  useEffect(() => { if (!id) return; api.get(`/estimates/${id}`).then(({ data }) => { const e = data.data; setF({ customer_id: e.customer_id, date: e.estimate_date, valid_until: e.valid_until || '', payment_terms_days: e.payment_terms_days, supply_type: e.supply_type, notes: e.notes || '', terms: e.terms || '' }); setItems(e.items.map((i) => ({ description: i.description, hsn_sac: i.hsn_sac || '', quantity: String(Number(i.quantity)), unit: i.unit || '', rate: i.rate, discount: i.discount, gst_rate: String(Number(i.gst_rate)) }))); }); }, [id]);
  const effRate = (it) => (it.gst_rate !== '' ? it.gst_rate : (cust?.default_gst_rate != null ? String(Number(cust.default_gst_rate)) : defRate));
  const supply = f.supply_type || (cust && company?.state && cust.state && cust.state.trim().toLowerCase() !== company.state.trim().toLowerCase() ? 'INTER_STATE' : 'INTRA_STATE');

  const calc = useMemo(() => { // display-only preview; the server recalculates and is the source of truth
    let sub = 0, disc = 0, tax = 0, gst = 0;
    const rows = items.map((it) => { const g = r2((Number(it.quantity) || 0) * (Number(it.rate) || 0)); const d = Number(it.discount) || 0; const t = r2(g - d); const ga = r2(t * (Number(effRate(it)) || 0) / 100); sub += g; disc += d; tax += t; gst += ga; return { taxable: t, gst: ga, total: r2(t + ga) }; });
    return { rows, sub: r2(sub), disc: r2(disc), tax: r2(tax), gst: r2(gst), cgst: supply === 'INTRA_STATE' ? r2(gst / 2) : 0, sgst: supply === 'INTRA_STATE' ? r2(gst - r2(gst / 2)) : 0, igst: supply === 'INTER_STATE' ? r2(gst) : 0, total: r2(tax + gst) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, supply, cust, defRate]);

  const setItem = (i, k, v) => setItems(items.map((it, x) => (x === i ? { ...it, [k]: v } : it)));
  const save = async () => {
    if (!f.customer_id) { toast('Select a customer', 'err'); return; }
    setBusy(true);
    const body = { customer_id: Number(f.customer_id), [kind === 'estimate' ? 'estimate_date' : 'invoice_date']: f.date, payment_terms_days: f.payment_terms_days === '' ? null : Number(f.payment_terms_days), supply_type: f.supply_type || null, notes: f.notes, terms: f.terms || null,
      items: items.map((it) => ({ ...it, gst_rate: it.gst_rate === '' ? null : it.gst_rate })) };
    if (kind === 'estimate') body.valid_until = f.valid_until || null;
    try {
      const { data } = id ? await api.put(`/estimates/${id}`, body) : await api.post(`/${kind}s`, body);
      toast(`${kind === 'estimate' ? 'Estimate' : 'Invoice'} saved`); nav(`/${kind}s/${id || data.data.id}`);
    } catch (e) { toast(errMsg(e), 'err'); }
    setBusy(false);
  };
  return (
    <>
      <PageHeader title={`${id ? 'Edit' : 'Create'} ${kind === 'estimate' ? 'Estimate' : 'Invoice'}`} sub={kind === 'invoice' ? 'For the standard flow, record payment on an estimate and convert it. Use this for manually billed invoices.' : undefined} />
      <Card>
        <div className="form">
          <Field label="Customer *"><select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="">Select customer…</option>{(customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.company_name ? ` (${c.company_name})` : ''}</option>)}</select></Field>
          <Field label={kind === 'estimate' ? 'Estimate date' : 'Invoice date'}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          {kind === 'estimate' ? <Field label="Valid until"><input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field> : <span />}
          <Field label="Payment terms"><select value={f.payment_terms_days} onChange={(e) => setF({ ...f, payment_terms_days: e.target.value })}><option value="">Customer / company default</option>{TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Tax type" hint={`Auto: ${supply === 'INTRA_STATE' ? 'CGST + SGST (same state)' : 'IGST (other state)'}`}><select value={f.supply_type} onChange={(e) => setF({ ...f, supply_type: e.target.value })}><option value="">Automatic</option><option value="INTRA_STATE">CGST + SGST</option><option value="INTER_STATE">IGST</option></select></Field>
        </div>
      </Card>
      <Card title="Items">
        <div className="table-wrap"><table className="items"><thead><tr><th style={{ width: '26%' }}>Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Discount ₹</th><th>GST %</th><th className="r">Amount</th><th /></tr></thead>
          <tbody>{items.map((it, i) => (
            <tr key={i}>
              <td data-label="Description"><input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Item / service" /></td>
              <td data-label="HSN/SAC"><input value={it.hsn_sac} onChange={(e) => setItem(i, 'hsn_sac', e.target.value)} style={{ width: 90 }} /></td>
              <td data-label="Qty"><input type="number" step="0.001" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} style={{ width: 80 }} /></td>
              <td data-label="Unit"><input value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} style={{ width: 70 }} /></td>
              <td data-label="Rate"><input type="number" step="0.01" value={it.rate} onChange={(e) => setItem(i, 'rate', e.target.value)} style={{ width: 110 }} /></td>
              <td data-label="Discount"><input type="number" step="0.01" value={it.discount} onChange={(e) => setItem(i, 'discount', e.target.value)} style={{ width: 90 }} /></td>
              <td data-label="GST %"><select value={it.gst_rate} onChange={(e) => setItem(i, 'gst_rate', e.target.value)} style={{ width: 90 }}><option value="">Default ({effRate({ gst_rate: '' })}%)</option>{(rates || []).filter((r) => r.is_active).map((r) => <option key={r.id} value={Number(r.rate)}>{Number(r.rate)}%</option>)}</select></td>
              <td data-label="Amount" className="r mono">{inr(calc.rows[i]?.total)}</td>
              <td><button className="btn sm danger" disabled={items.length === 1} onClick={() => setItems(items.filter((_, x) => x !== i))}>✕</button></td>
            </tr>))}</tbody></table></div>
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setItems([...items, blankItem('')])}>+ Add item</button>
        <div className="totals mono" style={{ marginTop: 14 }}>
          <div><span>Subtotal</span><span>{inr(calc.sub)}</span></div><div><span>Discount</span><span>− {inr(calc.disc)}</span></div><div><span>Taxable amount</span><span>{inr(calc.tax)}</span></div>
          {supply === 'INTRA_STATE' ? <><div><span>CGST</span><span>{inr(calc.cgst)}</span></div><div><span>SGST</span><span>{inr(calc.sgst)}</span></div></> : <div><span>IGST</span><span>{inr(calc.igst)}</span></div>}
          <div className="gt"><span>Grand total</span><span>{inr(calc.total)}</span></div>
          <div className="muted" style={{ display: 'block', textAlign: 'right' }}>Final amounts are calculated by the server on save.</div>
        </div>
      </Card>
      <Card><div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Notes"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="Terms & conditions" hint="Blank = company default"><textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
      </div><div className="row gap end" style={{ marginTop: 14 }}><button className="btn" onClick={() => nav(-1)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div></Card>
    </>
  );
}

/* ---------- shared detail pieces ---------- */
function ItemsTable({ d }) {
  return (
    <>
      <Table rows={d.items} cols={[
        { key: 'description', label: 'Description', render: (r) => <>{r.description}{r.hsn_sac && <div className="muted">HSN/SAC {r.hsn_sac}</div>}</> },
        { key: 'quantity', label: 'Qty', align: 'right', render: (r) => `${Number(r.quantity)} ${r.unit || ''}` }, { key: 'rate', label: 'Rate', align: 'right', render: (r) => inr(r.rate) }, { key: 'discount', label: 'Discount', align: 'right', render: (r) => inr(r.discount) },
        { key: 'taxable_amount', label: 'Taxable', align: 'right', render: (r) => inr(r.taxable_amount) }, { key: 'gst_rate', label: 'GST', align: 'right', render: (r) => `${Number(r.gst_rate)}% · ${inr(r.gst_amount)}` }, { key: 'total_amount', label: 'Total', align: 'right', render: (r) => inr(r.total_amount) }]} />
      <div className="totals mono" style={{ marginTop: 12 }}>
        <div><span>Subtotal</span><span>{inr(d.subtotal)}</span></div><div><span>Discount</span><span>− {inr(d.discount)}</span></div><div><span>Taxable amount</span><span>{inr(d.taxable_amount)}</span></div>
        {Number(d.igst) > 0 ? <div><span>IGST</span><span>{inr(d.igst)}</span></div> : <><div><span>CGST</span><span>{inr(d.cgst)}</span></div><div><span>SGST</span><span>{inr(d.sgst)}</span></div></>}
        <div className="gt"><span>Grand total</span><span>{inr(d.grand_total)}</span></div>
        <div><span>Amount paid</span><span>{inr(d.amount_paid)}</span></div><div><b>Balance due</b><b>{inr(d.balance_due)}</b></div>
      </div>
    </>
  );
}
const PaymentsCard = ({ d }) => (
  <Card title="Payments"><Table rows={d.payments} empty="No payments recorded yet." cols={[
    { key: 'payment_date', label: 'Date', render: (r) => fdate(r.payment_date) }, { key: 'receipt_number', label: 'Receipt' }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) }, { key: 'payment_method', label: 'Method', render: (r) => label(r.payment_method) },
    { key: 'transaction_id', label: 'Txn / Ref', render: (r) => r.transaction_id || r.reference_number || '-' }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'a', label: '', render: (r) => <button className="btn sm" onClick={() => openFile(`/payments/${r.id}/receipt`)}>Receipt</button> }]} /></Card>
);
const PdfButtons = ({ base, name }) => (<>
  <button className="btn" onClick={() => openFile(base)}>Preview</button><button className="btn" onClick={() => openFile(base, { download: true, filename: `${name}.pdf` })}>Download PDF</button><button className="btn" onClick={() => openFile(base, { print: true })}>Print</button></>);

export function EstimateDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const [pay, setPay] = useState(false); const [confirm, setConfirm] = useState(null); const [busy, setBusy] = useState(false);
  const { data: e, loading, error, reload } = useFetch(() => api.get(`/estimates/${id}`), [id]);
  if (loading && !e) return <Loading />; if (error) return <ErrorBox msg={error} retry={reload} />; if (!e) return null;
  const outstanding = Number(e.balance_due); const canPay = ['AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED', 'PAYMENT_PENDING'].includes(e.status) && outstanding > 0;
  const canConvert = !['CONVERTED', 'DRAFT', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(e.status);
  const act = async (path, msg, body) => { setBusy(true); try { const { data } = await api.post(`/estimates/${id}/${path}`, body || {}); toast(msg); if (path === 'convert') nav(`/invoices/${data.data.id}`); else reload(); } catch (x) { toast(errMsg(x), 'err'); } setBusy(false); setConfirm(null); };
  return (
    <>
      <PageHeader title={`Estimate ${e.estimate_number}`} sub={<><Badge status={e.status} />{e.is_overdue && <> <Badge status="OVERDUE" /></>} · {e.customer_name}</>}>
        <PdfButtons base={`/estimates/${id}/pdf`} name={e.estimate_number} />
      </PageHeader>
      <Card>
        <div className="row gap wrap">
          {['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED'].includes(e.status) && Number(e.amount_paid) === 0 && <Link className="btn" to={`/estimates/${id}/edit`}>Edit</Link>}
          {['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED'].includes(e.status) && <button className="btn" disabled={busy} onClick={() => act('send', 'Marked as sent')}>Mark as sent</button>}
          {['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED'].includes(e.status) && <button className="btn" disabled={busy} onClick={() => act('send', 'Estimate emailed', { email: true })}>Send by email</button>}
          {['DRAFT', 'AUTO_GENERATED', 'SENT', 'VIEWED'].includes(e.status) && <button className="btn" disabled={busy} onClick={() => act('accept', 'Estimate accepted')}>Customer accepted</button>}
          {['SENT', 'VIEWED', 'ACCEPTED', 'AUTO_GENERATED'].includes(e.status) && Number(e.amount_paid) === 0 && <button className="btn danger" onClick={() => setConfirm('reject')}>Rejected</button>}
          {canPay && <button className="btn primary" onClick={() => setPay(true)}>Record payment</button>}
          {canConvert && <button className="btn primary" disabled={busy || outstanding > 0} title={outstanding > 0 ? 'Full payment must be received before invoicing' : ''} onClick={() => act('convert', 'Invoice generated')}>Convert to invoice</button>}
          {!['CONVERTED', 'CANCELLED'].includes(e.status) && Number(e.amount_paid) === 0 && <button className="btn danger" onClick={() => setConfirm('cancel')}>Cancel estimate</button>}
          {e.converted_invoice_id && <Link className="btn" to={`/invoices/${e.converted_invoice_id}`}>View invoice {e.converted_invoice_number}</Link>}
        </div>
        {canConvert && outstanding > 0 && <div className="alert amber" style={{ marginTop: 12, marginBottom: 0 }}>An invoice can be generated only after 100% payment. Outstanding: <b>{inr(outstanding)}</b></div>}
      </Card>
      <Card title="Details"><div className="kv">{[['Customer', e.customer_name], ['GSTIN', e.customer_gstin], ['Date', fdate(e.estimate_date)], ['Valid until', fdate(e.valid_until)], ['Payment due', fdate(e.due_date)], ['Tax type', e.supply_type === 'INTER_STATE' ? 'IGST' : 'CGST + SGST'], ['Billing address', e.billing_address], ['Notes', e.notes]].map(([k, v]) => <div key={k}><b>{k}</b>{v || '-'}</div>)}</div></Card>
      <Card title="Items"><ItemsTable d={e} /></Card>
      <PaymentsCard d={e} />
      {pay && <Modal title="Record payment" wide onClose={() => setPay(false)}><PaymentForm doc={{ kind: 'estimate', id: e.id, balance: e.balance_due }} onCancel={() => setPay(false)} onDone={(r) => { setPay(false); if (r.invoice) nav(`/invoices/${r.invoice.id}`); else reload(); }} /></Modal>}
      {confirm && <Confirm danger title={confirm === 'reject' ? 'Mark as rejected?' : 'Cancel this estimate?'} message="This cannot be undone." onYes={() => act(confirm, confirm === 'reject' ? 'Estimate rejected' : 'Estimate cancelled')} onNo={() => setConfirm(null)} />}
    </>
  );
}

export function InvoiceDetail() {
  const { id } = useParams(); const toast = useToast(); const { isAdmin } = useAuth(); const [pay, setPay] = useState(false); const [cancel, setCancel] = useState(null); const [reason, setReason] = useState('');
  const { data: i, loading, error, reload } = useFetch(() => api.get(`/invoices/${id}`), [id]);
  if (loading && !i) return <Loading />; if (error) return <ErrorBox msg={error} retry={reload} />; if (!i) return null;
  const canPay = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) && Number(i.balance_due) > 0;
  const doCancel = async () => { try { await api.post(`/invoices/${id}/${cancel}`, { reason }); toast(`Invoice ${cancel === 'void' ? 'voided' : 'cancelled'}`); setCancel(null); reload(); } catch (x) { toast(errMsg(x), 'err'); } };
  const email = async () => { try { await api.post(`/invoices/${id}/email`, {}); toast('Invoice emailed'); } catch (x) { toast(errMsg(x), 'err'); } };
  return (
    <>
      <PageHeader title={`Invoice ${i.invoice_number}`} sub={<><Badge status={i.status} /> · {i.customer_name}</>}><PdfButtons base={`/invoices/${id}/pdf`} name={i.invoice_number} /><button className="btn" onClick={email}>Send Email</button></PageHeader>
      <Card><div className="row gap wrap">
        {canPay && <button className="btn primary" onClick={() => setPay(true)}>Record payment</button>}
        {isAdmin && !['CANCELLED', 'VOID'].includes(i.status) && <><button className="btn danger" onClick={() => setCancel('cancel')}>Cancel invoice</button><button className="btn danger" onClick={() => setCancel('void')}>Void</button></>}
        {i.estimate_id && <Link className="btn" to={`/estimates/${i.estimate_id}`}>From estimate {i.estimate_number}</Link>}
      </div></Card>
      <Card title="Details"><div className="kv">{[['Customer', i.customer_name], ['GSTIN', i.customer_gstin], ['Invoice date', fdate(i.invoice_date)], ['Due date', fdate(i.due_date)], ['Tax type', i.supply_type === 'INTER_STATE' ? 'IGST' : 'CGST + SGST'], ['Billing address', i.billing_address], ['Notes', i.notes], ['Cancel reason', i.cancel_reason]].map(([k, v]) => v || k !== 'Cancel reason' ? <div key={k}><b>{k}</b>{v || '-'}</div> : null)}</div></Card>
      <Card title="Items"><ItemsTable d={i} /></Card>
      <PaymentsCard d={i} />
      {pay && <Modal title="Record payment" wide onClose={() => setPay(false)}><PaymentForm doc={{ kind: 'invoice', id: i.id, balance: i.balance_due }} onCancel={() => setPay(false)} onDone={() => { setPay(false); reload(); }} /></Modal>}
      {cancel && <Modal title={cancel === 'void' ? 'Void invoice' : 'Cancel invoice'} onClose={() => setCancel(null)}><p>The invoice number is retained (numbers are never reused). Payments must be cancelled first.</p><Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="row gap end" style={{ marginTop: 12 }}><button className="btn" onClick={() => setCancel(null)}>Back</button><button className="btn danger" onClick={doCancel}>Confirm</button></div></Modal>}
    </>
  );
}
