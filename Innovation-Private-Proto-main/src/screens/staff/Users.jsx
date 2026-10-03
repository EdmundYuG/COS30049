import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import {
  Avatar, ConfirmButton, Empty, LoadingBlock, Modal, Notice, PageHead, SearchInput, Stat,
} from '../../components/ui.jsx';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

function NewUserDialog({ roles, onClose, onDone }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ full_name: '', email: '', title: '', phone: '', role_id: 2 });
  const [busy, setBusy] = useState(false);
  const up = (p) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.createUser(form);
      toast(`${r.user.full_name} created. Temporary password: ${r.temporary_password}`);
      onDone(); onClose();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Create a staff account"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy && <span className="spinner" />}Create account</button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <Notice kind="plain">
          There is no public sign-up. Every account is created here, starts with a temporary password, and is
          forced to change it at first sign in.
        </Notice>
        <div className="field">
          <label htmlFor="u-name">Full name <span className="req">*</span></label>
          <input id="u-name" className="input" value={form.full_name} onChange={(e) => up({ full_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="u-email">Email address <span className="req">*</span></label>
          <input id="u-email" type="email" className="input" value={form.email} onChange={(e) => up({ email: e.target.value })} placeholder="name@niah.sarawak.gov.my" />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="u-role">Role <span className="req">*</span></label>
            <select id="u-role" className="select" value={form.role_id} onChange={(e) => up({ role_id: Number(e.target.value) })}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-title">Job title</label>
            <input id="u-title" className="input" value={form.title} onChange={(e) => up({ title: e.target.value })} placeholder="Park Ranger" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="u-phone">Phone</label>
          <input id="u-phone" className="input" value={form.phone} onChange={(e) => up({ phone: e.target.value })} />
        </div>
        {form.role_id && (
          <div className="inset">
            <div className="label" style={{ marginBottom: 5 }}>This role can</div>
            <div className="row row-wrap" style={{ gap: 5 }}>
              {(roles.find((r) => r.id === Number(form.role_id))?.permissions || []).map((p) => (
                <span key={p} className="tag mono">{p}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function UserDrawer({ user, roles, onClose, onDone }) {
  const { toast, user: me } = useApp();
  const [busy, setBusy] = useState(false);
  const isMe = me?.id === user.id;

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast(msg); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal title={user.full_name} onClose={onClose}>
      <div className="stack" style={{ '--gap': '16px' }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={user.full_name} role={user.role} size="lg" />
          <div>
            <div className="strong">{user.full_name}</div>
            <div className="small mute">{user.email}</div>
            <div className="row" style={{ gap: 6, marginTop: 5 }}>
              <span className="tag">{user.role_label}</span>
              {user.is_active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-danger">Deactivated</span>}
              {user.must_change_password ? <span className="badge badge-warn">Must change password</span> : null}
            </div>
          </div>
        </div>

        <dl className="dl small">
          <dt>Job title</dt><dd>{user.title || '--'}</dd>
          <dt>Phone</dt><dd>{user.phone || '--'}</dd>
          <dt>Created</dt><dd>{formatDateTime(user.created_at)}{user.created_by_name && <span className="mute"> by {user.created_by_name}</span>}</dd>
          <dt>Last sign in</dt><dd>{user.last_login_at ? relativeTime(user.last_login_at) : 'Never'}</dd>
          <dt>Plants registered</dt><dd>{user.plants_registered}</dd>
          <dt>Plants verified</dt><dd>{user.plants_verified}</dd>
        </dl>

        <div className="field">
          <label htmlFor="d-role">Role</label>
          <select
            id="d-role" className="select" value={user.role_id} disabled={busy || isMe}
            onChange={(e) => act(() => api.updateUser(user.id, { role_id: Number(e.target.value) }), 'Role updated.')}
          >
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          {isMe && <div className="hint">You cannot change your own role.</div>}
        </div>

        <div className="inset">
          <div className="label" style={{ marginBottom: 5 }}>Permissions held</div>
          <div className="row row-wrap" style={{ gap: 5 }}>
            {user.permissions.map((p) => <span key={p} className="tag mono">{p}</span>)}
          </div>
        </div>

        <div className="row row-wrap" style={{ gap: 9 }}>
          <ConfirmButton
            className="btn btn-sm"
            icon={I.Refresh}
            label="Reset password"
            title={'Reset the password for ' + user.full_name + '?'}
            confirmLabel="Reset password"
            body={
              <Notice kind="warn" title="This signs them out everywhere">
                A temporary password is issued and they must change it at the next sign in.
                Any active session is revoked immediately.
              </Notice>
            }
            onConfirm={() => act(() => api.resetPassword(user.id), 'Password reset. Temporary password: demo1234')}
          />
          {!isMe && (
            user.is_active ? (
              <ConfirmButton
                className="btn btn-sm btn-danger"
                icon={I.X}
                label="Deactivate"
                title={'Deactivate ' + user.full_name + '?'}
                confirmLabel="Deactivate account"
                body={
                  <Notice kind="warn" title="Access stops at once">
                    Their live sessions are revoked and sign in is refused. Their records and audit history stay
                    exactly as they are. You can reactivate the account at any time.
                  </Notice>
                }
                onConfirm={() => act(() => api.updateUser(user.id, { is_active: false }), user.full_name + ' deactivated.')}
              />
            ) : (
              <button
                className="btn btn-sm btn-primary" disabled={busy}
                onClick={() => act(() => api.updateUser(user.id, { is_active: true }), user.full_name + ' reactivated.')}
              >
                <I.Check /> Reactivate
              </button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { boot, can } = useApp();
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.users().then((r) => setRows(r.results)).catch(() => setRows([]));
    api.adminStats().then(setStats).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!rows) return <LoadingBlock label="Loading staff accounts" />;

  const roles = boot?.roles || [];
  const filtered = q.trim()
    ? rows.filter((u) => [u.full_name, u.email, u.title, u.role_label].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()))
    : rows;

  return (
    <div className="page">
      <div className="wrap wrap-wide">
        <PageHead
          title="Staff accounts"
          sub="Create accounts, set roles, reset passwords, and activate or deactivate staff. Visitors never have an account."
        >
          {can('user.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}><I.Plus /> New account</button>}
        </PageHead>

        {stats && (
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Accounts" value={stats.users} detail={`${stats.active_users} active`} />
            {stats.by_role.map((r) => <Stat key={r.role} label={r.label} value={r.count} />)}
          </div>
        )}

        <div style={{ maxWidth: 380, marginBottom: 16 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email or role" />
        </div>

        {filtered.length === 0 ? (
          <Empty icon={I.Users} title="No accounts match" />
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr><th></th><th>Name</th><th>Role</th><th>Last sign in</th><th className="num">Registered</th><th className="num">Verified</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} onClick={() => setOpen(u)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: 44 }}><Avatar name={u.full_name} role={u.role} size="sm" /></td>
                    <td>
                      <div className="strong">{u.full_name}</div>
                      <div className="tiny mute">{u.email}</div>
                    </td>
                    <td><span className="tag">{u.role_label}</span><div className="tiny mute" style={{ marginTop: 2 }}>{u.title}</div></td>
                    <td className="small mute">{u.last_login_at ? relativeTime(u.last_login_at) : 'Never'}</td>
                    <td className="num">{u.plants_registered}</td>
                    <td className="num">{u.plants_verified}</td>
                    <td>
                      {u.is_active ? <span className="badge badge-ok"><span className="dot" />Active</span> : <span className="badge badge-danger"><span className="dot" />Off</span>}
                    </td>
                    <td className="num"><I.ChevronRight style={{ width: 16, height: 16, color: 'var(--text-faint)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <Notice kind="plain" title="Roles are permission sets, not hard-coded names">
            The API checks permission codes such as <span className="mono">plant.approve</span>, never the role
            name. A superuser can be added later as one more role holding every permission, with no new tables
            and no fourth dashboard.
          </Notice>
        </div>
      </div>

      {creating && <NewUserDialog roles={roles} onClose={() => setCreating(false)} onDone={load} />}
      {open && <UserDrawer user={open} roles={roles} onClose={() => setOpen(null)} onDone={() => { load(); setOpen(null); }} />}
    </div>
  );
}
