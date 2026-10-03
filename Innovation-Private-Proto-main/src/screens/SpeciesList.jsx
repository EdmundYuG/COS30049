import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ConservationBadge, Empty, LoadingBlock, PageHead, SearchInput } from '../components/ui.jsx';
import { GROWTH_FORM, num, titleCase } from '../lib/format.js';
import * as I from '../lib/icons.jsx';

export default function SpeciesList() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => { api.species().then((r) => setRows(r.results)).catch(() => setRows([])); }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((s) =>
      [s.scientific_name, s.common_name, s.local_name, s.family, s.genus]
        .filter(Boolean).join(' ').toLowerCase().includes(n));
  }, [rows, q]);

  const byFamily = useMemo(() => {
    if (!filtered) return [];
    const map = new Map();
    filtered.forEach((s) => {
      const f = s.family || 'Unplaced';
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(s);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (!rows) return <LoadingBlock label="Loading the species list" />;

  return (
    <div className="page">
      <div className="wrap">
        <PageHead
          title="Species"
          sub="The botanical reference behind the register. Taxonomy is held once per species, so a correction is made in one place rather than on every specimen."
        />

        <div style={{ maxWidth: 480, marginBottom: 22 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search species, family or local name" />
        </div>

        {filtered.length === 0 && <Empty icon={I.Book} title="No species match that search" />}

        {byFamily.map(([family, list]) => (
          <div key={family} style={{ marginBottom: 26 }}>
            <div className="row" style={{ gap: 10, marginBottom: 10 }}>
              <h2 style={{ fontSize: '1.05rem' }}>{family}</h2>
              <span className="tag">{list.length} species</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 12 }}>
              {list.map((s) => (
                <Link key={s.id} className="card card-pad" to={'/species/' + s.id} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="row row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="sci strong" style={{ fontSize: '0.98rem' }}>{s.scientific_name}</div>
                      {s.common_name && <div className="small mute truncate">{s.common_name}</div>}
                      {s.local_name && <div className="tiny faint truncate">{s.local_name}</div>}
                    </div>
                    <ConservationBadge code={s.conservation_code} showLabel={false} />
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    {s.growth_form && <span className="tag">{GROWTH_FORM[s.growth_form] || titleCase(s.growth_form)}</span>}
                    <span className="spacer" />
                    <span className="tiny faint">{num(s.plant_count)} specimen{s.plant_count === 1 ? '' : 's'}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
