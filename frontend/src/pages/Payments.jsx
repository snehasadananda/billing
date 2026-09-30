import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, errMsg, openFile } from '../api.js';
import { useFetch, PageHeader, Card, Table, Pagination, Loading, ErrorBox, Field, Badge, Modal, useToast, Confirm } from '../ui.jsx';
import { inr, fdate, todayStr, PAYMENT_METHODS, label } from '../format.js';
import { useAuth } from '../auth.jsx';

/** Payment form used on the Payments page and inside estimate/invoice detail. `doc` fixes the target document. */
export function PaymentForm({ doc, onDone, onCancel }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ customer_id: '', target: doc ? `${doc.kind}:${doc.id}` : '', amount: doc ? doc.balance : '', payment_date: todayStr(), payment_method: 'BANK_TRANSFER', transaction_id: '', reference_number: '', bank: '', notes: '' });
  const { data: customers } = useFetch(() => (doc ? Promise.resolve({ data: { data: [] } }) : api.get('/customers', { params: { limit: 200, status: 'ACTIVE' } })), []);
  const [targets, setTargets] = useState([]);
  useEffect(() => {
    if (doc || !f.customer_id) { setTargets([]); return; }
    Promise.all([api.get('/estimates', { params: { customer_id: f.customer_id, limit: 100 } }), api.get('/invoices', { params: { customer_id: f.customer_id, payment_status: 'unpaid', limit: 100 } })]).then(([e, i]) => {
      const ok = ['AUTO_GENERATED', 'SENT', 'VIEWED', 'ACCEPTED', 'PAYMENT_PENDING'];
      setTargets([...e.data.data.filter((x) => ok.includes(x.status) && Number(x.balance_due) > 0).map((x) => ({ key: `estimate:${x.id}`, text: `Estimate ${x.estimate_number} · balance ${inr(x.balance_due)}`, balance: x.balance_due })),
        ...i.data.data.filter((x) => Number(x.balance_due) > 0).map((x) => ({ key: `invoice:${x.id}`, text: `Invoice ${x.invoice_number} · balance ${inr(x.balance_due)}`, balance: x.balance_due }))]);
    });
  }, [f.customer_id, doc]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (e) => { const t = targets.find((x) => x.key === e.target.value); setF({ ...f, target: e.target.value, amount: t ? t.balance : f.amount }); };
  const save = async () => {
    const [kind, id] = f.target.split(':'); if (!kind) { toast('Select an estimate or invoice', 'err'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/payments', { [`${kind}_id`]: Number(id), amount: f.amount, payment_date: f.payment_date, payment_method: f.payment_method, transaction_id: f.transaction_id, reference_number: f.reference_number, bank: f.bank, notes: f.notes });
      const r = data.data;
      toast(r.invoice ? `Payment recorded. Invoice ${r.invoice.number} generated.` : `Payment recorded (receipt ${r.receipt_number})`);
      onDone(r);
    } catch (e) { toast(errMsg(e), 'err'); }
    setBusy(false);
  };
  return (
    <div className="form" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
      {!doc && <Field label="Customer *"><select value={f.customer_id} onChange={set('customer_id')}><option value="">Select…</option>{(customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      {!doc && <Field label="Against *"><select value={f.target} onChange={pick} disabled={!f.customer_id}><option value="">{f.customer_id ? (targets.length ? 'Select document…' : 'No unpaid documents') : 'Select customer first'}</option>{targets.map((t) => <option key={t.key} value={t.key}>{t.text}</option>)}</select></Field>}
      <Field label="Amount *"><input type="number" step="0.01" min="0" value={f.amount} onChange={set('amount')} /></Field>
      <Field label="Payment date"><input type="date" value={f.payment_date} onChange={set('payment_date')} /></Field>
      <Field label="Method"><select value={f.payment_method} onChange={set('payment_method')}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
      <Field label="Transaction ID"><input value={f.transaction_id} onChange={set('transaction_id')} /></Field>
      <Field label="Reference number"><input value={f.reference_number} onChange={set('reference_number')} /></Field>
      <Field label="Bank"><input value={f.bank} onChange={set('bank')} /></Field>
      <Field label="Notes" wide><input value={f.notes} onChange={set('notes')} /></Field>
      <div className="wide row gap end">{onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record payment'}</button></div>
    </div>
  );
}

export function PaymentAdd() {
  const nav = useNavigate();
  return (<><PageHeader title="Add Payment" /><Card><PaymentForm onDone={() => nav('/payments')} onCancel={() => nav(-1)} /></Card></>);
}

export function PaymentList() {
  const { isAdmin } = useAuth(); const toast = useToast(); const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const [term, setTerm] = useState(''); const [method, setMethod] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1); const [cancel, setCancel] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, meta, loading, error, reload } = useFetch(() => api.get('/payments', { params: { q: term, method, from, to, page, limit: 25 } }), [term, method, from, to, page]);
  const doCancel = async () => { try { await api.put(`/payments/${cancel.id}`, { status: 'CANCELLED', notes: 'Cancelled by user' }); toast('Payment cancelled'); setCancel(null); reload(); } catch (e) { toast(errMsg(e), 'err'); setCancel(null); } };
  void sp; void setSp;
  return (
    <>
      <PageHeader title="Payments"><Link className="btn primary" to="/payments/new">+ Add Payment</Link></PageHeader>
      <Card>
        <div className="row gap wrap" style={{ marginBottom: 12 }}>
          <input style={{ maxWidth: 260 }} placeholder="Search customer, txn, reference, invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}><option value="">All methods</option>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        {error && <ErrorBox msg={error} retry={reload} />}{loading && !data ? <Loading /> :
          <Table rows={data} cols={[
            { key: 'payment_date', label: 'Date', render: (r) => fdate(r.payment_date) }, { key: 'receipt_number', label: 'Receipt' }, { key: 'customer_name', label: 'Customer' },
            { key: 'doc', label: 'Against', render: (r) => (r.invoice_number ? <Link to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</Link> : <Link to={`/estimates/${r.estimate_id}`}>{r.estimate_number}</Link>) },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) }, { key: 'payment_method', label: 'Method', render: (r) => label(r.payment_method) }, { key: 'transaction_id', label: 'Txn / Ref', render: (r) => r.transaction_id || r.reference_number || '-' },
            { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
            { key: 'act', label: '', render: (r) => <span className="row gap"><button className="btn sm" onClick={(e) => { e.stopPropagation(); openFile(`/payments/${r.id}/receipt`); }}>Receipt</button>{isAdmin && r.status === 'VALID' && <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); setCancel(r); }}>Cancel</button>}</span> }]} />}
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      {cancel && <Confirm danger title="Cancel this payment?" message={`Payment ${cancel.receipt_number} of ${inr(cancel.amount)} will be reversed and the document balance recalculated. The record stays in the audit trail.`} yes="Cancel payment" onYes={doCancel} onNo={() => setCancel(null)} />}
    </>
  );
}

export { Modal };
