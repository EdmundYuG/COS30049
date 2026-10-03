import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Avatar, Notice } from '../components/ui.jsx';
import { homeFor } from '../lib/format.js';
import * as I from '../lib/icons.jsx';

export default function Login() {
  const { boot, signIn, switchRole, toast, user } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const land = (u) => navigate(loc.state?.from || homeFor(u), { replace: true });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = await signIn(email, password);
      toast('Signed in as ' + u.full_name);
      land(u);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const quick = async (account) => {
    setBusy(true); setError(null);
    try {
      const u = await switchRole(account.id);
      toast('Signed in as ' + u.full_name);
      land(u);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const accounts = boot?.demo_accounts || [];
  const byRole = ['admin', 'botanist', 'ranger'];

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 940 }}>
        {user && (
          <div style={{ marginBottom: 18 }}>
            <Notice kind="ok" title={'Already signed in as ' + user.full_name}>
              <Link to={homeFor(user)}>Go to your dashboard</Link>, or sign in as somebody else below.
            </Notice>
          </div>
        )}

        <div style={{ display: 'grid', gap: 26, gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', alignItems: 'start' }}>
          {/* Real login form */}
          <div className="card card-pad">
            <h1 style={{ fontSize: '1.45rem', marginBottom: 4 }}>Staff sign in</h1>
            <div className="small mute" style={{ marginBottom: 18 }}>
              Accounts are created by an administrator. Visitors do not need one.
            </div>

            <form onSubmit={submit} className="stack" style={{ '--gap': '14px' }}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email" type="email" className={'input' + (error ? ' input-invalid' : '')}
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username" placeholder="name@niah.sarawak.gov.my" required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password" type="password" className={'input' + (error ? ' input-invalid' : '')}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder="demo1234" required
                />
                <div className="hint">Demo password for every account: <span className="mono">demo1234</span></div>
              </div>

              {error && <div className="err" role="alert">{error}</div>}

              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy && <span className="spinner" />} Sign in
              </button>
            </form>

            <div className="tiny faint" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              Passwords are stored as bcrypt hashes in the real system. This prototype keeps sessions in memory only,
              so everything resets when the server restarts.
            </div>
          </div>

          {/* Demo roster */}
          <div className="card">
            <div className="card-head">
              <h3 className="grow">Sign in as a demo account</h3>
              <span className="badge badge-warn">Prototype</span>
            </div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              <div className="small mute" style={{ marginBottom: 14 }}>
                One click, no password. The same list is in the floating switcher (Ctrl+K), so you can
                change role from any screen.
              </div>

              {byRole.map((role) => {
                const list = accounts.filter((a) => a.role === role);
                if (!list.length) return null;
                return (
                  <div key={role} style={{ marginBottom: 14 }}>
                    <div className="side-title" style={{ paddingLeft: 0 }}>{list[0].role_label}</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {list.map((a) => (
                        <button
                          key={a.id}
                          className="rs-item"
                          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
                          onClick={() => quick(a)}
                          disabled={busy || !a.is_active}
                          title={a.is_active ? a.email : 'Deactivated account'}
                        >
                          <Avatar name={a.full_name} role={a.role} />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="nm truncate">{a.full_name}</span>
                            <span className="rl truncate">{a.title}{!a.is_active && ' · deactivated'}</span>
                          </span>
                          {a.is_active ? <I.ChevronRight style={{ width: 15, height: 15, color: 'var(--text-faint)' }} /> : <span className="tag tiny">Off</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="inset small">
                <strong>Try the deactivated account.</strong> It is refused at sign in, which is the same check
                the API applies on every request after login.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
