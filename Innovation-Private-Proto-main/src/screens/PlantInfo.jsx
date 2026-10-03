import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { SmartImage } from '../components/motion.jsx';
import {
  ConservationBadge, StatusBadge, Empty, LoadingBlock, Modal, Notice, CopyButton,
} from '../components/ui.jsx';
import {
  CONSERVATION, GROWTH_FORM, HEALTH, LIFE_STAGE, coords, formatDate, measure, num, titleCase,
} from '../lib/format.js';
import * as I from '../lib/icons.jsx';

/* ------------------------------------------------------------------ */

/**
 * Photo credit. Every photograph here is somebody's work under a Creative
 * Commons licence, so the credit travels with the image rather than living in
 * a footnote nobody reads.
 */
function Credit({ photo, className = 'credit' }) {
  if (!photo?.credit && !photo?.source_name) return null;
  if (!photo.credit) {
    return <div className={className}>{photo.source_name}</div>;
  }
  return (
    <div className={className}>
      {photo.credit}
      {photo.license && <> &middot; {photo.license}</>}
      {photo.source_url && (
        <> &middot; <a href={photo.source_url} target="_blank" rel="noreferrer">{photo.source_name || 'source'}</a></>
      )}
    </div>
  );
}

function Gallery({ photos, alt }) {
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(false);

  if (!photos?.length) {
    return (
      <div className="card" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center', background: 'var(--surface-3)' }}>
        <I.Image style={{ width: 38, height: 38, color: 'var(--text-faint)' }} />
      </div>
    );
  }
  const current = photos[Math.min(idx, photos.length - 1)];

  return (
    <div>
      <button
        onClick={() => setZoom(true)}
        className="gallery-main"
        style={{ display: 'block', position: 'relative', width: '100%', padding: 0, border: 0, background: 'none', borderRadius: 'var(--r-md)', overflow: 'hidden', cursor: 'zoom-in' }}
        aria-label="Enlarge photograph"
      >
        <div style={{ aspectRatio: '4/3', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <SmartImage src={current.file_path} fallback={current.remote_url} tint={current.tint} alt={alt} />
        </div>
        {current.credit && <span className="credit-overlay">{current.credit}</span>}
      </button>

      <div className="gallery-meta">
        {current.caption && <div className="tiny mute gallery-caption">{current.caption}</div>}
        <Credit photo={current} />
      </div>

      {photos.length > 1 && (
        <div className="row row-wrap" style={{ gap: 7, marginTop: 9 }}>
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setIdx(i)}
              aria-label={'Photograph ' + (i + 1)}
              aria-current={i === idx}
              style={{
                width: 62, height: 48, padding: 0, borderRadius: 8, overflow: 'hidden',
                border: '2px solid ' + (i === idx ? 'var(--accent)' : 'var(--border)'),
                background: 'var(--surface-3)', cursor: 'pointer',
              }}
            >
              <SmartImage src={p.thumbnail_path || p.file_path} fallback={p.remote_url} tint={p.tint} alt="" />
            </button>
          ))}
        </div>
      )}

      {zoom && (
        <Modal title={current.caption || alt} onClose={() => setZoom(false)} wide>
          <img src={current.file_path} alt={alt} style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />
          <div style={{ marginTop: 10 }}><Credit photo={current} className="credit small" /></div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReportDialog({ plant, onClose }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ issue_type: 'wrong_name', description: '', reporter_name: '', reporter_email: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.description.trim()) { toast('Please describe what looks wrong.', 'err'); return; }
    setBusy(true);
    try {
      await api.createReport({ plant_id: plant.id, ...form });
      toast('Thank you. A botanist will review your report.');
      onClose();
    } catch (e) {
      toast(e.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Report incorrect information"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}Send report
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <Notice kind="plain">
          You are reporting <strong>{plant.plant_code}</strong>
          {plant.scientific_name && <> &mdash; <span className="sci">{plant.scientific_name}</span></>}.
        </Notice>
        <div className="field">
          <label htmlFor="r-type">What is wrong?</label>
          <select id="r-type" className="select" value={form.issue_type} onChange={(e) => setForm({ ...form, issue_type: e.target.value })}>
            <option value="wrong_name">The species or name looks wrong</option>
            <option value="wrong_location">The location is wrong</option>
            <option value="bad_photo">The photograph is unclear or wrong</option>
            <option value="outdated">The information is out of date</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-desc">Details <span className="req">*</span></label>
          <textarea
            id="r-desc" className="textarea" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Tell us what you saw and why you think the record is wrong."
          />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="r-name">Your name <span className="hint">(optional)</span></label>
            <input id="r-name" className="input" value={form.reporter_name} onChange={(e) => setForm({ ...form, reporter_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="r-email">Email <span className="hint">(optional)</span></label>
            <input id="r-email" type="email" className="input" value={form.reporter_email} onChange={(e) => setForm({ ...form, reporter_email: e.target.value })} />
          </div>
        </div>
        <div className="hint">You do not need an account. We only use your email to ask a follow-up question.</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export default function PlantInfo({ byToken }) {
  const { id, token } = useParams();
  const { user, can, mobile } = useApp();
  const [plant, setPlant] = useState(null);
  const [error, setError] = useState(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    setPlant(null); setError(null);
    const p = byToken ? api.plantByToken(token) : api.plantById(id);
    p.then((r) => setPlant(r.plant)).catch((e) => setError(e));
  }, [byToken, id, token]);

  if (error) {
    const reason = error.body?.reason;
    return (
      <div className="page"><div className="wrap wrap-narrow">
        <Empty
          icon={reason === 'archived' ? I.Archive : I.Compass}
          title={reason === 'archived' ? 'This plant is no longer on display' : 'Tag not recognised'}
          action={<Link className="btn btn-primary" to="/browse">Browse the register</Link>}
        >
          {reason === 'archived'
            ? <>The record {error.body?.plant_code ? <span className="mono">{error.body.plant_code}</span> : null} has been archived by a botanist, usually because the specimen was removed. The tag stays accounted for in the register.</>
            : <>This QR code does not match any plant in the register. It may be a tag from another system, or the record may not be published yet.</>}
        </Empty>
      </div></div>
    );
  }

  if (!plant) return <LoadingBlock label="Loading plant record" />;

  const sp = plant.species || {};
  const name = plant.scientific_name || plant.proposed_species_name || 'Unidentified specimen';
  const meta = CONSERVATION[plant.conservation_code];

  const sections = [
    ['Description', sp.description],
    ['Distinguishing characteristics', sp.characteristics],
    ['Leaves', sp.leaf_description],
    ['Flowers', sp.flower_description],
    ['Fruit', sp.fruit_description],
    ['Habitat', sp.habitat],
    ['Distribution', sp.distribution],
  ].filter(([, v]) => v);

  return (
    <div className="page">
      <div className="wrap wrap-narrow">
        {plant.status !== 'approved' && (
          <div style={{ marginBottom: 16 }}>
            <Notice kind="warn" title="Not published">
              This record is <strong>{plant.status}</strong> and is not visible to the public.
              You can see it because you are signed in as staff.
            </Notice>
          </div>
        )}

        {byToken && (
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <span className="badge badge-ok"><I.Check style={{ width: 12, height: 12 }} /> Tag scanned</span>
            <span className="tiny mute">Verified record from the park register</span>
          </div>
        )}

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div className="row row-wrap" style={{ gap: 8, marginBottom: 10 }}>
            {plant.conservation_code && <ConservationBadge code={plant.conservation_code} />}
            {sp.growth_form && <span className="tag">{GROWTH_FORM[sp.growth_form] || titleCase(sp.growth_form)}</span>}
            {user && <StatusBadge status={plant.status} />}
          </div>
          <h1 className={plant.scientific_name ? 'sci' : ''} style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)' }}>{name}</h1>
          <div className="row row-wrap" style={{ gap: 10, marginTop: 6 }}>
            {plant.common_name && <span style={{ fontSize: '1.02rem', color: 'var(--text-soft)' }}>{plant.common_name}</span>}
            {plant.local_name && <span className="mute">&middot; {plant.local_name}</span>}
          </div>
          {plant.species_not_listed && (
            <div style={{ marginTop: 12 }}>
              <Notice kind="warn" title="Species not yet confirmed">
                A ranger recorded this specimen as &ldquo;{plant.proposed_species_name}&rdquo;.
                A botanist has not yet confirmed the identification.
              </Notice>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 22, gridTemplateColumns: mobile ? '1fr' : '1.15fr 1fr', alignItems: 'start' }}>
          <Gallery photos={plant.photos} alt={name} />

          <div className="stack" style={{ '--gap': '16px' }}>
            {/* Taxonomy */}
            <div className="card">
              <div className="card-head"><h3>Classification</h3></div>
              <div className="card-body" style={{ paddingBlock: 6 }}>
                <dl className="dl">
                  <dt>Family</dt>
                  <dd>{sp.family ? <Link to={'/browse?family=' + encodeURIComponent(sp.family)}>{sp.family}</Link> : '--'}</dd>
                  <dt>Genus</dt>
                  <dd>{sp.genus ? <Link className="sci" to={'/browse?genus=' + encodeURIComponent(sp.genus)}>{sp.genus}</Link> : '--'}</dd>
                  <dt>Scientific name</dt>
                  <dd className="sci">{plant.scientific_name || '--'}</dd>
                  {plant.local_name && <><dt>Local name</dt><dd>{plant.local_name}</dd></>}
                  <dt>Conservation</dt>
                  <dd>{meta ? meta.label : 'Not evaluated'}</dd>
                </dl>
              </div>
            </div>

            {/* This specimen */}
            <div className="card">
              <div className="card-head"><h3>This specimen</h3></div>
              <div className="card-body" style={{ paddingBlock: 6 }}>
                <dl className="dl">
                  <dt>Plant ID</dt>
                  <dd className="mono">{plant.plant_code}</dd>
                  <dt>Location</dt>
                  <dd>
                    {plant.location_protected
                      ? <span className="row" style={{ gap: 6 }}><I.Shield style={{ width: 14, height: 14, color: 'var(--warn-fg)' }} /> Withheld</span>
                      : plant.site_name}
                  </dd>
                  {!plant.location_protected && coords(plant.latitude, plant.longitude) && (
                    <>
                      <dt>Coordinates</dt>
                      <dd>
                        <span className="mono tiny">{coords(plant.latitude, plant.longitude)}</span>
                        <a
                          href={`https://www.google.com/maps?q=${plant.latitude},${plant.longitude}`}
                          target="_blank" rel="noreferrer"
                          className="tiny nowrap" style={{ marginLeft: 8 }}
                        >
                          Open map <I.External style={{ width: 11, height: 11, display: 'inline' }} />
                        </a>
                      </dd>
                    </>
                  )}
                  {plant.height_m && <><dt>Height</dt><dd>{measure(plant.height_m, 'm')}</dd></>}
                  {plant.trunk_diameter_cm && <><dt>Trunk diameter</dt><dd>{measure(plant.trunk_diameter_cm, 'cm')}</dd></>}
                  {plant.life_stage && <><dt>Life stage</dt><dd>{LIFE_STAGE[plant.life_stage]}</dd></>}
                  {plant.health_status && <><dt>Condition</dt><dd>{HEALTH[plant.health_status]}</dd></>}
                  <dt>Registered</dt>
                  <dd>{formatDate(plant.registered_at)}{plant.registered_by_name && <span className="mute"> by {plant.registered_by_name}</span>}</dd>
                  {plant.verified_at && (
                    <>
                      <dt>Verified</dt>
                      <dd>{formatDate(plant.verified_at)}{plant.verified_by_name && <span className="mute"> by {plant.verified_by_name}</span>}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>

            {plant.location_protected && (
              <Notice kind="warn" title="Location withheld">
                {plant.location_withheld_reason}
                {' '}Park staff can see it when signed in.
              </Notice>
            )}
            {plant.location_notes && (
              <div className="inset">
                <div className="label" style={{ marginBottom: 4 }}><I.MapPin style={{ width: 13, height: 13 }} /> Finding it</div>
                <div className="small">{plant.location_notes}</div>
              </div>
            )}
            {plant.morphology_notes && (
              <div className="inset">
                <div className="label" style={{ marginBottom: 4 }}><I.Leaf style={{ width: 13, height: 13 }} /> Field notes</div>
                <div className="small">{plant.morphology_notes}</div>
              </div>
            )}
          </div>
        </div>

        {/* Long-form species content */}
        {sections.length > 0 && (
          <div className="card card-pad" style={{ marginTop: 22 }}>
            <div className="prose">
              {sections.map(([title, text]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            {plant.species_id && (
              <div style={{ marginTop: 16 }}>
                <Link className="btn btn-sm" to={'/species/' + plant.species_id}>
                  <I.Book /> All {sp.plant_count} specimen{sp.plant_count === 1 ? '' : 's'} of this species
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="row row-wrap row-between" style={{ marginTop: 24, gap: 12 }}>
          <div className="row row-wrap" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setReporting(true)}>
              <I.Flag /> Report incorrect information
            </button>
            <CopyButton text={window.location.href} label="Copy link" />
            {user && can('plant.view_all') && (
              <Link className="btn btn-sm btn-soft" to={'/staff/plants/' + plant.id}>
                <I.Edit /> Open in staff view
              </Link>
            )}
          </div>
          <div className="tiny faint row" style={{ gap: 12 }}>
            {plant.view_count > 0 && <span><I.Eye style={{ width: 12, height: 12, display: 'inline', verticalAlign: -2 }} /> {num(plant.view_count)} views</span>}
            {plant.scan_count > 0 && <span><I.Scan style={{ width: 12, height: 12, display: 'inline', verticalAlign: -2 }} /> {num(plant.scan_count)} scans</span>}
          </div>
        </div>

        <div className="tiny faint" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          Photographs are contributed to iNaturalist under Creative Commons licences and credited to the
          photographer; where no photograph exists the page falls back to a generated illustration.
          Taxonomy and Red List categories come from GBIF.
        </div>
      </div>

      {reporting && <ReportDialog plant={plant} onClose={() => setReporting(false)} />}
    </div>
  );
}
