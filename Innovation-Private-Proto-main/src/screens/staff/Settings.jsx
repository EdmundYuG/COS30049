import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/store.jsx';
import { LoadingBlock, Notice, PageHead } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';
import * as I from '../../lib/icons.jsx';

export default function SettingsScreen() {
  const { toast, setBoot } = useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = () => api.settings().then((r) => setRows(r.results)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async (key, value) => {
    setBusy(key);
    try {
      await api.updateSetting(key, value);
      await load();
      // require_approval changes what the register screens say, so refresh boot.
      try { setBoot(await api.bootstrap()); } catch { /* non-fatal */ }
      toast('Setting saved.');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); }
  };

  if (!rows) return <LoadingBlock label="Loading settings" />;

  const approval = rows.find((r) => r.setting_key === 'require_approval');
  const others = rows.filter((r) => r.setting_key !== 'require_approval');

  return (
    <div className="page">
      <div className="wrap wrap-narrow">
        <PageHead
          title="System settings"
          sub="Behaviour that the park can change without a developer. Every change is written to the audit trail."
        />

        {/* The headline switch */}
        {approval && (
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent-border)' }}>
            <div className="card-head">
              <h3 className="grow">Verification workflow</h3>
              <span className="mono tiny faint">require_approval</span>
            </div>
            <div className="card-body">
              <label className="switch" style={{ alignItems: 'flex-start', gap: 14 }}>
                <input
                  type="checkbox"
                  checked={approval.setting_value === 'true'}
                  disabled={busy === 'require_approval'}
                  onChange={(e) => save('require_approval', e.target.checked)}
                />
                <span className="switch-track" />
                <span style={{ flex: 1 }}>
                  <span className="strong" style={{ display: 'block' }}>
                    Ranger entries must be reviewed by a botanist
                  </span>
                  <span className="small mute">
                    {approval.setting_value === 'true'
                      ? 'On. A ranger’s new record goes to the review queue and stays off the public site until a botanist approves it.'
                      : 'Off. A ranger’s new record is published immediately, so the system behaves as a straightforward register.'}
                  </span>
                </span>
              </label>

              <div style={{ marginTop: 16 }}>
                <Notice kind="plain">
                  A botanist&rsquo;s own entries are always published immediately, whichever way this is set. A
                  record with no confirmed species always needs a botanist, because the API refuses to approve
                  one without a species. A small site with a single qualified botanist may prefer this off.
                </Notice>
              </div>
            </div>
            {approval.updated_by_name && (
              <div className="card-foot tiny mute">
                Last changed by {approval.updated_by_name} on {formatDateTime(approval.updated_at)}
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div className="card-head"><h3>All settings</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Setting</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {others.map((s) => {
                  const draft = drafts[s.setting_key];
                  const dirty = draft !== undefined && draft !== s.setting_value;
                  return (
                    <tr key={s.setting_key}>
                      <td style={{ maxWidth: 280 }}>
                        <div className="mono small strong">{s.setting_key}</div>
                        <div className="tiny mute">{s.description}</div>
                      </td>
                      <td style={{ minWidth: 190 }}>
                        {s.value_type === 'bool' ? (
                          <label className="switch">
                            <input
                              type="checkbox" checked={s.setting_value === 'true'}
                              disabled={busy === s.setting_key}
                              onChange={(e) => save(s.setting_key, e.target.checked)}
                            />
                            <span className="switch-track" />
                            <span className="small">{s.setting_value === 'true' ? 'On' : 'Off'}</span>
                          </label>
                        ) : (
                          <input
                            className="input"
                            type={s.value_type === 'int' ? 'number' : 'text'}
                            value={draft ?? s.setting_value ?? ''}
                            onChange={(e) => setDrafts({ ...drafts, [s.setting_key]: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save(s.setting_key, draft); }}
                          />
                        )}
                      </td>
                      <td className="num" style={{ width: 92 }}>
                        {s.value_type !== 'bool' && dirty && (
                          <button className="btn btn-sm btn-primary" disabled={busy === s.setting_key} onClick={() => save(s.setting_key, draft)}>
                            <I.Check /> Save
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-foot tiny mute">
            In the shipped design these live behind the future superuser role; the prototype gives them to the
            administrator so the workflow can be demonstrated.
          </div>
        </div>
      </div>
    </div>
  );
}
