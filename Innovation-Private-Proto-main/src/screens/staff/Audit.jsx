import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Avatar, Empty, LoadingBlock, Notice, PageHead } from '../../components/ui.jsx';
import { formatDateTime, relativeTime, titleCase } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const ACTION_STYLE = {
  create: 'badge-ok', approve: 'badge-ok', update: 'badge-info',
  reject: 'badge-danger', archive: 'badge-neutral',
  role_change: 'badge-warn', password_reset: 'badge-warn',
};

/** Renders the old -> new value pairs the API stores as JSON. */
function Diff({ oldValues, newValues }) {
  const keys = [...new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})])]
    .filter((k) => String(oldValues?.[k] ?? '') !== String(newValues?.[k] ?? ''));
  if (!keys.length) return <span className="tiny faint">No field-level detail recorded</span>;

  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {keys.slice(0, 5).map((k) => (
        <div key={k} className="tl-diff" style={{ marginTop: 0 }}>
          <span className="mono tiny faint" style={{ minWidth: 92 }}>{k}</span>
          <span className="tl-old tiny">{String(oldValues?.[k] ?? 'empty').slice(0, 40)}</span>
          <I.ChevronRight style={{ width: 11, height: 11, color: 'var(--text-faint)' }} />
          <span className="tl-new tiny">{String(newValues?.[k] ?? 'empty').slice(0, 40)}</span>
        </div>
      ))}
      {keys.length > 5 && <span className="tiny faint">+{keys.length - 5} more fields</span>}
    </div>
  );
}

export default function Audit() {
  const [data, setData] = useState(null);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    api.audit({ entity_type: entity, action }).then(setData).catch(() => setData({ results: [] }));
  }, [entity, action]);

  if (!data) return <LoadingBlock label="Loading the audit trail" />;

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1060 }}>
        <PageHead
          title="Audit trail"
          sub="Who changed what, with the old and new values. Written by the API on every significant change."
        />

        <div style={{ marginBottom: 18 }}>
          <Notice kind="plain">
            This is the evidence behind the audit-completeness quality target: every record change produces an
            entry with actor, field, old value, new value and timestamp. Deletion is soft, so nothing disappears
            from this trail.
          </Notice>
        </div>

        <div className="row row-wrap" style={{ gap: 10, marginBottom: 16 }}>
          <select className="select" style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by record type">
            <option value="">All record types</option>
            {(data.entity_types || []).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All actions</option>
            {(data.actions || []).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
          <span className="spacer" />
          <span className="small mute">{data.total} entries{data.results.length < data.total && ` (showing ${data.results.length})`}</span>
        </div>

        {data.results.length === 0 ? (
          <Empty icon={I.Shield} title="No audit entries match" />
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr><th></th><th>Person</th><th>Action</th><th>Record</th><th>Change</th><th>When</th></tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: 40 }}><Avatar name={r.user_name} size="sm" /></td>
                    <td className="small strong nowrap">{r.user_name}</td>
                    <td>
                      <span className={'badge ' + (ACTION_STYLE[r.action] || 'badge-neutral')}>
                        <span className="dot" />{titleCase(r.action)}
                      </span>
                    </td>
                    <td className="small">
                      {titleCase(r.entity_type)}
                      {r.entity_id && <span className="mono tiny faint"> #{r.entity_id}</span>}
                    </td>
                    <td style={{ maxWidth: 380 }}><Diff oldValues={r.old_values} newValues={r.new_values} /></td>
                    <td className="small nowrap">
                      {relativeTime(r.created_at)}
                      <div className="tiny faint">{formatDateTime(r.created_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
