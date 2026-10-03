import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ConservationBadge, Empty, LoadingBlock, PageHead, PlantCard } from '../components/ui.jsx';
import { GROWTH_FORM, titleCase } from '../lib/format.js';
import * as I from '../lib/icons.jsx';

export default function SpeciesDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setData(null); setMissing(false);
    api.speciesById(id).then(setData).catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <div className="page"><div className="wrap wrap-narrow">
        <Empty icon={I.Book} title="Species not found" action={<Link className="btn" to="/species">Back to species list</Link>} />
      </div></div>
    );
  }
  if (!data) return <LoadingBlock label="Loading species" />;

  const s = data.species;
  const sections = [
    ['Description', s.description],
    ['Distinguishing characteristics', s.characteristics],
    ['Leaves', s.leaf_description],
    ['Flowers', s.flower_description],
    ['Fruit', s.fruit_description],
    ['Habitat', s.habitat],
    ['Distribution', s.distribution],
  ].filter(([, v]) => v);

  return (
    <div className="page">
      <div className="wrap">
        <PageHead
          back={{ to: '/species', label: 'All species' }}
          title={<span className="sci">{s.scientific_name}</span>}
          sub={[s.common_name, s.local_name].filter(Boolean).join(' · ')}
        >
          <ConservationBadge code={s.conservation_code} />
        </PageHead>

        <div style={{ display: 'grid', gap: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <div className="card">
            <div className="card-head"><h3>Classification</h3></div>
            <div className="card-body" style={{ paddingBlock: 6 }}>
              <dl className="dl">
                <dt>Family</dt><dd><Link to={'/browse?family=' + encodeURIComponent(s.family || '')}>{s.family || '--'}</Link></dd>
                <dt>Genus</dt><dd className="sci">{s.genus || '--'}</dd>
                <dt>Epithet</dt><dd className="sci">{s.species_epithet || '--'}</dd>
                <dt>Growth form</dt><dd>{s.growth_form ? (GROWTH_FORM[s.growth_form] || titleCase(s.growth_form)) : '--'}</dd>
                <dt>Conservation</dt><dd>{s.conservation_label}</dd>
                <dt>Specimens</dt><dd>{s.plant_count} in the register</dd>
              </dl>
            </div>
          </div>

          {sections.length > 0 && (
            <div className="card card-pad">
              <div className="prose">
                {sections.map(([title, text]) => (
                  <div key={title}><h3>{title}</h3><p>{text}</p></div>
                ))}
              </div>
            </div>
          )}
        </div>

        <h2 style={{ margin: '28px 0 14px' }}>
          Specimens in the park <span className="mute" style={{ fontWeight: 400 }}>({data.plants.length})</span>
        </h2>
        {data.plants.length === 0 ? (
          <Empty icon={I.Leaf} title="No specimens of this species are published yet" />
        ) : (
          <div className="plant-grid">
            {data.plants.map((p) => <PlantCard key={p.id} plant={p} showStatus={p.status !== 'approved'} />)}
          </div>
        )}
      </div>
    </div>
  );
}
