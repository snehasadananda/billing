import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, openFile } from '../api.js';
import { useFetch, PageHeader, Card, Loading, ErrorBox, PeriodPicker, Empty } from '../ui.jsx';
import { inr, fdate, PAYMENT_METHODS, label } from '../format.js';

const TITLES = { sales: 'Sales Report', collection: 'Collection Report', gst: 'GST Report', customers: 'Customer-wise Report', outstanding: 'Outstanding Report', pending: 'Pending Report', overdue: 'Overdue Report', payments: 'Payment Report', estimates: 'Estimate Report', monthly: 'Monthly Report' };
const NO_PERIOD = ['outstanding', 'pending', 'overdue'];

export default function Reports() {
  const { type } = useParams(); const [p, setP] = useState({ period: 'this_fy' }); const [method, setMethod] = useState(''); const [month, setMonth] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  useEffect(() => { setMethod(''); }, [type]);
  const params = { ...(p.period === 'custom' && !(p.from && p.to) ? { period: 'this_fy' } : p), ...(type === 'payments' && method ? { method } : {}), ...(type === 'monthly' ? { month } : {}) };
  const { data: r, loading, error, reload } = useFetch(() => api.get(`/reports/${type}`, { params }), [type, JSON.stringify(params)]);
  return (
    <>
      <PageHeader title={TITLES[type] || 'Report'} sub={r ? r.periodLabel : ''} />
      <Card>
        <div className="row gap wrap between">
          <div className="row gap wrap">
            {type === 'monthly' ? <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /> : !NO_PERIOD.includes(type) && <PeriodPicker value={p} onChange={setP} />}
            {type === 'payments' && <select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">All methods</option>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>}
          </div>
          <div className="row gap wrap">
            <PdfBtn type={type} params={params} /><CsvBtn type={type} params={params} />
            <Link className="btn" to="/reports/sales">All reports</Link>
          </div>
        </div>
      </Card>
      {error && <ErrorBox msg={error} retry={reload} />}{loading && !r ? <Loading /> : r && (
        <>
          {r.summary?.length > 0 && <div className="kpis">{r.summary.map((s) => <div className="kpi" key={s.label}><div className="kpi-t">{s.label}</div><div className="kpi-v" style={{ fontSize: 19 }}>{s.money ? inr(s.value) : s.value}</div></div>)}</div>}
          {r.note && <div className="alert blue">{r.note}</div>}
          {r.columns.length > 0 && <Card>{r.rows.length === 0 ? <Empty>No records for this period.</Empty> : (
            <div className="table-wrap"><table className="tbl"><thead><tr>{r.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <td key={c.key} data-label={c.label} className={c.type === 'money' || c.type === 'number' ? 'r mono' : ''}>{c.type === 'money' ? inr(row[c.key]) : c.type === 'date' ? fdate(row[c.key]) : (row[c.key] ?? '-')}</td>)}</tr>)}</tbody></table></div>)}</Card>}
        </>
      )}
    </>
  );
}

function PdfBtn({ type, params }) {
  return <button className="btn" onClick={async () => { const q = new URLSearchParams(params).toString(); await openFileQ(`/reports/${type}/pdf?${q}`, false); }}>PDF</button>;
}
function CsvBtn({ type, params }) {
  return <button className="btn" onClick={async () => { const q = new URLSearchParams(params).toString(); await openFileQ(`/reports/${type}/csv?${q}`, true, `${type}-report.csv`); }}>CSV</button>;
}
// query string is already embedded in the path, so reuse openFile without extra params
const openFileQ = (path, download, filename) => openFile(path, { download, filename });
