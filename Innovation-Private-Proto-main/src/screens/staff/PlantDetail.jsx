import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import {
  ConfirmButton, ConservationBadge, CopyButton, Empty, LoadingBlock, Modal, Notice,
  PageHead, StatusBadge,
} from '../../components/ui.jsx';
import { HEALTH, LIFE_STAGE, coords, formatDateTime, relativeTime, titleCase } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

/* ------------------------------------------------------------------ */

function QrPanel({ plant }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setQr(null); setError(null);
    api.qr(plant.id).then(setQr).catch((e) => setError(e.message));
  }, [plant.id, plant.status]);

  if (error) return <Notice kind="warn" title="No tag yet">{error}</Notice>;
  if (!qr) return <LoadingBlock label="Generating tag" />;

  const download = () => {
    const a = document.createElement('a');
    a.href = qr.png;
    a.download = plant.plant_code + '-qr.png';
    a.click();
  };

  return (
    <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
      <div>
        <div className="qr-card">
          <img src={qr.png} alt={'QR code for ' + plant.plant_code} />
          <div className="tiny mono" style={{ wordBreak: 'break-all', textAlign: 'center', color: '#4a5a4c' }}>{qr.target_url}</div>
        </div>
        <div className="row row-wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" onClick={download}><I.Download /> Download PNG</button>
          <button className="btn btn-sm" onClick={() => window.print()}><I.Printer /> Print tag</button>
          <CopyButton text={qr.target_url} label="Copy URL" />
        </div>
      </div>

      <div className="stack" style={{ '--gap': '14px' }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Printable tag preview</div>
          <div className="qr-tag">
            <img src={qr.png} alt="" style={{ width: 130, margin: '0 auto 8px' }} />
            <div className="t-sci">{qr.scientific_name || plant.proposed_species_name}</div>
            {qr.common_name && <div className="t-com">{qr.common_name}</div>}
            <div className="t-code">{plant.plant_code}</div>
          </div>
        </div>

        <dl className="dl small">
          <dt>Token</dt><dd className="mono tiny" style={{ wordBreak: 'break-all' }}>{qr.qr_token}</dd>
          <dt>Tag status</dt><dd style={{ textTransform: 'capitalize' }}>{qr.status}</dd>
          <dt>Version</dt><dd>{qr.version}</dd>
          <dt>Scans</dt><dd>{qr.scans}</dd>
        </dl>

        <Notice kind="plain">
          The tag encodes an opaque token, never the database id, so the register cannot be enumerated by
          editing the URL. Editing the record does not change the token, so a printed tag stays valid.
        </Notice>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * `version` bumps every time the parent reloads the record, so an edit made
 * while this tab is already open shows up without switching tabs.
 */
function HistoryPanel({ plantId, version }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api.history(plantId)
      .then((d) => live && setData(d))
      .catch(() => live && setData({ revisions: [], audits: [] }));
    return () => { live = false; };
  }, [plantId, version]);
  if (!data) return <LoadingBlock label="Loading history" />;

  const merged = [
    ...data.audits.map((a) => ({ kind: 'audit', at: a.created_at, who: a.user_name, action: a.action, a })),
    ...data.revisions.map((r) => ({ kind: 'rev', at: r.created_at, who: r.changed_by_name, r })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));

  if (!merged.length) return <Empty icon={I.Clock} title="No changes recorded yet" />;

  return (
    <div className="timeline">
      {merged.map((m, i) => (
        <div key={i} className={'tl-item' + (m.kind === 'audit' && ['approve', 'reject'].includes(m.action) ? ' accent' : '')}>
          <div className="small">
            <strong>{m.who}</strong>{' '}
            {m.kind === 'audit'
              ? <>{{ create: 'registered the record', approve: 'approved and published it', reject: 'returned it with a note', archive: 'archived it', update: 'updated the record' }[m.action] || m.action}</>
              : <>changed <span className="mono tiny">{m.r.field_name}</span></>}
          </div>
          {m.kind === 'rev' && (
            <div className="tl-diff">
              <span className="tl-old">{m.r.old_value || 'empty'}</span>
              <I.ChevronRight style={{ width: 12, height: 12, color: 'var(--text-faint)' }} />
              <span className="tl-new">{m.r.new_value || 'empty'}</span>
            </div>
          )}
          {m.kind === 'rev' && m.r.change_reason && <div className="tiny mute" style={{ marginTop: 2 }}>{m.r.change_reason}</div>}
          <div className="tl-time">{formatDateTime(m.at)} &middot; {relativeTime(m.at)}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EditDialog({ plant, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    site_name: plant.site_name || '', location_notes: plant.location_notes || '',
    height_m: plant.height_m ?? '', trunk_diameter_cm: plant.trunk_diameter_cm ?? '',
    health_status: plant.health_status || '', life_stage: plant.life_stage || '',
    morphology_notes: plant.morphology_notes || '', notes: plant.notes || '',
    change_reason: '',
  });
  const [busy, setBusy] = useState(false);
  const up = (p) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      await api.updatePlant(plant.id, {
        ...form,
        height_m: form.height_m === '' ? null : Number(form.height_m),
        trunk_diameter_cm: form.trunk_diameter_cm === '' ? null : Number(form.trunk_diameter_cm),
      });
      toast('Record updated. The change is in the history.');
      onSaved();
      onClose();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={'Edit ' + plant.plant_code}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy && <span className="spinner" />}Save changes</button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <Notice kind="plain">
          Every field you change is written to the history with the old and new value, and to the audit trail
          against your account.
        </Notice>
        <div className="field">
          <label htmlFor="e-site">Site or trail marker</label>
          <input id="e-site" className="input" value={form.site_name} onChange={(e) => up({ site_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="e-loc">How to find it</label>
          <textarea id="e-loc" className="textarea" style={{ minHeight: 60 }} value={form.location_notes} onChange={(e) => up({ location_notes: e.target.value })} />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="e-h">Height (m)</label>
            <input id="e-h" type="number" step="0.1" className="input" value={form.height_m} onChange={(e) => up({ height_m: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="e-d">Trunk diameter (cm)</label>
            <input id="e-d" type="number" step="0.1" className="input" value={form.trunk_diameter_cm} onChange={(e) => up({ trunk_diameter_cm: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="e-life">Life stage</label>
            <select id="e-life" className="select" value={form.life_stage} onChange={(e) => up({ life_stage: e.target.value })}>
              <option value="">Not recorded</option>
              {Object.entries(LIFE_STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-health">Condition</label>
            <select id="e-health" className="select" value={form.health_status} onChange={(e) => up({ health_status: e.target.value })}>
              <option value="">Not recorded</option>
              {Object.entries(HEALTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="e-morph">Field notes</label>
          <textarea id="e-morph" className="textarea" value={form.morphology_notes} onChange={(e) => up({ morphology_notes: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="e-reason">Reason for the change <span className="hint">(optional)</span></label>
          <input id="e-reason" className="input" value={form.change_reason} onChange={(e) => up({ change_reason: e.target.value })} placeholder="Corrected after a site visit" />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export default function PlantDetail() {
  const { id } = useParams();
  const { can, toast, refreshCounts } = useApp();
  const navigate = useNavigate();
  const [plant, setPlant] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped on every reload so child panels holding their own data refetch.
  const [version, setVersion] = useState(0);

  const load = () => api.plantById(id)
    .then((r) => { setPlant(r.plant); setVersion((v) => v + 1); })
    .catch(() => setMissing(true));
  useEffect(() => { setPlant(null); setMissing(false); load(); }, [id]);

  if (missing) {
    return (
      <div className="page"><div className="wrap wrap-narrow">
        <Empty icon={I.Leaf} title="Record not found" action={<Link className="btn" to="/staff/plants">Back to the register</Link>}>
          It may have been removed, or your role may not be allowed to see it.
        </Empty>
      </div></div>
    );
  }
  if (!plant) return <LoadingBlock label="Loading record" />;

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); await load(); await refreshCounts(); toast(msg); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const sp = plant.species || {};

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1060 }}>
        <PageHead
          back={{ to: '/staff/plants', label: 'Plant register' }}
          title={<span className={plant.scientific_name ? 'sci' : ''}>{plant.scientific_name || plant.proposed_species_name}</span>}
          sub={<><span className="mono">{plant.plant_code}</span> &middot; {plant.site_name}</>}
        >
          <StatusBadge status={plant.status} />
          {plant.conservation_code && <ConservationBadge code={plant.conservation_code} />}
        </PageHead>

        {/* Action bar */}
        <div className="card card-pad row row-wrap" style={{ gap: 9, marginBottom: 18 }}>
          {plant.status === 'approved' && plant.qr_token && (
            <Link className="btn btn-sm" to={'/p/' + plant.qr_token}><I.External /> View public page</Link>
          )}
          {can('plant.edit') && (
            <button className="btn btn-sm" onClick={() => setEditing(true)} disabled={busy}><I.Edit /> Edit</button>
          )}
          <span className="spacer" />
          {can('plant.approve') && plant.status === 'pending' && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || plant.species_not_listed}
              title={plant.species_not_listed ? 'Confirm the species first, from the review queue' : undefined}
              onClick={() => act(() => api.approve(plant.id), plant.plant_code + ' published.')}
            >
              <I.Check /> Approve and publish
            </button>
          )}
          {can('plant.archive') && plant.status === 'approved' && (
            <ConfirmButton
              className="btn btn-sm btn-danger"
              icon={I.Archive}
              label="Archive"
              title={'Archive ' + plant.plant_code + '?'}
              confirmLabel="Archive record"
              body={
                <Notice kind="warn" title="The record is kept, not deleted">
                  It drops off the public site and its QR tag is withdrawn, so a scan shows
                  &ldquo;no longer on display&rdquo;. The audit trail and printed tags stay accounted for,
                  and you can restore it later.
                </Notice>
              }
              onConfirm={() => act(() => api.archive(plant.id, 'Archived from the staff record'), plant.plant_code + ' archived.')}
            />
          )}
          {can('plant.archive') && plant.status === 'archived' && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.restore(plant.id), plant.plant_code + ' restored to public view.')}>
              <I.Refresh /> Restore to public view
            </button>
          )}
        </div>

        {plant.review_comment && (
          <div style={{ marginBottom: 18 }}>
            <Notice kind="warn" title="Returned to the ranger with this note">{plant.review_comment}</Notice>
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 18 }}>
          {[['details', 'Details'], ['photos', 'Photographs'], ['qr', 'QR tag'], ['history', 'History']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {l}{k === 'photos' && plant.photo_count > 0 && <span className="count">{plant.photo_count}</span>}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', alignItems: 'start' }}>
            <div className="card">
              <div className="card-head"><h3>Specimen</h3></div>
              <div className="card-body" style={{ paddingBlock: 6 }}>
                <dl className="dl">
                  <dt>Plant ID</dt><dd className="mono">{plant.plant_code}</dd>
                  <dt>Status</dt><dd><StatusBadge status={plant.status} /></dd>
                  <dt>Site</dt><dd>{plant.site_name}</dd>
                  {coords(plant.latitude, plant.longitude) && <><dt>Coordinates</dt><dd className="mono tiny">{coords(plant.latitude, plant.longitude)}</dd></>}
                  {plant.gps_accuracy_m && <><dt>GPS accuracy</dt><dd>&plusmn;{plant.gps_accuracy_m} m</dd></>}
                  {plant.height_m && <><dt>Height</dt><dd>{plant.height_m} m</dd></>}
                  {plant.trunk_diameter_cm && <><dt>Trunk diameter</dt><dd>{plant.trunk_diameter_cm} cm</dd></>}
                  {plant.life_stage && <><dt>Life stage</dt><dd>{LIFE_STAGE[plant.life_stage]}</dd></>}
                  {plant.health_status && <><dt>Condition</dt><dd>{HEALTH[plant.health_status]}</dd></>}
                  <dt>Registered</dt><dd>{formatDateTime(plant.registered_at)}<div className="tiny mute">{plant.registered_by_name}</div></dd>
                  {plant.verified_at && <><dt>Verified</dt><dd>{formatDateTime(plant.verified_at)}<div className="tiny mute">{plant.verified_by_name}</div></dd></>}
                  <dt>Public views</dt><dd>{plant.view_count}</dd>
                  <dt>Tag scans</dt><dd>{plant.scan_count ?? 0}</dd>
                </dl>
              </div>
            </div>

            <div className="stack" style={{ '--gap': '18px' }}>
              <div className="card">
                <div className="card-head">
                  <h3 className="grow">Species</h3>
                  {plant.species_id && <Link className="btn btn-sm btn-ghost" to={'/species/' + plant.species_id}>Open <I.ChevronRight /></Link>}
                </div>
                <div className="card-body" style={{ paddingBlock: 6 }}>
                  {plant.species_not_listed ? (
                    <Notice kind="warn" title="Species not confirmed">
                      Recorded by the ranger as &ldquo;{plant.proposed_species_name}&rdquo;. A botanist must
                      set a species from the review queue before this can be published.
                    </Notice>
                  ) : (
                    <dl className="dl">
                      <dt>Scientific name</dt><dd className="sci">{plant.scientific_name}</dd>
                      <dt>Common name</dt><dd>{plant.common_name || '--'}</dd>
                      <dt>Local name</dt><dd>{plant.local_name || '--'}</dd>
                      <dt>Family</dt><dd>{plant.family || '--'}</dd>
                      <dt>Genus</dt><dd className="sci">{plant.genus || '--'}</dd>
                      <dt>Growth form</dt><dd>{plant.growth_form ? titleCase(plant.growth_form) : '--'}</dd>
                      <dt>Conservation</dt><dd>{plant.conservation_label || 'Not evaluated'}</dd>
                    </dl>
                  )}
                </div>
              </div>

              {plant.location_notes && (
                <div className="inset"><div className="label" style={{ marginBottom: 4 }}>How to find it</div><div className="small">{plant.location_notes}</div></div>
              )}
              {plant.morphology_notes && (
                <div className="inset"><div className="label" style={{ marginBottom: 4 }}>Field notes</div><div className="small">{plant.morphology_notes}</div></div>
              )}
              {plant.notes && (
                <div className="inset" style={{ borderColor: 'var(--warn-br)', background: 'var(--warn-bg)' }}>
                  <div className="label" style={{ marginBottom: 4 }}>Internal notes (staff only)</div>
                  <div className="small">{plant.notes}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'photos' && (
          plant.photos?.length ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
              {plant.photos.map((p) => (
                <div className="card" key={p.id} style={{ overflow: 'hidden' }}>
                  <div style={{ aspectRatio: '4/3', background: 'var(--surface-3)' }}>
                    <img src={p.file_path} alt={p.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: 11 }}>
                    {p.is_primary ? <span className="badge badge-ok" style={{ marginBottom: 5 }}>Main image</span> : null}
                    <div className="small">{p.caption || p.file_name}</div>
                    <div className="tiny faint" style={{ marginTop: 3 }}>{p.width_px ? `${p.width_px}×${p.height_px} · ` : ''}{p.mime_type}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon={I.Image} title="No photographs on this record" />
        )}

        {tab === 'qr' && (
          plant.status === 'approved' || plant.qr_token
            ? <QrPanel plant={plant} />
            : (
              <Notice kind="info" title="No tag yet">
                A QR code is issued automatically the moment the record is published. Approve it first and the
                tag appears here, ready to download and print.
              </Notice>
            )
        )}

        {tab === 'history' && <HistoryPanel plantId={plant.id} version={version} />}
      </div>

      {editing && <EditDialog plant={plant} onClose={() => setEditing(false)} onSaved={load} />}
    </div>
  );
}
