import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import {
  Empty, LoadingBlock, PageHead, PlantCard, PlantRow, SearchInput,
} from '../../components/ui.jsx';
import { num } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const TABS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Published' },
  { key: 'rejected', label: 'Returned' },
  { key: 'archived', label: 'Archived' },
];

export default function PlantRegister() {
  const { boot, can, counts, mobile } = useApp();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState(() => localStorage.getItem('florascan.layout') || 'table');
  const navigate = useNavigate();

  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const family = params.get('family') || '';
  const conservation = params.get('conservation') || '';

  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.plants({ status, q, family, conservation })
        .then((r) => { if (live) { setData(r); setLoading(false); } })
        .catch(() => { if (live) setLoading(false); });
    }, q ? 180 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [status, q, family, conservation]);

  const chooseLayout = (l) => { setLayout(l); localStorage.setItem('florascan.layout', l); };

  const scopeNote = can('plant.view_all')
    ? 'Every record in the register, in any status.'
    : 'The records you registered. Botanists see the whole register.';

  return (
    <div className="page">
      <div className="wrap wrap-wide">
        <PageHead title="Plant register" sub={scopeNote}>
          {can('plant.create') && (
            <Link className="btn btn-primary" to="/staff/register"><I.Plus /> Register a plant</Link>
          )}
        </PageHead>

        <div className="tabs" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <button key={t.key} className={status === t.key ? 'active' : ''} onClick={() => set('status', t.key)}>
              {t.label}
              {counts && counts[t.key || 'all'] !== undefined && <span className="count">{counts[t.key || 'all']}</span>}
            </button>
          ))}
        </div>

        <div className="row row-wrap" style={{ gap: 10, marginBottom: 16 }}>
          <div className="grow" style={{ maxWidth: 420, minWidth: 220 }}>
            <SearchInput value={q} onChange={(v) => set('q', v)} placeholder="Name, Plant ID, family or location" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={family} onChange={(e) => set('family', e.target.value)} aria-label="Filter by family">
            <option value="">All families</option>
            {(boot?.families || []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={conservation} onChange={(e) => set('conservation', e.target.value)} aria-label="Filter by conservation status">
            <option value="">Any status</option>
            {(boot?.conservation_statuses || []).map((c) => <option key={c.code} value={c.code}>{c.code} &mdash; {c.label}</option>)}
          </select>
          <span className="spacer" />
          {!mobile && (
            <div className="segmented">
              <button className={layout === 'table' ? 'active' : ''} onClick={() => chooseLayout('table')} aria-label="Table view"><I.List style={{ width: 15, height: 15 }} /></button>
              <button className={layout === 'grid' ? 'active' : ''} onClick={() => chooseLayout('grid')} aria-label="Grid view"><I.Grid style={{ width: 15, height: 15 }} /></button>
            </div>
          )}
        </div>

        {loading && !data && <LoadingBlock label="Loading records" />}

        {data && data.results.length === 0 && (
          <Empty
            icon={I.Leaf}
            title="No records here"
            action={can('plant.create') && <Link className="btn btn-primary" to="/staff/register"><I.Plus /> Register a plant</Link>}
          >
            {status ? `Nothing in the register has the status "${status}".` : 'Nothing matches those filters yet.'}
          </Empty>
        )}

        {data && data.results.length > 0 && (
          <>
            <div className="small mute" style={{ marginBottom: 10 }}>
              {num(data.total)} record{data.total === 1 ? '' : 's'}
            </div>

            {mobile || layout === 'grid' ? (
              <div className="plant-grid">
                {data.results.map((p) => (
                  <PlantCard key={p.id} plant={p} showStatus to={'/staff/plants/' + p.id} />
                ))}
              </div>
            ) : (
              <div className="card table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th></th><th>Species</th><th>Plant ID</th><th>Location</th>
                      <th>Conservation</th><th>Status</th><th>Registered</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((p) => (
                      <PlantRow key={p.id} plant={p} onClick={() => navigate('/staff/plants/' + p.id)}>
                        <td className="num"><I.ChevronRight style={{ width: 16, height: 16, color: 'var(--text-faint)' }} /></td>
                      </PlantRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
