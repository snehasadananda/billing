import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { errMsg } from '../api.js';

export default function Login() {
  const { login } = useAuth(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(email, password); } catch (x) { setErr(errMsg(x)); } setBusy(false); };
  return (
    <div className="login"><div className="card">
      <h1>🧾 Billing &amp; Invoice</h1><p className="muted">Sign in to continue</p>
      {err && <div className="alert red">{err}</div>}
      <form onSubmit={submit} className="grid">
        <label className="field"><span>Email</span><input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div></div>
  );
}
