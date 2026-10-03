import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import { Empty, LoadingBlock, PageHead } from '../../components/ui.jsx';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const TYPES = {
  'submission.new': { icon: I.Clock, cls: 'badge-warn', label: 'New submission' },
  'submission.approved': { icon: I.CheckCircle, cls: 'badge-ok', label: 'Approved' },
  'submission.rejected': { icon: I.XCircle, cls: 'badge-danger', label: 'Returned' },
  'report.new': { icon: I.Flag, cls: 'badge-info', label: 'Visitor report' },
  'sensor.alert': { icon: I.Alert, cls: 'badge-danger', label: 'Sensor alert' },
};

export default function Notifications() {
  const { refreshCounts, toast } = useApp();
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  const load = () => api.notifications().then(setData).catch(() => setData({ results: [], unread: 0 }));
  useEffect(() => { load(); }, []);

  const open = async (n) => {
    if (!n.is_read) {
      try { await api.readNotification(n.id); await refreshCounts(); } catch { /* non-fatal */ }
    }
    if (n.related_type === 'plant' && n.related_id) navigate('/staff/plants/' + n.related_id);
    else if (n.related_type === 'submission') navigate('/staff/review');
    else load();
  };

  const readAll = async () => {
    await api.readAllNotifications();
    await refreshCounts();
    load();
    toast('All notifications marked as read.');
  };

  if (!data) return <LoadingBlock label="Loading notifications" />;

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <PageHead
          title="Notifications"
          sub="New submissions, approvals, returns and visitor reports."
        >
          {data.unread > 0 && <button className="btn btn-sm" onClick={readAll}><I.Check /> Mark all read</button>}
        </PageHead>

        {data.results.length === 0 ? (
          <Empty icon={I.Bell} title="Nothing to catch up on">
            You will be notified here when a submission needs your attention, or when one of yours is reviewed.
          </Empty>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {data.results.map((n) => {
              const t = TYPES[n.type] || { icon: I.Bell, cls: 'badge-neutral', label: n.type };
              return (
                <button
                  key={n.id}
                  className="card card-pad row"
                  style={{
                    gap: 13, textAlign: 'left', alignItems: 'flex-start', width: '100%',
                    borderLeft: n.is_read ? undefined : '3px solid var(--accent)',
                    background: n.is_read ? 'var(--surface)' : 'var(--accent-soft)',
                  }}
                  onClick={() => open(n)}
                >
                  <span className="avatar" style={{ flex: 'none' }}><t.icon style={{ width: 15, height: 15 }} /></span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row row-wrap" style={{ gap: 8, marginBottom: 2 }}>
                      <span className="strong small">{n.title}</span>
                      {!n.is_read && <span className="badge badge-ok" style={{ fontSize: '0.62rem' }}>New</span>}
                    </span>
                    {n.body && <span className="small mute" style={{ display: 'block' }}>{n.body}</span>}
                    <span className="tiny faint" style={{ display: 'block', marginTop: 4 }}>
                      {relativeTime(n.created_at)} &middot; {formatDateTime(n.created_at)}
                    </span>
                  </span>
                  <I.ChevronRight style={{ width: 16, height: 16, color: 'var(--text-faint)', flex: 'none', marginTop: 4 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
