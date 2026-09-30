import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!localStorage.getItem('token')) { setReady(true); return; }
    try { const { data } = await api.get('/auth/me'); setUser(data.data.user); setCompany(data.data.company); }
    catch { localStorage.removeItem('token'); setUser(null); }
    setReady(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.data.token);
    await load();
  };
  const logout = async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } localStorage.removeItem('token'); setUser(null); };

  return <Ctx.Provider value={{ user, company, ready, login, logout, reloadCompany: load, isAdmin: user?.role === 'ADMIN' }}>{children}</Ctx.Provider>;
}
