import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import { Empty, LoadingBlock, Notice, PageHead, SearchInput } from '../../components/ui.jsx';
import * as I from '../../lib/icons.jsx';

/**
 * Printable QR tag sheet.
 *
 * A ranger going out to tag twenty plants does not want to print twenty pages.
 * This lays the selected tags out three across on A4, ready to print on
 * weatherproof stock and cut out.
 */
export default function TagSheet() {
  const { toast } = useApp();
  const [plants, setPlants] = useState(null);
  const [codes, setCodes] = useState({});      // plantId -> { png, target_url, ... }
  const [selected, setSelected] = useState(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState('medium');
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    api.plants({ status: 'approved' })
      .then((r) => setPlants(r.results.filter((p) => p.qr_token)))
      .catch(() => setPlants([]));
  }, []);

  const filtered = useMemo(() => {
    if (!plants) return null;
    const n = q.trim().toLowerCase();
    if (!n) return plants;
    return plants.filter((p) => [p.scientific_name, p.common_name, p.plant_code, p.site_name]
      .filter(Boolean).join(' ').toLowerCase().includes(n));
  }, [plants, q]);

  /**
   * QR images are generated per plant by the API. Fetched in small batches
   * rather than all at once: selecting every record in the register would
   * otherwise fire a hundred-odd requests simultaneously, and the sheet would
   * sit empty for ten seconds with nothing to show for it.
   */
  const ensureCodes = async (ids) => {
    const missing = ids.filter((id) => !codes[id]);
    if (!missing.length) return codes;

    setBusy(true);
    setProgress({ done: 0, total: missing.length });
    const next = { ...codes };
    const BATCH = 6;

    try {
      for (let i = 0; i < missing.length; i += BATCH) {
        const slice = missing.slice(i, i + BATCH);
        const got = await Promise.all(
          slice.map((id) => api.qr(id)
            .then((r) => [id, r])
            .catch(() => [id, null])),
        );
        got.forEach(([id, r]) => { if (r) next[id] = r; });
        // Show each batch as it lands, so the sheet fills in visibly.
        setCodes({ ...next });
        setProgress({ done: Math.min(i + BATCH, missing.length), total: missing.length });
      }
      return next;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const toggle = async (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else { next.add(id); await ensureCodes([id]); }
    setSelected(next);
  };

  const selectAll = async () => {
    const ids = (filtered || []).map((p) => p.id);
    await ensureCodes(ids);
    setSelected(new Set(ids));
  };

  const chosen = (plants || []).filter((p) => selected.has(p.id));
  const ready = chosen.filter((p) => codes[p.id]);

  const print = () => {
    if (!ready.length) { toast('Choose at least one plant first.', 'err'); return; }
    window.print();
  };

  if (!plants) return <LoadingBlock label="Loading published records" />;

  return (
    <div className="page">
      <div className="wrap wrap-wide">
        <PageHead
          title="Print QR tags"
          sub="Pick the plants you are tagging, then print. Three tags fit across an A4 page."
        >
          <div className="segmented no-print">
            {[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']].map(([v, l]) => (
              <button key={v} className={size === v ? 'active' : ''} onClick={() => setSize(v)}>{l}</button>
            ))}
          </div>
          <button className="btn btn-primary no-print" onClick={print} disabled={!ready.length || busy}>
            {busy ? <span className="spinner" /> : <I.Printer />}
            Print {ready.length || ''} tag{ready.length === 1 ? '' : 's'}
          </button>
        </PageHead>

        <div className="no-print">
          <div style={{ marginBottom: 16 }}>
            <Notice kind="plain" title="What gets printed">
              Only the tags below, laid out for cutting. Each one encodes a permanent link to that
              plant&rsquo;s public page, so editing the record later does not invalidate a printed tag.
            </Notice>
          </div>

          <div className="row row-wrap" style={{ gap: 10, marginBottom: 16 }}>
            <div className="grow" style={{ maxWidth: 380, minWidth: 210 }}>
              <SearchInput value={q} onChange={setQ} placeholder="Filter by name, Plant ID or location" />
            </div>
            <button className="btn btn-sm" onClick={selectAll} disabled={busy}>
              <I.Check /> Select all {filtered?.length ? `(${filtered.length})` : ''}
            </button>
            <button className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>
              <I.X /> Clear
            </button>
            <span className="spacer" />
            {progress
              ? (
                <span className="small mute row" style={{ gap: 7 }}>
                  <span className="spinner" />
                  Preparing {progress.done} of {progress.total} tags
                </span>
              )
              : <span className="small mute">{selected.size} selected</span>}
          </div>

          {filtered.length === 0 ? (
            <Empty icon={I.QrIcon} title="No published records match">
              Only approved records have a QR tag. Approve something in the review queue first.
            </Empty>
          ) : (
            <div className="card table-wrap" style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 24 }}>
              <table className="table">
                <thead>
                  <tr><th style={{ width: 44 }}></th><th>Species</th><th>Plant ID</th><th>Location</th></tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={'Include ' + p.plant_code}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                      </td>
                      <td>
                        <div className="sci strong">{p.scientific_name}</div>
                        <div className="tiny mute">{p.common_name || '—'}</div>
                      </td>
                      <td className="mono tiny">{p.plant_code}</td>
                      <td className="small mute"><span className="truncate" style={{ maxWidth: 240, display: 'block' }}>{p.site_name}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>
            Preview {ready.length > 0 && <span className="mute" style={{ fontWeight: 400 }}>({ready.length} tag{ready.length === 1 ? '' : 's'})</span>}
          </h2>
          {ready.length === 0 && (
            <Empty icon={I.Printer} title="Nothing selected yet">
              Tick the plants you are going out to tag and they will appear here.
            </Empty>
          )}
        </div>

        {/* The printable region. Everything else is hidden by the print styles. */}
        {ready.length > 0 && (
          <div className="print-region">
            <div className={'qr-sheet qr-sheet-' + size}>
              {ready.map((p) => {
                const qr = codes[p.id];
                return (
                  <div className="qr-tag" key={p.id}>
                    <img src={qr.png} alt={'QR code for ' + p.plant_code} />
                    <div className="t-sci">{p.scientific_name}</div>
                    {p.common_name && <div className="t-com">{p.common_name}</div>}
                    {p.local_name && <div className="t-com" style={{ opacity: 0.75 }}>{p.local_name}</div>}
                    <div className="t-code">{p.plant_code}</div>
                    <div className="t-foot">Scan for details &middot; Niah National Park</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="no-print tiny faint" style={{ marginTop: 20 }}>
          Print on weatherproof synthetic paper or laminate after cutting. Check one tag with a phone before
          printing the whole batch. <Link to="/staff/plants">Back to the register</Link>.
        </div>
      </div>
    </div>
  );
}
