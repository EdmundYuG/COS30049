import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CONSERVATION, STATUS, initials, relativeTime, titleCase } from '../lib/format.js';
import { useApp } from '../lib/store.jsx';
import { SmartImage } from './motion.jsx';
import * as I from '../lib/icons.jsx';

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: titleCase(status), cls: 'badge-neutral' };
  return <span className={'badge ' + s.cls}><span className="dot" />{s.label}</span>;
}

export function ConservationBadge({ code, label, showLabel = true }) {
  if (!code) return null;
  const meta = CONSERVATION[code] || { label: label || code, threat: false };
  return (
    <span className={'cs' + (meta.threat ? ' cs-threat' : '')} title={meta.label}>
      <span className="cs-swatch" style={{ background: `var(--cs-${code})` }}>{code}</span>
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}

export function Avatar({ name, role, size = '' }) {
  const cls = ['avatar', size && 'avatar-' + size, role && 'avatar-' + role].filter(Boolean).join(' ');
  return <span className={cls} aria-hidden="true">{initials(name)}</span>;
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export function PageHead({ title, sub, children, back }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link to={back.to} className="btn btn-ghost btn-sm" style={{ marginLeft: -10, marginBottom: 6 }}>
            <I.ArrowLeft /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div className="row row-wrap">{children}</div>}
    </div>
  );
}

export function Empty({ icon: Icon = I.Leaf, title, children, action }) {
  return (
    <div className="empty">
      <Icon />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', icon: Icon, title, children }) {
  const Ico = Icon || (kind === 'warn' ? I.Alert : kind === 'danger' ? I.Alert : kind === 'ok' ? I.CheckCircle : I.Info);
  const cls = { info: '', warn: ' notice-warn', danger: ' notice-danger', ok: ' notice-ok', plain: ' notice-plain' }[kind] || '';
  return (
    <div className={'notice' + cls}>
      <Ico />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, detail, accent }) {
  return (
    <div className={'stat' + (accent ? ' stat-accent' : '')}>
      <div className="l">{label}</div>
      <div className="n">{value}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r, style }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div className="empty">
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <span className="spinner" /> <span className="mute">{label}...</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog so keyboard and screen-reader users land here.
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><I.X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn', icon: Icon, title, body }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>{Icon && <Icon />}{label}</button>
      {open && (
        <Modal
          title={title || label}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await onConfirm(); setOpen(false); } finally { setBusy(false); }
                }}
              >
                {busy && <span className="spinner" />}{confirmLabel || 'Confirm'}
              </button>
            </>
          }
        >
          {body}
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind} onClick={() => dismissToast(t.id)}>
          {t.kind === 'err' ? <I.Alert /> : <I.CheckCircle />}
          <span className="grow">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plant card                                                          */
/* ------------------------------------------------------------------ */

export function PlantCard({ plant, to, showStatus, eager = false }) {
  const name = plant.scientific_name || plant.proposed_species_name || 'Unidentified specimen';
  return (
    <Link className="plant-card" to={to || `/plant/${plant.id}`}>
      <div className="plant-photo">
        {plant.photo
          ? <SmartImage src={plant.photo} fallback={plant.photo_remote} tint={plant.photo_tint} alt="" eager={eager} />
          : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}><I.Leaf style={{ width: 34, height: 34, color: 'var(--text-faint)' }} /></div>}
        <div className="overlay-tl">
          {showStatus && <StatusBadge status={plant.status} />}
          {plant.species_not_listed && <span className="badge badge-info">Species not listed</span>}
        </div>
        {plant.conservation_code && (
          <div className="overlay-tr"><ConservationBadge code={plant.conservation_code} showLabel={false} /></div>
        )}
        <div className="overlay-b">
          <I.MapPin style={{ width: 13, height: 13 }} />
          <span className="truncate">{plant.site_name}</span>
        </div>
      </div>
      <div className="plant-card-body">
        <div className="plant-card-name" style={plant.scientific_name ? undefined : { fontStyle: 'normal', fontFamily: 'var(--font)', fontSize: '0.94rem' }}>
          {name}
        </div>
        {plant.common_name && <div className="plant-card-common">{plant.common_name}</div>}
        <div className="plant-card-foot">
          <span className="mono tiny faint">{plant.plant_code}</span>
          <span className="spacer" />
          {plant.status === 'approved' && plant.view_count > 0 && (
            <span className="tiny faint row" style={{ gap: 4 }}><I.Eye style={{ width: 12, height: 12 }} />{plant.view_count}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function PlantRow({ plant, onClick, children }) {
  const name = plant.scientific_name || plant.proposed_species_name || 'Unidentified';
  return (
    <tr onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <td style={{ width: 54 }}>
        <div style={{ width: 42, height: 42, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-3)' }}>
          {plant.photo && <img src={plant.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />}
        </div>
      </td>
      <td>
        <div className={plant.scientific_name ? 'sci strong' : 'strong'}>{name}</div>
        <div className="tiny mute">{plant.common_name || (plant.species_not_listed ? 'Awaiting identification' : '—')}</div>
      </td>
      <td className="mono tiny nowrap">{plant.plant_code}</td>
      <td className="small"><span className="truncate" style={{ maxWidth: 210, display: 'block' }}>{plant.site_name}</span></td>
      <td>{plant.conservation_code ? <ConservationBadge code={plant.conservation_code} showLabel={false} /> : <span className="faint">--</span>}</td>
      <td><StatusBadge status={plant.status} /></td>
      <td className="tiny mute nowrap">{relativeTime(plant.registered_at)}</td>
      {children}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Filter chips                                                        */
/* ------------------------------------------------------------------ */

export function ChipRow({ options, value, onChange, allLabel = 'All' }) {
  return (
    <div className="row row-wrap" style={{ gap: 7 }}>
      <button className="chip" aria-pressed={!value} onClick={() => onChange('')}>{allLabel}</button>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button key={val} className="chip" aria-pressed={value === val} onClick={() => onChange(value === val ? '' : val)}>
            {label}
            {typeof o !== 'string' && o.count !== undefined && <span className="tiny" style={{ opacity: 0.7 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', large, autoFocus }) {
  return (
    <div className={'search' + (large ? ' search-lg' : '')}>
      <I.Search />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        type="search"
      />
      {value && (
        <button className="btn btn-ghost btn-icon" onClick={() => onChange('')} aria-label="Clear search"><I.X /></button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy-to-clipboard                                                   */
/* ------------------------------------------------------------------ */

export function CopyButton({ text, label = 'Copy', className = 'btn btn-sm' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard API needs a secure context; fall back to a selectable prompt.
          window.prompt('Copy this:', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <I.Check /> : <I.Copy />}{done ? 'Copied' : label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Coming soon                                                         */
/* ------------------------------------------------------------------ */

export function ComingSoon({ icon: Icon = I.Sensor, title, children, note }) {
  return (
    <div className="soon">
      <Icon />
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <div className="mute" style={{ maxWidth: '58ch', marginInline: 'auto', fontSize: '0.92rem' }}>{children}</div>
      {note && <div style={{ marginTop: 18 }}><span className="badge badge-warn"><span className="dot" />{note}</span></div>}
    </div>
  );
}
