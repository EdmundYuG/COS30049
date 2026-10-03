import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { PlantCard, SearchInput, Empty, LoadingBlock, ChipRow } from '../components/ui.jsx';
import { Reveal } from '../components/motion.jsx';
import { CONSERVATION, GROWTH_FORM, num, titleCase } from '../lib/format.js';
import * as I from '../lib/icons.jsx';

const SORTS = [
  { value: 'recent', label: 'Newest' },
  { value: 'name', label: 'Scientific name' },
  { value: 'code', label: 'Plant ID' },
  { value: 'popular', label: 'Most viewed' },
];

export default function Browse() {
  const { boot, mobile } = useApp();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get('q') || '';
  const family = params.get('family') || '';
  const genus = params.get('genus') || '';
  const conservation = params.get('conservation') || '';
  const site = params.get('site') || '';
  const growth_form = params.get('growth_form') || '';
  const sort = params.get('sort') || 'recent';

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const PAGE = 24;

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.publicPlants({ q, family, genus, conservation, site, growth_form, sort, limit: PAGE, offset: 0 })
        .then((r) => { if (live) { setData(r); setLoading(false); } })
        .catch(() => { if (live) setLoading(false); });
    }, q ? 180 : 0); // debounce typing, but filters apply at once
    return () => { live = false; clearTimeout(t); };
  }, [q, family, genus, conservation, site, growth_form, sort]);

  /** Appends the next page rather than replacing, so scroll position holds. */
  const loadMore = async () => {
    if (!data?.has_more || more) return;
    setMore(true);
    try {
      const next = await api.publicPlants({
        q, family, genus, conservation, site, growth_form, sort,
        limit: PAGE, offset: data.results.length,
      });
      setData((d) => ({ ...next, results: [...d.results, ...next.results] }));
    } catch {
      /* the button stays, so the visitor can try again */
    } finally { setMore(false); }
  };

  const active = useMemo(
    () => [
      family && { key: 'family', label: family },
      genus && { key: 'genus', label: genus },
      conservation && { key: 'conservation', label: CONSERVATION[conservation]?.label || conservation },
      growth_form && { key: 'growth_form', label: GROWTH_FORM[growth_form] || titleCase(growth_form) },
      site && { key: 'site', label: site },
    ].filter(Boolean),
    [family, genus, conservation, growth_form, site],
  );

  const Filters = (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className="field">
        <label>Conservation status</label>
        <ChipRow
          options={['LC', 'NT', 'VU', 'EN', 'CR'].map((c) => ({ value: c, label: c }))}
          value={conservation}
          onChange={(v) => set('conservation', v)}
          allLabel="Any"
        />
      </div>
      <div className="field">
        <label htmlFor="f-family">Family</label>
        <select id="f-family" className="select" value={family} onChange={(e) => set('family', e.target.value)}>
          <option value="">All families</option>
          {(boot?.families || []).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-genus">Genus</label>
        <select id="f-genus" className="select" value={genus} onChange={(e) => set('genus', e.target.value)}>
          <option value="">All genera</option>
          {(boot?.genera || []).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-gf">Growth form</label>
        <select id="f-gf" className="select" value={growth_form} onChange={(e) => set('growth_form', e.target.value)}>
          <option value="">Any growth form</option>
          {(boot?.growth_forms || []).map((f) => <option key={f} value={f}>{GROWTH_FORM[f] || titleCase(f)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-site">Location</label>
        <select id="f-site" className="select" value={site} onChange={(e) => set('site', e.target.value)}>
          <option value="">Anywhere in the park</option>
          {(boot?.sites || []).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      {active.length > 0 && (
        <button className="btn btn-sm btn-block" onClick={() => setParams(q ? { q } : {}, { replace: true })}>
          <I.X /> Clear {active.length} filter{active.length > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );

  return (
    <div className="page">
      <div className="wrap">
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ marginBottom: 10 }}>Browse the plant register</h1>
          <SearchInput
            value={q}
            onChange={(v) => set('q', v)}
            placeholder="Common name, scientific name, Plant ID, family, genus or location"
          />
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {!mobile && (
            <aside style={{ width: 236, flex: 'none', position: 'sticky', top: 'calc(var(--header-h) + 18px)' }}>
              <div className="card card-pad">
                <div className="row row-between" style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: '0.9rem' }}>Filters</strong>
                  <I.Filter style={{ width: 15, height: 15, color: 'var(--text-faint)' }} />
                </div>
                {Filters}
              </div>
            </aside>
          )}

          <div className="grow">
            <div className="row row-between row-wrap" style={{ marginBottom: 14, gap: 10 }}>
              <div className="small mute">
                {loading ? 'Searching...' : (
                  <>
                    <strong style={{ color: 'var(--text)' }}>{num(data?.total || 0)}</strong>
                    {' '}published record{data?.total === 1 ? '' : 's'}
                    {q && <> matching &ldquo;{q}&rdquo;</>}
                  </>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                {mobile && (
                  <button className="btn btn-sm" onClick={() => setFiltersOpen((o) => !o)}>
                    <I.Filter /> Filters{active.length ? ` (${active.length})` : ''}
                  </button>
                )}
                <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort by">
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {mobile && filtersOpen && <div className="card card-pad" style={{ marginBottom: 16 }}>{Filters}</div>}

            {active.length > 0 && (
              <div className="row row-wrap" style={{ gap: 7, marginBottom: 16 }}>
                {active.map((a) => (
                  <button key={a.key} className="chip active" onClick={() => set(a.key, '')}>
                    {a.label} <span className="chip-x">&times;</span>
                  </button>
                ))}
              </div>
            )}

            {loading && !data && <LoadingBlock label="Searching the register" />}

            {data && data.results.length === 0 && (
              <Empty
                icon={I.Search}
                title="No records match"
                action={<button className="btn" onClick={() => setParams({}, { replace: true })}>Clear search and filters</button>}
              >
                Try a shorter search term, or a different family or conservation status.
                Only approved records appear on the public site.
              </Empty>
            )}

            {data && data.results.length > 0 && (
              <>
                <div className="plant-grid" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s' }}>
                  {data.results.map((p, i) => (
                    <Reveal key={p.id} index={i % 8}><PlantCard plant={p} eager={i < 6} /></Reveal>
                  ))}
                </div>

                <div className="row" style={{ justifyContent: 'center', marginTop: 26 }}>
                  {data.has_more ? (
                    <button className="btn btn-lg" onClick={loadMore} disabled={more}>
                      {more && <span className="spinner" />}
                      {more
                        ? 'Loading…'
                        : <>Load more <span className="mute">({num(data.total - data.results.length)} left)</span></>}
                    </button>
                  ) : (
                    data.total > PAGE && (
                      <span className="small faint">That is all {num(data.total)} records.</span>
                    )
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
