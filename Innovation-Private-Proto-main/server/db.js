/**
 * In-memory store shaped like plant_registry_schema.sql.
 * Table names, columns, enum values and permission codes deliberately match
 * the SQL file so the same API can be pointed at MySQL later with no
 * change to the client.
 *
 * Nothing is persisted: restarting the server resets the demo.
 */

export const db = {
  roles: [],
  permissions: [],
  role_permissions: [],
  users: [],
  password_resets: [],
  refresh_tokens: [],
  user_activity_logs: [],
  conservation_statuses: [],
  species: [],
  plants: [],
  plant_photos: [],
  plant_submissions: [],
  plant_revisions: [],
  plant_reports: [],
  qr_codes: [],
  qr_scans: [],
  notifications: [],
  audit_logs: [],
  settings: [],
  sensor_devices: [], // IoT: hardware not received yet - dashboard shows "Coming soon"
  sensor_readings: [],
  sensor_alerts: [],
};

const counters = {};
export function nextId(table) {
  counters[table] = (counters[table] || 0) + 1;
  return counters[table];
}

export const nowIso = () => new Date().toISOString();

export function insert(table, row) {
  const rec = { id: nextId(table), created_at: nowIso(), ...row };
  db[table].push(rec);
  return rec;
}

export const find = (table, pred) => db[table].find(pred);
export const where = (table, pred) => db[table].filter(pred);
export const byId = (table, id) => db[table].find((r) => r.id === Number(id));

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function getSetting(key) {
  const row = db.settings.find((s) => s.setting_key === key);
  if (!row) return null;
  if (row.value_type === 'bool') return row.setting_value === 'true';
  if (row.value_type === 'int') return Number(row.setting_value);
  if (row.value_type === 'json') {
    try { return JSON.parse(row.setting_value); } catch { return null; }
  }
  return row.setting_value;
}

export function setSetting(key, value, userId) {
  const row = db.settings.find((s) => s.setting_key === key);
  if (!row) return null;
  row.setting_value = String(value);
  row.updated_by = userId ?? null;
  row.updated_at = nowIso();
  return row;
}

/* ------------------------------------------------------------------ */
/* Permissions - the API checks codes, never role names (see schema ss.8) */
/* ------------------------------------------------------------------ */

export function permissionsForRole(roleId) {
  const ids = db.role_permissions.filter((rp) => rp.role_id === roleId).map((rp) => rp.permission_id);
  return db.permissions.filter((p) => ids.includes(p.id)).map((p) => p.code);
}

export function userCan(user, code) {
  if (!user) return false;
  return permissionsForRole(user.role_id).includes(code);
}

/* ------------------------------------------------------------------ */
/* Audit + activity + notifications                                    */
/* ------------------------------------------------------------------ */

export function audit({ user_id, action, entity_type, entity_id, old_values = null, new_values = null }) {
  return insert('audit_logs', {
    user_id: user_id ?? null,
    action,
    entity_type,
    entity_id: entity_id ?? null,
    old_values,
    new_values,
    ip_address: '127.0.0.1',
    user_agent: 'Prototype X demo',
  });
}

export function activity({ user_id, action, detail = null }) {
  return insert('user_activity_logs', {
    user_id: user_id ?? null,
    action,
    detail,
    ip_address: '127.0.0.1',
    user_agent: 'Prototype X demo',
  });
}

export function notify({ user_id, type, title, body = null, related_type = null, related_id = null }) {
  return insert('notifications', {
    user_id, type, title, body, related_type, related_id,
    is_read: 0, read_at: null,
  });
}

/** Notify every active user holding a permission - e.g. all botanists. */
export function notifyPermission(code, payload) {
  for (const u of db.users) {
    if (!u.is_active || u.deleted_at) continue;
    if (permissionsForRole(u.role_id).includes(code)) notify({ ...payload, user_id: u.id });
  }
}

/** Field-level history, shown on a plant's history tab. */
export function recordRevisions(plantId, userId, before, after, reason = null) {
  const skip = new Set(['id', 'created_at', 'updated_at', 'view_count']);
  const out = [];
  for (const key of Object.keys(after)) {
    if (skip.has(key)) continue;
    const a = before?.[key] ?? null;
    const b = after[key] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    out.push(insert('plant_revisions', {
      plant_id: plantId,
      changed_by: userId ?? null,
      source_table: 'plants',
      field_name: key,
      old_value: a === null ? null : String(a),
      new_value: b === null ? null : String(b),
      change_reason: reason,
    }));
  }
  return out;
}
