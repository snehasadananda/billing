import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
    localStorage.removeItem('token');
    if (!location.pathname.startsWith('/login')) location.href = '/login';
  }
  return Promise.reject(err);
});

export const errMsg = (e) => e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection.' : 'Something went wrong. Please try again.');

/** Fetch a PDF/CSV with the auth header and open it (preview/print) or download it. */
export async function openFile(path, { download = false, filename = 'file.pdf', print = false } = {}) {
  const res = await api.get(path, { responseType: 'blob', params: download ? { download: 1 } : undefined });
  const url = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  } else {
    const w = window.open(url, '_blank');
    if (print && w) w.addEventListener('load', () => w.print());
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
