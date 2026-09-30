import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api, errMsg } from './api.js';
import { Modal, Field, useToast, Loading } from './ui.jsx';
import { fdate } from './format.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { CustomerList, CustomerForm, CustomerDetail } from './pages/Customers.jsx';
import { EstimateList, EstimateDetail, InvoiceList, InvoiceDetail, DocForm } from './pages/Documents.jsx';
import { PaymentList, PaymentAdd } from './pages/Payments.jsx';
import { Billing } from './pages/Billing.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Notifications from './pages/Notifications.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['grp', 'Customers'], ['/customers', 'All Customers', 1], ['/customers/new', 'Add Customer', 1],
  ['grp', 'Estimates'], ['/estimates', 'All Estimates', 1], ['/estimates/new', 'Create Estimate', 1],
  ['grp', 'Invoices'], ['/invoices', 'All Invoices', 1], ['/invoices/new', 'Create Invoice', 1],
  ['grp', 'Payments'], ['/payments', 'All Payments', 1], ['/payments/new', 'Add Payment', 1],
  ['grp', 'Billing'], ['/billing', 'Billing Cycles', 1], ['/billing?tab=upcoming', 'Upcoming Billing', 1],
  ['grp', 'Reports'], ['/reports/sales', 'Sales Report', 1], ['/reports/collection', 'Collection Report', 1], ['/reports/gst', 'GST Report', 1], ['/reports/customers', 'Customer Report', 1], ['/reports/outstanding', 'Outstanding Report', 1],
  ['grp', 'Settings'], ['/settings', 'Settings', 1],
];

function Bell() {
  const [open, setOpen] = useState(false); const [items, setItems] = useState([]); const [unread, setUnread] = useState(0); const nav = useNavigate();
  const refresh = async () => { try { const { data } = await api.get('/notifications', { params: { limit: 8 } }); setItems(data.data); setUnread(data.unread); } catch { /* ignore */ } };
  useEffect(() => { refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, []);
  const go = async (n) => {
    await api.put(`/notifications/${n.id}/read`).catch(() => {}); setOpen(false); refresh();
    const map = { INVOICE: '/invoices/', ESTIMATE: '/estimates/', BILLING_CYCLE: '/billing' };
    if (n.reference_type && map[n.reference_type]) nav(map[n.reference_type] + (n.reference_type === 'BILLING_CYCLE' ? '' : n.reference_id));
  };
  return (
    <div className="bell">
      <button className="btn" onClick={() => { setOpen(!open); if (!open) refresh(); }}>🔔{unread > 0 && <span className="cnt">{unread}</span>}</button>
      {open && <div className="dd">
        <div className="row between n"><b>Notifications</b><span><button className="btn sm ghost" onClick={async () => { await api.put('/notifications/read-all'); refresh(); }}>Mark all read</button><button className="btn sm ghost" onClick={() => { setOpen(false); nav('/notifications'); }}>View all</button></span></div>
        {items.length === 0 && <div className="n muted">You're all caught up.</div>}
        {items.map((n) => <div key={n.id} className={`n ${n.is_read ? '' : 'unread'}`} style={{ cursor: 'pointer' }} onClick={() => go(n)}><b>{n.title}</b><div>{n.message}</div><div className="muted">{fdate(n.created_at)}</div></div>)}
      </div>}
    </div>
  );
}

function PasswordModal({ onClose }) {
  const toast = useToast(); const [f, setF] = useState({ current_password: '', new_password: '' }); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.post('/auth/change-password', f); toast('Password changed'); onClose(); } catch (e) { toast(errMsg(e), 'err'); } setBusy(false); };
  return <Modal title="Change password" onClose={onClose}>
    <div className="grid"><Field label="Current password"><input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
      <Field label="New password" hint="At least 8 characters, letters and numbers"><input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
      <div className="row end"><button className="btn primary" disabled={busy} onClick={save}>Update password</button></div></div>
  </Modal>;
}

function Shell() {
  const { user, company, logout } = useAuth(); const [open, setOpen] = useState(false); const [pw, setPw] = useState(false); const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  return (
    <div className="layout">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">🧾 {company?.name || 'Billing'}</div>
        {NAV.map(([to, text, sub], i) => to === 'grp' ? <div key={i} className="grp">{text}</div>
          : <NavLink key={i} to={to} end={to === '/'} className={({ isActive }) => `${sub ? 'sub' : ''} ${isActive && !to.includes('?') ? 'active' : ''}`}>{text}</NavLink>)}
      </aside>
      <div className="main">
        <div className="top">
          <button className="btn burger" onClick={() => setOpen(!open)}>☰</button><span className="muted no-print" />
          <div className="row gap"><Bell /><span className="muted">{user.name} · {user.role}</span><button className="btn sm" onClick={() => setPw(true)}>Password</button><button className="btn sm" onClick={logout}>Sign out</button></div>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/customers" element={<CustomerList />} /><Route path="/customers/new" element={<CustomerForm />} /><Route path="/customers/:id" element={<CustomerDetail />} /><Route path="/customers/:id/edit" element={<CustomerForm />} />
            <Route path="/estimates" element={<EstimateList />} /><Route path="/estimates/new" element={<DocForm kind="estimate" />} /><Route path="/estimates/:id" element={<EstimateDetail />} /><Route path="/estimates/:id/edit" element={<DocForm kind="estimate" />} />
            <Route path="/invoices" element={<InvoiceList />} /><Route path="/invoices/new" element={<DocForm kind="invoice" />} /><Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/payments" element={<PaymentList />} /><Route path="/payments/new" element={<PaymentAdd />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/reports/:type" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  return <Routes><Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} /><Route path="/*" element={user ? <Shell /> : <Navigate to="/login" replace />} /></Routes>;
}
