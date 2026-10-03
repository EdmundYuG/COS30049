import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import {
  ConservationBadge, Empty, LoadingBlock, Modal, Notice, PageHead, SearchInput,
} from '../../components/ui.jsx';
import { GROWTH_FORM, titleCase } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

const BLANK = {
  scientific_name: '', common_name: '', local_name: '', family: '', genus: '', species_epithet: '',
  growth_form: 'tree', conservation_status_id: '', description: '', characteristics: '',
  leaf_description: '', flower_description: '', fruit_description: '', habitat: '', distribution: '',
};

function SpeciesDialog({ species, statuses, onClose, onDone }) {
  const { toast } = useApp();
  const [form, setForm] = useState(() => (species ? { ...BLANK, ...species } : { ...BLANK, conservation_status_id: statuses[0]?.id }));
  const [busy, setBusy] = useState(false);
  const up = (p) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    if (!form.scientific_name.trim()) { toast('A scientific name is required.', 'err'); return; }
    setBusy(true);
    try {
      if (species) await api.patch('/species/' + species.id, form);
      else await api.post('/species', form);
      toast(species ? 'Species updated.' : 'Species added to the list.');
      onDone(); onClose();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={species ? 'Edit ' + species.scientific_name : 'Add a species'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner" />}{species ? 'Save changes' : 'Add species'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' }}>
        <Notice kind="plain">
          Taxonomy lives here once, not on every specimen, so a correction made now applies to every plant of
          this species across the register.
        </Notice>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="scientific_name">Scientific name <span className="req">*</span></label>
            <input
              id="scientific_name" className="input sci" value={form.scientific_name}
              onChange={(e) => up({ scientific_name: e.target.value })} placeholder="Genus epithet"
            />
          </div>
          <div className="field">
            <label htmlFor="common_name">Common name</label>
            <input id="common_name" className="input" value={form.common_name || ''} onChange={(e) => up({ common_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="local_name">Local name</label>
            <input id="local_name" className="input" value={form.local_name || ''} onChange={(e) => up({ local_name: e.target.value })} placeholder="Malay or Iban name" />
          </div>
          <div className="field">
            <label htmlFor="family">Family</label>
            <input id="family" className="input" value={form.family || ''} onChange={(e) => up({ family: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="growth_form">Growth form</label>
            <select id="growth_form" className="select" value={form.growth_form || ''} onChange={(e) => up({ growth_form: e.target.value })}>
              {Object.entries(GROWTH_FORM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cs">Conservation status</label>
            <select
              id="cs" className="select" value={form.conservation_status_id || ''}
              onChange={(e) => up({ conservation_status_id: Number(e.target.value) })}
            >
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.code} &mdash; {s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea id="description" className="textarea" value={form.description || ''} onChange={(e) => up({ description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="characteristics">Distinguishing characteristics</label>
          <textarea id="characteristics" className="textarea" style={{ minHeight: 68 }} value={form.characteristics || ''} onChange={(e) => up({ characteristics: e.target.value })} />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          {[['leaf_description', 'Leaves'], ['flower_description', 'Flowers'], ['fruit_description', 'Fruit'], ['habitat', 'Habitat']].map(([k, l]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{l}</label>
              <textarea id={k} className="textarea" style={{ minHeight: 64 }} value={form[k] || ''} onChange={(e) => up({ [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="distribution">Distribution</label>
          <textarea id="distribution" className="textarea" style={{ minHeight: 60 }} value={form.distribution || ''} onChange={(e) => up({ distribution: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

export default function SpeciesManage() {
  const { boot } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new

  const load = () => api.species().then((r) => setRows(r.results)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((s) => [s.scientific_name, s.common_name, s.local_name, s.family, s.genus]
      .filter(Boolean).join(' ').toLowerCase().includes(n));
  }, [rows, q]);

  if (!rows) return <LoadingBlock label="Loading the species list" />;

  return (
    <div className="page">
      <div className="wrap wrap-wide">
        <PageHead
          title="Species list"
          sub="The botanical reference every specimen points at. Only botanists can add or edit species."
        >
          <button className="btn btn-primary" onClick={() => setEditing(null)}><I.Plus /> Add species</button>
        </PageHead>

        <div style={{ maxWidth: 400, marginBottom: 16 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search scientific, common or local name" />
        </div>

        {filtered.length === 0 ? (
          <Empty icon={I.Book} title="No species match" />
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr><th>Scientific name</th><th>Common / local</th><th>Family</th><th>Growth form</th><th>Conservation</th><th className="num">Specimens</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td><span className="sci strong">{s.scientific_name}</span></td>
                    <td className="small">
                      {s.common_name || '--'}
                      {s.local_name && <div className="tiny mute">{s.local_name}</div>}
                    </td>
                    <td className="small">{s.family || '--'}</td>
                    <td className="small">{s.growth_form ? (GROWTH_FORM[s.growth_form] || titleCase(s.growth_form)) : '--'}</td>
                    <td><ConservationBadge code={s.conservation_code} showLabel={false} /></td>
                    <td className="num">{s.plant_count}</td>
                    <td className="num nowrap">
                      <Link className="btn btn-sm btn-ghost" to={'/species/' + s.id}><I.Eye /></Link>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)}><I.Edit /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== undefined && (
        <SpeciesDialog
          species={editing}
          statuses={boot?.conservation_statuses || []}
          onClose={() => setEditing(undefined)}
          onDone={load}
        />
      )}
    </div>
  );
}
