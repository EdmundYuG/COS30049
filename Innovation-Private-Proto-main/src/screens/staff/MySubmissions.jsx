import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty, LoadingBlock, Notice, PageHead, StatusBadge } from '../../components/ui.jsx';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'review', label: 'Botanist review' },
  { key: 'done', label: 'Published' },
];

function Track({ status }) {
  const at = status === 'pending' ? 1 : 2;
  return (
    <div className="row" style={{ gap: 0, marginTop: 10 }}>
      {STEPS.map((s, i) => {
        const done = i < at || (i === 2 && status === 'approved');
        const current = i === at && status === 'pending';
        const failed = i === 2 && status === 'rejected';
        return (
          <div key={s.key} className="row grow" style={{ gap: 7, minWidth: 0 }}>
            <span
              style={{
                width: 16, height: 16, borderRadius: 99, flex: 'none', display: 'grid', placeItems: 'center',
                background: failed ? 'var(--danger-fg)' : done ? 'var(--accent)' : 'var(--surface-3)',
                border: current ? '2px solid var(--accent)' : '1px solid var(--border)',
                color: '#fff',
              }}
            >
              {failed ? <I.X style={{ width: 9, height: 9 }} /> : done ? <I.Check style={{ width: 9, height: 9 }} /> : null}
            </span>
            <span className="tiny truncate" style={{ color: done || current ? 'var(--text)' : 'var(--text-faint)', fontWeight: current ? 640 : 500 }}>
              {failed && i === 2 ? 'Returned' : s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="grow" style={{ height: 1, background: i < at ? 'var(--accent)' : 'var(--border)', minWidth: 14 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MySubmissions() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.submissions({ status: 'all', mine: '1' }).then(setData).catch(() => setData({ results: [] }));
  }, []);

  if (!data) return <LoadingBlock label="Loading your submissions" />;

  const pending = data.results.filter((s) => s.status === 'pending');
  const done = data.results.filter((s) => s.status !== 'pending');

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 940 }}>
        <PageHead
          title="My submissions"
          sub="What happened to the records you sent for review."
        >
          <Link className="btn btn-primary" to="/staff/register"><I.Plus /> Register a plant</Link>
        </PageHead>

        {data.results.length === 0 && (
          <Empty
            icon={I.Clock}
            title="You have not submitted anything yet"
            action={<Link className="btn btn-primary" to="/staff/register"><I.Plus /> Register your first plant</Link>}
          >
            Records you register appear here so you can follow them through review.
          </Empty>
        )}

        {pending.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Waiting for a botanist ({pending.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, marginBottom: 26 }}>
              {pending.map((s) => <Card key={s.id} sub={s} />)}
            </div>
          </>
        )}

        {done.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Reviewed ({done.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
              {done.map((s) => <Card key={s.id} sub={s} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ sub }) {
  const p = sub.plant;
  return (
    <div className="card card-pad">
      <div className="row row-wrap" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 74, height: 58, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-3)', flex: 'none', border: '1px solid var(--border)' }}>
          {p.photo && <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div className="grow" style={{ minWidth: 150 }}>
          <div className="row row-wrap" style={{ gap: 8, marginBottom: 3 }}>
            <StatusBadge status={p.status} />
            {p.species_not_listed && <span className="badge badge-info">Species not listed</span>}
          </div>
          <div className={p.scientific_name ? 'sci strong' : 'strong'}>{p.scientific_name || p.proposed_species_name}</div>
          <div className="tiny mute">
            <span className="mono">{p.plant_code}</span> &middot; {p.site_name} &middot; submitted {relativeTime(sub.submitted_at)}
          </div>
          <Track status={sub.status} />
        </div>
        <Link className="btn btn-sm" to={'/staff/plants/' + p.id}><I.Eye /> Open</Link>
      </div>

      {sub.status === 'rejected' && sub.review_comment && (
        <div style={{ marginTop: 14 }}>
          <Notice kind="warn" title={`Returned by ${sub.reviewed_by_name} · ${formatDateTime(sub.reviewed_at)}`}>
            {sub.review_comment}
          </Notice>
        </div>
      )}
      {sub.status === 'approved' && (
        <div style={{ marginTop: 14 }}>
          <Notice kind="ok" title={`Published by ${sub.reviewed_by_name || 'a botanist'}`}>
            The record is live on the public site and its QR tag can be printed.
            {p.qr_token && <> <Link to={'/p/' + p.qr_token}>Open the public page</Link>.</>}
          </Notice>
        </div>
      )}
    </div>
  );
}
