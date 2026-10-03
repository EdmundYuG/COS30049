import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/store.jsx';
import { Avatar, Notice } from '../../components/ui.jsx';
import { staffNav } from '../../components/Shell.jsx';
import { relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

/**
 * Phone "Account" tab. On a narrow screen there is no sidebar, so this is
 * where the rest of the staff navigation lives.
 */
export default function Me() {
  const { user, can, counts, signOut, theme, setTheme, viewPref, setView } = useApp();
  const navigate = useNavigate();
  const groups = staffNav(can, counts);

  return (
    <div className="page" style={{ paddingTop: 18 }}>
      <div className="wrap wrap-narrow">
        <div className="card card-pad row" style={{ gap: 14, marginBottom: 18 }}>
          <Avatar name={user.full_name} role={user.role} size="lg" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong truncate">{user.full_name}</div>
            <div className="small mute truncate">{user.email}</div>
            <div className="row" style={{ gap: 6, marginTop: 5 }}>
              <span className="tag">{user.role_label}</span>
              {user.title && <span className="tiny mute">{user.title}</span>}
            </div>
          </div>
        </div>

        <Link className="card card-pad row" to="/staff/notifications" style={{ gap: 12, marginBottom: 18, color: 'inherit', textDecoration: 'none' }}>
          <span className="avatar"><I.Bell style={{ width: 15, height: 15 }} /></span>
          <span className="grow">
            <span className="strong small" style={{ display: 'block' }}>Notifications</span>
            <span className="tiny mute">
              {counts?.unread_notifications ? `${counts.unread_notifications} unread` : 'Nothing new'}
            </span>
          </span>
          {!!counts?.unread_notifications && <span className="badge badge-danger">{counts.unread_notifications}</span>}
          <I.ChevronRight style={{ width: 16, height: 16, color: 'var(--text-faint)' }} />
        </Link>

        {groups.map((g) => (
          <div className="card" key={g.title} style={{ marginBottom: 14 }}>
            <div className="card-head"><h3>{g.title}</h3></div>
            <div style={{ padding: 6 }}>
              {g.items.map((it) => (
                <Link key={it.to} className="side-link" to={it.to}>
                  <it.icon />
                  <span className="grow">{it.label}</span>
                  {it.soon && <span className="tag tiny">Soon</span>}
                  {it.count > 0 && <span className={'count' + (it.alert ? ' alert' : '')}>{it.count}</span>}
                  <I.ChevronRight style={{ width: 15, height: 15, color: 'var(--text-faint)' }} />
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="card card-pad stack" style={{ '--gap': '14px', marginBottom: 18 }}>
          <div className="row row-between">
            <span className="small">Theme</span>
            <div className="segmented">
              {[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => (
                <button key={v} className={theme === v ? 'active' : ''} onClick={() => setTheme(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="row row-between">
            <span className="small">Layout</span>
            <div className="segmented">
              {[['auto', 'Auto'], ['web', 'Web'], ['mobile', 'App']].map(([v, l]) => (
                <button key={v} className={viewPref === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="small mute" style={{ marginBottom: 14 }}>
          Last signed in {user.last_login_at ? relativeTime(user.last_login_at) : 'just now'}.
        </div>

        {user.must_change_password && (
          <div style={{ marginBottom: 14 }}>
            <Notice kind="warn" title="Password change required">
              An administrator reset your password. In the finished system you would be asked to choose a new
              one before going any further.
            </Notice>
          </div>
        )}

        <button className="btn btn-danger btn-block" onClick={async () => { await signOut(); navigate('/'); }}>
          <I.Logout /> Sign out
        </button>
      </div>
    </div>
  );
}
