import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api.js';
import { useFetch, PageHeader, Card, Table, Loading, ErrorBox, Field, Badge, Modal, useToast, Confirm } from '../ui.jsx';
import { inr, fdate, todayStr, TERMS } from '../format.js';
import { useAuth } from '../auth.jsx';

const FREQ = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'];
const blank = (customer = '') => ({ customer_id: customer, billing_frequency: 'MONTHLY', custom_interval_days: '', billing_day: 1, billing_amount: '', gst_rate: '18', item_description: 'Monthly service charges', hsn_sac: '', payment_terms_days: 10, auto_create_estimate: true, auto_convert_invoice: true, reminder_days: '', start_date: todayStr(), end_date: '', status: 'ACTIVE', notes: '' });

function CycleForm({ cycle, customers, onClose, onSaved }) {
  const toast = useToast(); const [f, setF] = useState(cycle); const [busy, setBusy] = useState(false); const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, customer_id: Number(f.customer_id), billing_day: Number(f.billing_day), payment_terms_days: Number(f.payment_terms_days), custom_interval_days: f.custom_interval_days || null, end_date: f.end_date || null, reminder_days: f.reminder_days || null, hsn_sac: f.hsn_sac || null, next_billing_date: f.next_billing_date || undefined };
      ['id', 'company_id', 'customer_name', 'total_with_gst', 'failed_jobs', 'created_at', 'updated_at', 'last_billing_date'].forEach((k) => delete body[k]);
      body.auto_create_estimate = !!f.auto_create_estimate; body.auto_convert_invoice = !!f.auto_convert_invoice;
      if (f.id) await api.put(`/billing/cycles/${f.id}`, body); else await api.post('/billing/cycles', body);
      toast('Billing cycle saved'); onSaved();
    } catch (e) { toast(errMsg(e), 'err'); }
    setBusy(false);
  };
  return (
    <Modal wide title={f.id ? 'Edit billing cycle' : 'New billing cycle'} onClose={onClose}>
      <div className="form" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <Field label="Customer *"><select value={f.customer_id} onChange={set('customer_id')} disabled={!!f.id}><option value="">Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Frequency"><select value={f.billing_frequency} onChange={set('billing_frequency')}>{FREQ.map((x) => <option key={x}>{x}</option>)}</select></Field>
        {f.billing_frequency === 'CUSTOM' && <Field label="Every (days)"><input type="number" value={f.custom_interval_days || ''} onChange={set('custom_interval_days')} /></Field>}
        <Field label="Billing day of month"><input type="number" min="1" max="31" value={f.billing_day} onChange={set('billing_day')} /></Field>
        <Field label="Amount (before GST) *"><input type="number" step="0.01" value={f.billing_amount} onChange={set('billing_amount')} /></Field>
        <Field label="GST %"><input type="number" step="0.01" value={f.gst_rate} onChange={set('gst_rate')} /></Field>
        <Field label="Item description"><input value={f.item_description} onChange={set('item_description')} /></Field>
        <Field label="HSN/SAC"><input value={f.hsn_sac || ''} onChange={set('hsn_sac')} /></Field>
        <Field label="Payment terms"><select value={f.payment_terms_days} onChange={set('payment_terms_days')}>{TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Start date"><input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="End date (optional)"><input type="date" value={f.end_date || ''} onChange={set('end_date')} /></Field>
        {f.id && <Field label="Next billing date"><input type="date" value={f.next_billing_date} onChange={set('next_billing_date')} /></Field>}
        <Field label="Reminder days before" hint="Comma separated, e.g. 7,3,1,0. Blank = company default"><input value={f.reminder_days || ''} onChange={set('reminder_days')} /></Field>
        <Field label="Status"><select value={f.status} onChange={set('status')}><option>ACTIVE</option><option>PAUSED</option><option>ENDED</option></select></Field>
        <label className="chk"><input type="checkbox" checked={!!f.auto_create_estimate} onChange={set('auto_create_estimate')} />Auto-create estimate on billing date</label>
        <label className="chk"><input type="checkbox" checked={!!f.auto_convert_invoice} onChange={set('auto_convert_invoice')} />Auto-invoice when 100% paid</label>
        <div className="wide row gap end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

export function Billing() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const toast = useToast(); const { isAdmin } = useAuth();
  const [tab, setTab] = useState(sp.get('tab') || 'cycles'); const [edit, setEdit] = useState(null); const [del, setDel] = useState(null);
  useEffect(() => { if (sp.get('tab')) setTab(sp.get('tab')); }, [sp]);
  useEffect(() => { if (sp.get('customer') && !edit) setEdit(blank(sp.get('customer'))); /* eslint-disable-next-line */ }, []);
  const { data: customers } = useFetch(() => api.get('/customers', { params: { limit: 200, status: 'ACTIVE' } }), []);
  const cycles = useFetch(() => api.get('/billing/cycles'), []); const upcoming = useFetch(() => api.get('/billing/upcoming', { params: { days: 60 } }), []); const jobs = useFetch(() => api.get('/billing/jobs'), []);
  const reloadAll = () => { cycles.reload(); upcoming.reload(); jobs.reload(); };
  const generate = async (c) => { try { const { data } = await api.post(`/billing/${c.id}/generate`); toast(data.data.created ? `Estimate ${data.data.estimate_number} created` : `Estimate ${data.data.estimate_number} already exists for ${data.data.period}`); reloadAll(); } catch (e) { toast(errMsg(e), 'err'); } };
  const remove = async () => { try { const { data } = await api.delete(`/billing/cycles/${del.id}`); toast(data.data.ended ? 'Cycle ended (billing history kept)' : 'Cycle deleted'); setDel(null); reloadAll(); } catch (e) { toast(errMsg(e), 'err'); setDel(null); } };
  const runNow = async () => { try { const { data } = await api.post('/billing/run-scheduler'); toast(`Scheduler run: ${data.data.map((r) => `${r.created} created, ${r.sent} reminders`).join('; ')}`); reloadAll(); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <>
      <PageHeader title="Billing" sub="Recurring billing creates an estimate automatically; the invoice is generated once 100% is paid."><button className="btn primary" onClick={() => setEdit(blank())}>+ New billing cycle</button>{isAdmin && <button className="btn" onClick={runNow}>Run scheduler now</button>}</PageHeader>
      <div className="tabs">{[['cycles', 'Billing Cycles'], ['upcoming', 'Upcoming Billing'], ['jobs', `Failed jobs${jobs.data?.length ? ` (${jobs.data.length})` : ''}`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSp({ tab: k }); }}>{l}</button>)}</div>
      {tab === 'cycles' && <Card>{cycles.error && <ErrorBox msg={cycles.error} retry={cycles.reload} />}{cycles.loading && !cycles.data ? <Loading /> :
        <Table rows={cycles.data} empty="No billing cycles yet." cols={[
          { key: 'customer_name', label: 'Customer', render: (r) => <b>{r.customer_name}</b> }, { key: 'billing_frequency', label: 'Frequency', render: (r) => `${r.billing_frequency} · day ${r.billing_day}` }, { key: 'total_with_gst', label: 'Amount incl. GST', align: 'right', render: (r) => inr(r.total_with_gst) },
          { key: 'next_billing_date', label: 'Next billing', render: (r) => fdate(r.next_billing_date) }, { key: 'last_billing_date', label: 'Last billed', render: (r) => fdate(r.last_billing_date) }, { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'a', label: '', render: (r) => <span className="row gap"><button className="btn sm" onClick={() => setEdit({ ...r, custom_interval_days: r.custom_interval_days || '', auto_create_estimate: !!r.auto_create_estimate, auto_convert_invoice: !!r.auto_convert_invoice })}>Edit</button>{r.status === 'ACTIVE' && <button className="btn sm" onClick={() => generate(r)}>Create estimate now</button>}{isAdmin && <button className="btn sm danger" onClick={() => setDel(r)}>End</button>}</span> }]} />}</Card>}
      {tab === 'upcoming' && <Card>{upcoming.loading && !upcoming.data ? <Loading /> :
        <Table rows={upcoming.data} empty="No upcoming billing in the next 60 days." cols={[
          { key: 'customer_name', label: 'Customer' }, { key: 'total_with_gst', label: 'Amount incl. GST', align: 'right', render: (r) => inr(r.total_with_gst) }, { key: 'next_billing_date', label: 'Billing date', render: (r) => fdate(r.next_billing_date) },
          { key: 'a', label: 'Actions', render: (r) => <span className="row gap"><button className="btn sm" onClick={() => nav(`/customers/${r.customer_id}`)}>View customer</button><button className="btn sm" onClick={() => generate(r)}>Create estimate</button><button className="btn sm" onClick={() => nav(`/invoices/new?customer=${r.customer_id}`)}>Create invoice</button></span> }]} />}</Card>}
      {tab === 'jobs' && <Card>{jobs.data?.length === 0 ? <div className="empty">No failed billing jobs 🎉</div> : <Table rows={jobs.data} cols={[{ key: 'customer_name', label: 'Customer' }, { key: 'billing_period', label: 'Period' }, { key: 'attempts', label: 'Attempts' }, { key: 'last_error', label: 'Error' }, { key: 'updated_at', label: 'Last tried', render: (r) => fdate(r.updated_at) }]} />}<p className="muted">Failed jobs are retried automatically every hour and never create duplicate estimates.</p></Card>}
      {edit && <CycleForm cycle={edit} customers={customers || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadAll(); }} />}
      {del && <Confirm danger title="End billing cycle?" message={`Stop recurring billing for ${del.customer_name}? Existing estimates and invoices are kept.`} yes="End cycle" onYes={remove} onNo={() => setDel(null)} />}
    </>
  );
}
