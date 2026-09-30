import { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { inr, label, PERIODS } from './format';

/* ---------- toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((i) => <div key={i.id} className={`toast ${i.type}`}>{i.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- data hook ---------- */
export function useFetch(fn, deps = []) {
  const [state, set] = useState({ data: null, meta: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((r) => { if (live) set({ data: r.data?.data ?? null, meta: r.data, loading: false, error: null }); })
      .catch((e) => { if (live) set({ data: null, meta: null, loading: false, error: e?.response?.data?.message || 'Failed to load data' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/* ---------- small components ---------- */
const STATUS_COLOR = {
  PAID: 'green', ACTIVE: 'green', ACCEPTED: 'green', CONVERTED: 'blue', VALID: 'green', SUCCESS: 'green',
  ISSUED: 'blue', SENT: 'blue', VIEWED: 'blue', AUTO_GENERATED: 'purple', PARTIALLY_PAID: 'amber', PAYMENT_PENDING: 'amber', DRAFT: 'gray', PAUSED: 'amber',
  OVERDUE: 'red', REJECTED: 'red', EXPIRED: 'gray', CANCELLED: 'gray', VOID: 'gray', INACTIVE: 'gray', ENDED: 'gray', FAILED: 'red',
};
export const Badge = ({ status, children }) => <span className={`badge ${STATUS_COLOR[status] || 'gray'}`}>{children || label(status)}</span>;

export const PageHeader = ({ title, children, sub }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <div className="muted">{sub}</div>}</div><div className="row gap">{children}</div></div>
);
export const Card = ({ title, actions, children, className = '' }) => (
  <div className={`card ${className}`}>{(title || actions) && <div className="card-head"><h3>{title}</h3><div className="row gap">{actions}</div></div>}{children}</div>
);
export const Loading = () => <div className="loading">Loading…</div>;
export const ErrorBox = ({ msg, retry }) => <div className="alert red">{msg} {retry && <button className="btn sm" onClick={retry}>Retry</button>}</div>;
export const Empty = ({ children = 'No records found.' }) => <div className="empty">{children}</div>;

export function Field({ label: l, error, children, hint, wide }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{l}</span>{children}{hint && <small className="muted">{hint}</small>}{error && <small className="err">{error}</small>}</label>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><h3>{title}</h3><button className="btn ghost" onClick={onClose}>✕</button></div><div className="modal-body">{children}</div></div>
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  const p = meta?.pagination; if (!p || p.pages <= 1) return null;
  return (
    <div className="pager"><button className="btn sm" disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}>‹ Prev</button>
      <span>Page {p.page} of {p.pages} · {p.total} records</span>
      <button className="btn sm" disabled={p.page >= p.pages} onClick={() => onPage(p.page + 1)}>Next ›</button></div>
  );
}

/** Responsive table: turns into stacked cards on mobile via data-label. */
export function Table({ cols, rows, onRow, empty }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap"><table className="tbl">
      <thead><tr>{cols.map((c) => <th key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.id ?? i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
          {cols.map((c) => <td key={c.key} data-label={c.label} className={c.align === 'right' ? 'r' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
        </tr>))}</tbody>
    </table></div>
  );
}

export function PeriodPicker({ value, onChange }) {
  const { period, from, to } = value;
  return (
    <div className="row gap wrap">
      <select value={period} onChange={(e) => onChange({ ...value, period: e.target.value })}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {period === 'custom' && <><input type="date" value={from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} /><input type="date" value={to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} /></>}
    </div>
  );
}

export const KPI = ({ title, value, sub, tone = '' }) => <div className={`kpi ${tone}`}><div className="kpi-t">{title}</div><div className="kpi-v">{inr(value)}</div>{sub && <div className="kpi-s">{sub}</div>}</div>;

export function Confirm({ title, message, onYes, onNo, yes = 'Confirm', danger }) {
  return <Modal title={title} onClose={onNo}><p>{message}</p><div className="row gap end"><button className="btn" onClick={onNo}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onYes}>{yes}</button></div></Modal>;
}
