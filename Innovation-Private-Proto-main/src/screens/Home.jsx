import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { PlantCard, SearchInput, Skeleton } from '../components/ui.jsx';
import { Reveal, CountUp, SmartImage } from '../components/motion.jsx';
import { num } from '../lib/format.js';
import * as I from '../lib/icons.jsx';

export default function Home() {
  const { boot, mobile } = useApp();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);
  const [threatened, setThreatened] = useState(null);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.publicStats().then(setStats).catch(() => {});
    api.publicPlants({ sort: 'recent' }).then((r) => setRecent(r.results)).catch(() => setRecent([]));
    Promise.all(['CR', 'EN', 'VU'].map((c) => api.publicPlants({ conservation: c })))
      .then((rs) => setThreatened(rs.flatMap((r) => r.results)))
      .catch(() => setThreatened([]));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    navigate('/browse' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : ''));
  };

  /* Where the published records actually are, so a visitor standing on a
     trail can start from the trail rather than from a species name. */
  const places = useMemo(() => {
    if (!recent) return [];
    const counts = new Map();
    recent.forEach((p) => counts.set(p.site_name, (counts.get(p.site_name) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [recent]);

  // A tree or whole-plant shot reads better behind the headline than a
  // close-up of a single flower, so prefer one.
  const heroPhoto = useMemo(() => {
    if (!recent?.length) return null;
    const withPhoto = recent.filter((p) => p.photo);
    const scenic = withPhoto.find((p) => ['tree', 'palm'].includes(p.growth_form));
    return (scenic || withPhoto[0])?.photo || null;
  }, [recent]);
  const families = (boot?.families || []).slice(0, 12);
  const newest = (recent || []).slice(0, mobile ? 4 : 8);
  const atRisk = (threatened || []).slice(0, 4);

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="hero">
        {heroPhoto && (
          <div className="hero-photo" aria-hidden="true">
            <SmartImage src={heroPhoto} alt="" />
          </div>
        )}
        <div className="wrap">
          <div className="hero-in">
            <div className="hero-place">
              <I.MapPin style={{ width: 13, height: 13 }} />
              {boot?.park_name || 'Niah National Park'}, Sarawak
            </div>

            <h1>Every plant on the trail, explained.</h1>
            <p>
              Scan the tag beside a plant, or search the register by name, family or location.
              Nothing appears here until a botanist has confirmed it.
            </p>

            <form onSubmit={submit} className="hero-search">
              <SearchInput
                value={q}
                onChange={setQ}
                large
                placeholder={mobile ? 'Search the register' : 'Try "Belian", "Nepenthes", "Dipterocarpaceae" or a Plant ID'}
              />
            </form>

            <div className="hero-actions">
              <Link to="/scan" className="hero-btn hero-btn-solid"><I.Scan /> Scan a tag</Link>
              <Link to="/browse" className="hero-btn"><I.Grid /> Browse all plants</Link>
            </div>

            {stats && (
              <div className="hero-figures">
                <span><strong><CountUp value={stats.published_plants} /></strong> plants</span>
                <span><strong><CountUp value={stats.species} /></strong> species</span>
                <span><strong><CountUp value={stats.families} /></strong> families</span>
                <span><strong><CountUp value={stats.threatened} /></strong> threatened</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="page">
        <div className="wrap">
          {/* ---------------- Start from where you are ---------------- */}
          {places.length > 0 && (
            <Reveal className="section">
              <div className="section-head">
                <h2>Start from where you are</h2>
                <p>Published records, grouped by where they stand in the park.</p>
              </div>
              <div className="place-list">
                {places.map(([site, count], i) => (
                  <Link key={site} to={'/browse?site=' + encodeURIComponent(site)} className="place">
                    <I.MapPin />
                    <span className="grow truncate">{site}</span>
                    <span className="place-n">{count}</span>
                  </Link>
                ))}
              </div>
            </Reveal>
          )}

          {/* ---------------- Recently verified ---------------- */}
          <Reveal className="section">
            <div className="section-head">
              <div className="grow">
                <h2>Recently verified</h2>
                <p>The newest records to pass botanist review.</p>
              </div>
              <Link to="/browse" className="btn btn-sm">All {num(stats?.published_plants || 0)} <I.ChevronRight /></Link>
            </div>

            <div className="plant-grid">
              {recent
                ? newest.map((p, i) => (
                    <Reveal key={p.id} index={i}><PlantCard plant={p} eager={i < 4} /></Reveal>
                  ))
                : Array.from({ length: 4 }).map((_, i) => (
                    <div className="card" key={i}>
                      <Skeleton h={0} style={{ aspectRatio: '4/3', height: 'auto' }} />
                      <div style={{ padding: 14 }}><Skeleton h={14} w="70%" /><div style={{ height: 7 }} /><Skeleton h={11} w="45%" /></div>
                    </div>
                  ))}
            </div>
          </Reveal>

          {/* ---------------- Conservation ---------------- */}
          {atRisk.length > 0 && (
            <Reveal className="section">
              <div className="section-head">
                <div className="grow">
                  <h2>Under pressure</h2>
                  <p>Specimens of species assessed as vulnerable or worse on the IUCN Red List.</p>
                </div>
              </div>

              <div className="ramp">
                {['LC', 'NT', 'VU', 'EN', 'CR'].map((c) => (
                  <Link key={c} to={'/browse?conservation=' + c} className="ramp-step" style={{ '--c': `var(--cs-${c})` }}>
                    <span className="ramp-bar" />
                    <span className="ramp-code">{c}</span>
                  </Link>
                ))}
                <span className="ramp-caption">least concern &rarr; critically endangered</span>
              </div>

              <div className="plant-grid">
                {atRisk.map((p, i) => <Reveal key={p.id} index={i}><PlantCard plant={p} /></Reveal>)}
              </div>
            </Reveal>
          )}

          {/* ---------------- Families ---------------- */}
          {families.length > 0 && (
            <Reveal className="section">
              <div className="section-head">
                <h2>By family</h2>
                <p>Taxonomy is held once per species, so a correction reaches every specimen at once.</p>
              </div>
              <div className="row row-wrap" style={{ gap: 7 }}>
                {families.map((f) => (
                  <Link key={f} className="chip" to={'/browse?family=' + encodeURIComponent(f)}>{f}</Link>
                ))}
                <Link className="chip" to="/species">All species <I.ChevronRight style={{ width: 13, height: 13 }} /></Link>
              </div>
            </Reveal>
          )}

          {/* ---------------- Provenance + reporting ---------------- */}
          <Reveal className="colophon">
            <div>
              <strong>Where this comes from.</strong>{' '}
              Taxonomy and Red List categories are drawn from{' '}
              <a href="https://www.gbif.org" target="_blank" rel="noreferrer">GBIF</a>; photographs are
              contributed to <a href="https://www.inaturalist.org" target="_blank" rel="noreferrer">iNaturalist</a>{' '}
              under Creative Commons licences and credited on each plant page. Specimen records are
              entered by park rangers and verified by a botanist before they appear.
            </div>
            <div style={{ marginTop: 10 }}>
              <strong>Spotted something wrong?</strong>{' '}
              Open any plant page and use <em>Report incorrect information</em>. No account needed.
            </div>
          </Reveal>
        </div>
      </div>
    </>
  );
}
