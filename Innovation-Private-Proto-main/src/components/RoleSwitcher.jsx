import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Avatar } from './ui.jsx';
import { homeFor } from '../lib/format.js';
import { resetIntro } from '../lib/intro.js';
import * as I from '../lib/icons.jsx';

/**
 * Prototype-only demo control.
 *
 * Jumps between the public visitor and each staff account without going
 * through the login form, so the team and the client can compare what every
 * role sees. It also carries the theme and web/phone layout toggles, which
 * keeps all the demo controls in one place instead of cluttering the real UI.
 *
 * Shortcuts: Ctrl/Cmd+K opens it, 0 = visitor, 1-9 = the listed accounts.
 * This whole component comes out before anything ships.
 */
export default function RoleSwitcher() {
  const { boot, user, switchRole, signOut, toast, theme, setTheme, viewPref, setView } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const accounts = boot?.demo_accounts || [];

  const go = async (account) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!account) {
        await signOut();
        toast('Viewing as a public visitor');
        navigate('/');
      } else {
        const u = await switchRole(account.id);
        toast(`Signed in as ${u.full_name} (${u.role_label})`);
        navigate(homeFor(u));
      }
      setOpen(false);
    } catch (e) {
      toast(e.message || 'Could not switch role', 'err');
    } finally {
      setBusy(false);
    }
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open || typing) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        if (n === 0) go(null);
        else if (accounts[n - 1]) go(accounts[n - 1]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /* Click outside to close */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && !e.target.closest('.rs-fab')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <>
      <button
        className="rs-fab no-print"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Prototype role switcher"
        title="Switch role (Ctrl+K)"
      >
        {user
          ? <Avatar name={user.full_name} role={user.role} />
          : <span className="avatar" style={{ background: 'rgba(255,255,255,0.14)', color: '#dfeadf', borderColor: 'transparent' }}><I.Eye style={{ width: 15, height: 15 }} /></span>}
        <span>{user ? user.role_label : 'Visitor'}</span>
        <span className="kbd">^K</span>
      </button>

      {open && (
        <div className="rs-panel no-print" ref={panelRef}>
          <div className="rs-head">
            <div className="row row-between">
              <strong style={{ fontSize: '0.88rem' }}>Demo role switcher</strong>
              <span className="badge badge-warn" title="Not part of the real system">Prototype</span>
            </div>
            <div className="tiny mute" style={{ marginTop: 3 }}>
              Jump straight into any account. Number keys work while this is open.
            </div>
          </div>

          <div className="rs-list">
            <button className={'rs-item' + (!user ? ' active' : '')} onClick={() => go(null)} disabled={busy}>
              <span className="avatar" style={{ background: 'var(--surface-3)', color: 'var(--text-mute)', borderColor: 'var(--border)' }}>
                <I.Eye style={{ width: 15, height: 15 }} />
              </span>
              <span className="grow">
                <span className="nm">Public visitor</span>
                <span className="rl">Not signed in &middot; sees published records only</span>
              </span>
              <span className="key">0</span>
            </button>

            <div className="side-title" style={{ marginTop: 8 }}>Staff accounts</div>

            {accounts.map((a, i) => (
              <button
                key={a.id}
                className={'rs-item' + (user?.id === a.id ? ' active' : '')}
                onClick={() => go(a)}
                disabled={busy || !a.is_active}
                title={a.is_active ? a.email : 'Deactivated - reactivate from the Admin dashboard'}
              >
                <Avatar name={a.full_name} role={a.role} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="nm truncate">{a.full_name}</span>
                  <span className="rl truncate">
                    {a.role_label}{a.title ? ' · ' + a.title : ''}
                    {!a.is_active && ' · deactivated'}
                  </span>
                </span>
                {i < 9 && <span className="key">{i + 1}</span>}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'grid', gap: 10 }}>
            <div className="row row-between">
              <span className="tiny mute">Layout</span>
              <div className="segmented">
                {[['auto', 'Auto'], ['web', 'Website'], ['mobile', 'Phone app']].map(([v, l]) => (
                  <button key={v} className={viewPref === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="row row-between">
              <span className="tiny mute">Theme</span>
              <div className="segmented">
                {[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => (
                  <button key={v} className={theme === v ? 'active' : ''} onClick={() => setTheme(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 7 }}>
              <button className="btn btn-sm grow" onClick={() => { setOpen(false); navigate('/connect'); }}>
                <I.Phone /> Open on my phone
              </button>
              {/* Replaying the welcome screen matters during a walkthrough:
                  it only ever appears once per browser otherwise. */}
              <button
                className="btn btn-sm"
                title="Show the welcome screen again"
                onClick={() => { resetIntro(); setOpen(false); navigate('/'); }}
              >
                <I.Refresh /> Intro
              </button>
            </div>
            <div className="tiny faint">Demo password for every account: <span className="mono">demo1234</span></div>
          </div>
        </div>
      )}
    </>
  );
}
