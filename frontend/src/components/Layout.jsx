import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';

const NAV = [
  ['Dashboard', '/'],
  ['Customers', '/customers', [['All Customers', '/customers'], ['Add Customer', '/customers/new']]],
  ['Estimates', '/estimates', [['All Estimates', '/estimates'], ['Create Estimate', '/estimates/new']]],
  ['Invoices', '/invoices', [['All Invoices', '/invoices'], ['Create Invoice', '/invoices/new']]],
  ['Payments', '/payments', [['All Payments', '/payments'], ['Add Payment', '/payments?add=1']]],
  ['Billing', '/billing', [['Billing Cycles', '/billing'], ['Upcoming Billing', '/billing?tab=upcoming'], ['Billing Reminders', '/notifications']]],
  ['Reports', '/reports', [['Sales Report', '/reports?type=sales'], ['Collection Report', '/reports?type=collection'], ['GST Report', '/reports?type=gst'], ['Customer Report', '/reports?type=customers'], ['Outstanding Report', '/reports?type=outstanding']]],
  ['Settings', '/settings', null, true],
];

export default function Layout() {
  const { user, company, logout, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/notifications/unread-count').then((r) => alive && setUnread(r.data.data.unread)).catch(() => {});
    load(); const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [loc.pathname]);

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">🧾 {company?.name || 'Billing'}</div>
        {NAV.filter((n) => !n[3] || isAdmin).map(([name, to, subs]) => (
          <div key={name}>
            <NavLink to={to} end={to === '/' || !!subs} className={({ isActive }) => (isActive && !subs ? 'active' : '')}>{name}</NavLink>
            {subs && subs.map(([sn, sto]) => <NavLink key={sto} to={sto} end className={({ isActive }) => `sub ${isActive && loc.pathname + loc.search === sto ? 'active' : ''}`}>{sn}</NavLink>)}
          </div>
        ))}
      </aside>
      <div className={`overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button className="btn menu-btn" onClick={() => setOpen(true)}>☰</button>
          <div className="spacer" />
          <Link to="/notifications" className="bell" title="Notifications">🔔{unread > 0 && <span className="n">{unread > 99 ? '99+' : unread}</span>}</Link>
          <span className="muted">{user?.name}</span>
          <Link to="/account" className="btn sm">Account</Link>
          <button className="btn sm" onClick={logout}>Sign out</button>
        </div>
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
