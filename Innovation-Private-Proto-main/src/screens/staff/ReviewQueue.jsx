import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import {
  Avatar, ConservationBadge, Empty, LoadingBlock, Modal, Notice, PageHead, SearchInput, StatusBadge,
} from '../../components/ui.jsx';
import { coords, formatDateTime, relativeTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

/* ------------------------------------------------------------------ */

function AssignSpecies({ plant, onDone }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) api.species().then((r) => setRows(r.results)).catch(() => {}); }, [open]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = n
      ? rows.filter((s) => [s.scientific_name, s.common_name, s.local_name, s.family, s.genus]
          .filter(Boolean).join(' ').toLowerCase().includes(n))
      : rows;
    return base.slice(0, 50);
  }, [rows, q]);

  const assign = async (id) => {
    setBusy(true);
    try {
      await api.updatePlant(plant.id, { species_id: id, change_reason: 'Species confirmed at review' });
      toast('Species set. You can approve the record now.');
      setOpen(false);
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <button className="btn btn-sm btn-soft" onClick={() => setOpen(true)}><I.Book /> Set species</button>
      {open && (
        <Modal title={'Confirm the species for ' + plant.plant_code} onClose={() => setOpen(false)}>
          <div style={{ marginBottom: 14 }}>
            <Notice kind="plain">
              The ranger recorded this as <strong>&ldquo;{plant.proposed_species_name}&rdquo;</strong>.
              Choose the species it belongs to, or add a new species first from the species list.
            </Notice>
          </div>
          <div style={{ marginBottom: 12 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search the species list" autoFocus />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {filtered.map((s) => (
              <button
                key={s.id} className="rs-item" style={{ border: '1px solid var(--border)' }}
                disabled={busy} onClick={() => assign(s.id)}
              >
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="nm sci truncate">{s.scientific_name}</span>
                  <span className="rl truncate">{[s.common_name, s.family].filter(Boolean).join(' · ')}</span>
                </span>
                <ConservationBadge code={s.conservation_code} showLabel={false} />
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-sm" to="/staff/species"><I.Plus /> Add a new species</Link>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function RejectDialog({ plant, onClose, onDone }) {
  const { toast, refreshCounts } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const PRESETS = [
    'Photographs do not show the diagnostic features. Please re-photograph the leaf underside and the bark slash.',
    'This duplicates an existing published record at the same location.',
    'The GPS position does not match the described site. Please confirm on the ground.',
    'The identification cannot be confirmed from what was submitted. Please collect a fertile specimen.',
  ];

  const submit = async () => {
    if (!note.trim()) { toast('A note is required so the ranger knows what to change.', 'err'); return; }
    setBusy(true);
    try {
      await api.reject(plant.id, note.trim());
      await refreshCounts();
      toast(plant.plant_code + ' returned to the ranger.');
      onDone();
      onClose();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={'Return ' + plant.plant_code + ' with a note'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}Return to ranger
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <Notice kind="plain">
          The record stays in the register with the status <strong>returned</strong>, and
          {plant.registered_by_name ? ` ${plant.registered_by_name}` : ' the ranger'} is notified with your note.
          Nothing is deleted.
        </Notice>
        <div className="field">
          <label htmlFor="note">Note <span className="req">*</span></label>
          <textarea
            id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Explain what needs to change before this can be published."
          />
        </div>
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>Common reasons</div>
          <div className="row row-wrap" style={{ gap: 6 }}>
            {PRESETS.map((p, i) => (
              <button key={i} type="button" className="chip" onClick={() => setNote(p)}>{p.slice(0, 38)}...</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function SubmissionCard({ sub, onChanged }) {
  const { toast, refreshCounts } = useApp();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const p = sub.plant;

  const approve = async () => {
    setBusy(true);
    try {
      await api.approve(p.id);
      await refreshCounts();
      toast(p.plant_code + ' published. QR tag issued.');
      onChanged();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head" style={{ gap: 10 }}>
        <Avatar name={sub.submitted_by_name} role="ranger" size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small">
            <strong>{sub.submitted_by_name}</strong> submitted <span className="mono tiny">{p.plant_code}</span>
          </div>
          <div className="tiny mute">{relativeTime(sub.submitted_at)} &middot; {formatDateTime(sub.submitted_at)}</div>
        </div>
        {p.species_not_listed && <span className="badge badge-info">Species not listed</span>}
        <StatusBadge status={p.status} />
      </div>

      <div className="card-body">
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(180px, 250px) 1fr', alignItems: 'start' }}>
          <div>
            <div style={{ aspectRatio: '4/3', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
              {p.photo
                ? <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><I.Image style={{ width: 26, height: 26, color: 'var(--text-faint)' }} /></div>}
            </div>
            {p.photo_count > 1 && <div className="tiny mute" style={{ marginTop: 6 }}>{p.photo_count} photographs</div>}
          </div>

          <div>
            <div className="row row-wrap" style={{ gap: 8, marginBottom: 6 }}>
              {p.conservation_code && <ConservationBadge code={p.conservation_code} />}
            </div>
            <div className={p.scientific_name ? 'sci' : ''} style={{ fontSize: '1.12rem', fontWeight: 620 }}>
              {p.scientific_name || p.proposed_species_name}
            </div>
            {p.common_name && <div className="small mute">{p.common_name}</div>}

            <dl className="dl small" style={{ marginTop: 12 }}>
              <dt>Location</dt><dd>{p.site_name}</dd>
              {coords(p.latitude, p.longitude) && <><dt>Coordinates</dt><dd className="mono tiny">{coords(p.latitude, p.longitude)} {p.gps_accuracy_m && <span className="mute">&plusmn;{p.gps_accuracy_m} m</span>}</dd></>}
              {p.height_m && <><dt>Height</dt><dd>{p.height_m} m</dd></>}
              {p.trunk_diameter_cm && <><dt>Trunk diameter</dt><dd>{p.trunk_diameter_cm} cm</dd></>}
              {p.life_stage && <><dt>Life stage</dt><dd style={{ textTransform: 'capitalize' }}>{p.life_stage}</dd></>}
              {p.health_status && <><dt>Condition</dt><dd style={{ textTransform: 'capitalize' }}>{p.health_status}</dd></>}
            </dl>

            {p.morphology_notes && (
              <div className="inset small" style={{ marginTop: 12 }}>
                <div className="label" style={{ marginBottom: 3 }}>Ranger notes</div>
                {p.morphology_notes}
              </div>
            )}

            {p.species_not_listed && (
              <div style={{ marginTop: 12 }}>
                <Notice kind="warn" title="Needs a species before it can be published">
                  The API refuses to approve a record with no species, so the Approve button stays disabled
                  until you confirm one.
                </Notice>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card-foot row row-wrap" style={{ gap: 9 }}>
        <Link className="btn btn-sm" to={'/staff/plants/' + p.id}><I.Eye /> Open full record</Link>
        <span className="spacer" />
        {p.species_not_listed && <AssignSpecies plant={p} onDone={onChanged} />}
        <button className="btn btn-sm btn-danger" onClick={() => setRejecting(true)} disabled={busy}>
          <I.X /> Return with a note
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={approve}
          disabled={busy || p.species_not_listed}
          title={p.species_not_listed ? 'Confirm the species first' : 'Publish this record and issue its QR tag'}
        >
          {busy ? <span className="spinner" /> : <I.Check />} Approve and publish
        </button>
      </div>

      {rejecting && <RejectDialog plant={p} onClose={() => setRejecting(false)} onDone={onChanged} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ReviewQueue() {
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.submissions({ status: tab })
      .then((r) => { setData(r); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1060 }}>
        <PageHead
          title="Review queue"
          sub="Nothing reaches the public site until a botanist confirms it. Approving issues the QR tag; returning keeps the record and tells the ranger what to change."
        />

        <div className="tabs" style={{ marginBottom: 18 }}>
          {[['pending', 'Awaiting review'], ['approved', 'Approved'], ['rejected', 'Returned'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {loading && !data && <LoadingBlock label="Loading the queue" />}

        {data && data.results.length === 0 && (
          <Empty icon={I.CheckCircle} title={tab === 'pending' ? 'The queue is clear' : 'Nothing here'}>
            {tab === 'pending'
              ? 'Every ranger submission has been reviewed. New ones appear here as they arrive, and you get a notification.'
              : 'No submissions with that status.'}
          </Empty>
        )}

        {data?.results.map((s) => <SubmissionCard key={s.id} sub={s} onChanged={load} />)}
      </div>
    </div>
  );
}
