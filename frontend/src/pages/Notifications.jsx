import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useFetch, PageHeader, Card, Loading, Pagination, Empty } from '../ui.jsx';
import { fdate } from '../format.js';

export default function Notifications() {
  const nav = useNavigate(); const [page, setPage] = useState(1); const [unread, setUnread] = useState(false);
  const { data, meta, loading, reload } = useFetch(() => api.get('/notifications', { params: { page, limit: 20, unread } }), [page, unread]);
  const go = async (n) => {
    await api.put(`/notifications/${n.id}/read`).catch(() => {}); reload();
    if (n.reference_type === 'INVOICE') nav(`/invoices/${n.reference_id}`); else if (n.reference_type === 'ESTIMATE') nav(`/estimates/${n.reference_id}`); else if (n.reference_type === 'BILLING_CYCLE') nav('/billing');
  };
  return (
    <>
      <PageHeader title="Notifications"><label className="chk"><input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1); }} />Unread only</label><button className="btn" onClick={async () => { await api.put('/notifications/read-all'); reload(); }}>Mark all read</button></PageHeader>
      <Card>{loading && !data ? <Loading /> : !data?.length ? <Empty>No notifications.</Empty> : data.map((n) => (
        <div key={n.id} onClick={() => go(n)} style={{ padding: '10px 4px', borderBottom: '1px solid #eef1f6', cursor: 'pointer', background: n.is_read ? '' : '#f1f6ff' }}>
          <b>{n.title}</b> <span className="muted">· {fdate(n.created_at)}</span><div>{n.message}</div></div>))}
        <Pagination meta={meta} onPage={setPage} /></Card>
    </>
  );
}
