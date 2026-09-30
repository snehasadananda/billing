import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { STATUS_COLOR, label, PERIODS } from '../utils';

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random();
    setItems((s) => [...s, { id, msg, type }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */
export const Badge = ({ status }) => <span className={`badge ${STATUS_COLOR[status] || ''}`}>{label(status)}</span>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head"><h2>{title}</h2><button className="btn sm" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label: l, error, children, hint }) => (
  <div className="field"><label className="f">{l}</label>{children}{hint && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{hint}</div>}{error && <div className="err">{error}</div>}</div>
);

export function Pager({ p, onPage }) {
  if (!p || p.pages <= 1) return p ? <div className="pager">{p.total} record(s)</div> : null;
  return (
    <div className="pager">
      <span>{p.total} record(s) · Page {p.page} of {p.pages}</span>
      <button className="btn sm" disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}>‹ Prev</button>
      <button className="btn sm" disabled={p.page >= p.pages} onClick={() => onPage(p.page + 1)}>Next ›</button>
    </div>
  );
}

export function PeriodPicker({ value, onChange }) {
  // value: { period, from, to }
  return (
    <div className="row">
      <select style={{ width: 200 }} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}>
        {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {value.period === 'custom' && (<>
        <input type="date" style={{ width: 150 }} value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <span className="muted">to</span>
        <input type="date" style={{ width: 150 }} value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </>)}
    </div>
  );
}

export function ErrorBox({ error }) { return error ? <div className="err-box">{error}</div> : null; }

/* ---------- data hook: server-side paging / filtering ---------- */
export function useList(path, filters, deps = []) {
  const [state, setState] = useState({ rows: [], pagination: null, loading: true, error: '' });
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setPage(1); }, [key]); // reset page when filters change
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, page, limit: 25 }).filter(([, v]) => v !== '' && v != null));
      const { data } = await api.get(path, { params });
      setState({ rows: data.data, pagination: data.pagination, loading: false, error: '', extra: data });
    } catch (e) { setState((s) => ({ ...s, loading: false, error: errMsg(e) })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, page, ...deps]);
  useEffect(() => { const t = setTimeout(reload, 200); return () => clearTimeout(t); }, [reload]);
  return { ...state, page, setPage, reload };
}

export function useFetch(path, params, deps = []) {
  const [s, setS] = useState({ data: null, loading: true, error: '' });
  const key = JSON.stringify(params || {});
  const reload = useCallback(async () => {
    setS((x) => ({ ...x, loading: true }));
    try { const { data } = await api.get(path, { params }); setS({ data: data.data, loading: false, error: '', raw: data }); }
    catch (e) { setS({ data: null, loading: false, error: errMsg(e) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { ...s, reload };
}

/** Wrap an async action with error toast + busy flag */
export function useAction() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg, 'success'); return r; }
    catch (e) { toast(errMsg(e), 'error'); return undefined; }
    finally { setBusy(false); }
  };
  return { run, busy };
}
