import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import { Empty, LoadingBlock, Modal, Notice, PageHead } from '../../components/ui.jsx';
import { formatDateTime, relativeTime, titleCase } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const ISSUE = {
  wrong_name: 'Wrong species or name',
  wrong_location: 'Wrong location',
  bad_photo: 'Photograph problem',
  outdated: 'Out of date',
  other: 'Other',
};

const STATUS_CLS = { open: 'badge-warn', reviewing: 'badge-info', resolved: 'badge-ok', dismissed: 'badge-neutral' };

function ResolveDialog({ report, onClose, onDone }) {
  const { toast, refreshCounts } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (dismiss) => {
    setBusy(true);
    try {
      await api.resolveReport(report.id, { note: note.trim() || null, dismiss });
      await refreshCounts();
      toast(dismiss ? 'Report dismissed.' : 'Report marked resolved.');
      onDone(); onClose();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Handle this report"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => act(true)} disabled={busy}><I.X /> Dismiss</button>
          <button className="btn btn-primary" onClick={() => act(false)} disabled={busy}>
            {busy && <span className="spinner" />}<I.Check /> Mark resolved
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <div className="inset">
          <div className="label" style={{ marginBottom: 4 }}>{ISSUE[report.issue_type]}</div>
          <div className="small">{report.description}</div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            {report.reporter_name || 'Anonymous'}{report.reporter_email && ` · ${report.reporter_email}`} &middot; {relativeTime(report.created_at)}
          </div>
        </div>
        <div className="field">
          <label htmlFor="res-note">Resolution note <span className="hint">(optional)</span></label>
          <textarea
            id="res-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What you checked and what you changed."
          />
        </div>
        <Notice kind="plain">
          Dismiss if the record was already correct. Resolve after you have corrected it, so the visitor report
          and the record change line up in the audit trail.
        </Notice>
      </div>
    </Modal>
  );
}

export default function Reports() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('open');
  const [open, setOpen] = useState(null);

  const load = () => api.reports().then(setData).catch(() => setData({ results: [], open: 0 }));
  useEffect(() => { load(); }, []);

  if (!data) return <LoadingBlock label="Loading visitor reports" />;

  const rows = tab === 'all' ? data.results : data.results.filter((r) => r.status === tab);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 940 }}>
        <PageHead
          title="Visitor reports"
          sub="Anyone can flag information that looks wrong from a plant page, without an account. A botanist decides what to do about it."
        />

        <div className="tabs" style={{ marginBottom: 18 }}>
          {[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {l}{k === 'open' && data.open > 0 && <span className="count">{data.open}</span>}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <Empty icon={I.Flag} title={tab === 'open' ? 'No open reports' : 'Nothing here'}>
            {tab === 'open' ? 'Every visitor report has been handled.' : 'No reports with that status.'}
          </Empty>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map((r) => (
              <div className="card card-pad" key={r.id}>
                <div className="row row-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
                  {r.plant && (
                    <div style={{ width: 66, height: 52, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-3)', flex: 'none', border: '1px solid var(--border)' }}>
                      {r.plant.photo && <img src={r.plant.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                  )}
                  <div className="grow" style={{ minWidth: 220 }}>
                    <div className="row row-wrap" style={{ gap: 8, marginBottom: 4 }}>
                      <span className={'badge ' + (STATUS_CLS[r.status] || 'badge-neutral')}><span className="dot" />{titleCase(r.status)}</span>
                      <span className="tag">{ISSUE[r.issue_type] || r.issue_type}</span>
                    </div>
                    {r.plant && (
                      <div className="small">
                        <Link className="sci strong" to={'/staff/plants/' + r.plant.id}>{r.plant.scientific_name}</Link>
                        <span className="mono tiny faint"> {r.plant.plant_code}</span>
                      </div>
                    )}
                    <div className="small" style={{ marginTop: 6 }}>{r.description}</div>
                    <div className="tiny faint" style={{ marginTop: 6 }}>
                      {r.reporter_name || 'Anonymous'}{r.reporter_email && ` · ${r.reporter_email}`} &middot; {relativeTime(r.created_at)}
                    </div>
                    {r.resolution_note && (
                      <div className="inset small" style={{ marginTop: 10 }}>
                        <div className="label" style={{ marginBottom: 3 }}>
                          Handled by {r.handled_by_name} &middot; {formatDateTime(r.handled_at)}
                        </div>
                        {r.resolution_note}
                      </div>
                    )}
                  </div>
                  <div className="col" style={{ gap: 7 }}>
                    {r.plant && <Link className="btn btn-sm" to={'/staff/plants/' + r.plant.id}><I.Eye /> Open record</Link>}
                    {r.status === 'open' && (
                      <button className="btn btn-sm btn-primary" onClick={() => setOpen(r)}><I.Check /> Handle</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && <ResolveDialog report={open} onClose={() => setOpen(null)} onDone={load} />}
    </div>
  );
}
