import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { useFetch, PageHeader, PeriodPicker, KPI, Card, Loading, ErrorBox, Table, Empty } from '../ui.jsx';
import { inr, inr0, fdate } from '../format.js';

const COLORS = ['#16a34a', '#f59e0b', '#dc2626'];

export default function Dashboard() {
  const [p, setP] = useState({ period: 'this_month' }); const nav = useNavigate();
  const params = p.period === 'custom' && !(p.from && p.to) ? { period: 'this_month' } : p;
  const { data: d, loading, error, reload } = useFetch(() => api.get('/dashboard/summary', { params }), [params.period, params.from, params.to]);
  return (
    <>
      <PageHeader title="Dashboard" sub={d ? `${d.period.label} · ${fdate(d.period.from)} to ${fdate(d.period.to)}` : ''}><PeriodPicker value={p} onChange={setP} /></PageHeader>
      {error && <ErrorBox msg={error} retry={reload} />}
      {loading && !d && <Loading />}
      {d && <>
        <div className="kpis">
          <KPI title="Total Billing" value={d.totalBilling} sub={`${d.documentCount} documents`} />
          <KPI title="Total Collected" value={d.totalCollected} tone="green" />
          <KPI title="Total Pending" value={d.totalPending} tone="amber" />
          <KPI title="Overdue" value={d.totalOverdue} tone="red" />
          <KPI title="GST Invoiced" value={d.gstInvoiced} tone="purple" />
          <KPI title={d.labels.gstCollected || 'GST on Collections'} value={d.gstCollected} tone="purple" />
          <KPI title={d.labels.gstPayable || 'GST Payable'} value={d.gstPayable} tone="purple" sub={`Basis: ${d.gstBasis}`} />
        </div>
        <div className="grid g2">
          <Card title="Monthly billing vs collection (last 12 months)">
            <ResponsiveContainer width="100%" height={260}><BarChart data={d.charts.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => (v >= 100000 ? `${v / 100000}L` : v >= 1000 ? `${v / 1000}k` : v)} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="billed" name="Billed" fill="#93b4fb" /><Bar dataKey="collected" name="Collected" fill="#2456e6" /></BarChart></ResponsiveContainer>
          </Card>
          <Card title="Payment status">
            {d.charts.paymentStatus.every((x) => !x.value) ? <Empty>No data for this period.</Empty> :
              <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={d.charts.paymentStatus} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>{d.charts.paymentStatus.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Pie><Tooltip formatter={(v) => inr(v)} /><Legend /></PieChart></ResponsiveContainer>}
          </Card>
          <Card title="GST on collections by month">
            <ResponsiveContainer width="100%" height={240}><LineChart data={d.charts.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip formatter={(v) => inr(v)} /><Line type="monotone" dataKey="gst" name="GST" stroke="#7c3aed" strokeWidth={2} /></LineChart></ResponsiveContainer>
          </Card>
          <Card title="Top customers by outstanding">
            {d.charts.topOutstanding.length === 0 ? <Empty>Nothing outstanding 🎉</Empty> :
              <ResponsiveContainer width="100%" height={240}><BarChart data={d.charts.topOutstanding} layout="vertical" margin={{ left: 30 }}><XAxis type="number" fontSize={11} tickFormatter={inr0} /><YAxis type="category" dataKey="name" fontSize={11} width={110} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="outstanding" fill="#dc2626" onClick={(b) => nav(`/customers/${b.customer_id}`)} /></BarChart></ResponsiveContainer>}
          </Card>
        </div>
        <div className="grid g2">
          <Card title="Upcoming billing" actions={<Link to="/billing">Manage</Link>}>
            <Table rows={d.upcomingBilling} empty="No active billing cycles." onRow={(r) => nav(`/customers/${r.customer_id}`)} cols={[
              { key: 'customer_name', label: 'Customer' }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amount) }, { key: 'next_billing_date', label: 'Date', render: (r) => fdate(r.next_billing_date) }]} />
          </Card>
          <Card title="Overdue payments" actions={<Link to="/reports/overdue">View all</Link>}>
            <Table rows={d.overdueList} empty="No overdue payments." onRow={(r) => nav(`/${r.doc_type === 'INVOICE' ? 'invoices' : 'estimates'}/${r.id}`)} cols={[
              { key: 'customer_name', label: 'Customer' }, { key: 'doc_no', label: 'Document' }, { key: 'balance_due', label: 'Outstanding', align: 'right', render: (r) => inr(r.balance_due) }, { key: 'days_overdue', label: 'Overdue', render: (r) => `${r.days_overdue} days` }]} />
          </Card>
        </div>
      </>}
    </>
  );
}
