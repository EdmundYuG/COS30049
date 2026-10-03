import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Avatar, Empty, LoadingBlock, PageHead, SearchInput, Stat } from '../../components/ui.jsx';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const ACTIONS = {
  login: { label: 'Signed in', cls: 'badge-ok' },
  logout: { label: 'Signed out', cls: 'badge-neutral' },
  login_failed: { label: 'Failed sign in', cls: 'badge-danger' },
  password_changed: { label: 'Password changed', cls: 'badge-warn' },
};

export default function ActivityLog() {
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    api.activity().then((r) => setRows(r.results)).catch(() => setRows([]));
    api.adminStats().then(setStats).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    let out = rows;
    if (action) out = out.filter((r) => r.action === action);
    const n = q.trim().toLowerCase();
    if (n) out = out.filter((r) => [r.user_name, r.user_email, r.detail, r.action].filter(Boolean).join(' ').toLowerCase().includes(n));
    return out;
  }, [rows, q, action]);

  if (!rows) return <LoadingBlock label="Loading the activity log" />;

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1060 }}>
        <PageHead
          title="Activity log"
          sub="Sign ins, sign outs and failed attempts. Changes to records are in the audit trail."
        />

        {stats && (
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <Stat label="Sign ins (7 days)" value={stats.logins_7d} />
            <Stat label="Failed attempts" value={stats.failed_logins} detail={stats.failed_logins ? 'Worth a look' : 'None recorded'} />
            <Stat label="Active accounts" value={stats.active_users} detail={`of ${stats.users}`} />
            <Stat label="Audit entries" value={stats.audit_entries} />
          </div>
        )}

        <div className="row row-wrap" style={{ gap: 10, marginBottom: 16 }}>
          <div className="grow" style={{ maxWidth: 380, minWidth: 200 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search by person or detail" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All activity</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <Empty icon={I.Activity} title="Nothing matches those filters" />
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr><th></th><th>Person</th><th>Action</th><th>Detail</th><th>IP</th><th>When</th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const a = ACTIONS[r.action] || { label: r.action, cls: 'badge-neutral' };
                  return (
                    <tr key={r.id}>
                      <td style={{ width: 40 }}><Avatar name={r.user_name} size="sm" /></td>
                      <td>
                        <div className="small strong">{r.user_name}</div>
                        <div className="tiny mute">{r.user_email || '--'}</div>
                      </td>
                      <td><span className={'badge ' + a.cls}><span className="dot" />{a.label}</span></td>
                      <td className="small mute">{r.detail || '--'}</td>
                      <td className="mono tiny faint">{r.ip_address}</td>
                      <td className="small nowrap">
                        {relativeTime(r.created_at)}
                        <div className="tiny faint">{formatDateTime(r.created_at)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
