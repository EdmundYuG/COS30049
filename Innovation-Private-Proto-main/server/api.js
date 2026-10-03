import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import {
  db, insert, byId, nowIso, getSetting, setSetting, permissionsForRole, userCan,
  audit, activity, notify, notifyPermission, recordRevisions,
} from './db.js';
import path from 'node:path';
import { renderPhoto } from './images.js';
import { photoExists, PHOTO_DIR, SPECIES_DATA, hasRealPhotos } from './species-data.js';
import { lanAddresses } from './net.js';

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

const sessions = new Map(); // token -> user_id

function issueToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);
  insert('refresh_tokens', {
    user_id: userId,
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    device_info: 'Prototype browser session',
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    revoked_at: null,
  });
  return token;
}

function currentUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const id = sessions.get(token);
  if (!id) return null;
  const user = byId('users', id);
  if (!user || !user.is_active || user.deleted_at) return null;
  return user;
}

function shapeUser(u) {
  if (!u) return null;
  const role = db.roles.find((r) => r.id === u.role_id);
  return {
    id: u.id, full_name: u.full_name, email: u.email, title: u.title,
    phone: u.phone, role: role?.name, role_label: role?.label, role_id: u.role_id,
    is_active: !!u.is_active, must_change_password: !!u.must_change_password,
    last_login_at: u.last_login_at, created_at: u.created_at,
    permissions: permissionsForRole(u.role_id),
  };
}

/* ------------------------------------------------------------------ */
/* Shaping helpers - the API always returns joined, client-ready rows   */
/* ------------------------------------------------------------------ */

const statusById = (id) => db.conservation_statuses.find((c) => c.id === id) || null;

function shapeSpecies(s) {
  if (!s) return null;
  const cs = statusById(s.conservation_status_id);
  return {
    ...s,
    conservation_code: cs?.code ?? 'NE',
    conservation_label: cs?.label ?? 'Not evaluated',
    conservation_source: s.conservation_source ?? null,
    plant_count: db.plants.filter((p) => p.species_id === s.id && !p.deleted_at).length,
  };
}

function photosFor(plantId) {
  return db.plant_photos
    .filter((ph) => ph.plant_id === plantId && !ph.deleted_at)
    .sort((a, b) => b.is_primary - a.is_primary);
}

function activeQr(plantId) {
  return db.qr_codes.find((q) => q.plant_id === plantId && q.status === 'active')
    || db.qr_codes.find((q) => q.plant_id === plantId) || null;
}

/* ------------------------------------------------------------------ */
/* Location protection for threatened species                          */
/* ------------------------------------------------------------------ */

/**
 * Publishing a precise coordinate for a critically endangered plant tells
 * collectors exactly where to go. The schema anticipated this; here it is
 * enforced in the API so it cannot be bypassed by calling the endpoint
 * directly, and the `protect_locations` setting decides how far up the Red
 * List the rule reaches.
 *
 * Park staff still see the real location - they have to be able to find it.
 */
const THREAT_ORDER = ['NE', 'DD', 'LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'EX'];

function protectedCodes() {
  const from = getSetting('protect_locations') || 'off';
  if (from === 'off') return new Set();
  const start = THREAT_ORDER.indexOf(from);
  if (start < 0) return new Set();
  // Everything at or above the chosen category, excluding the two extinct
  // categories, where there is no living plant left to protect.
  return new Set(THREAT_ORDER.slice(start).filter((c) => c !== 'EW' && c !== 'EX'));
}

export function isLocationProtected(conservationCode) {
  return !!conservationCode && protectedCodes().has(conservationCode);
}

/** Strips every locating field from an already-shaped plant. */
function withheldLocation(shaped) {
  return {
    ...shaped,
    location_protected: true,
    latitude: null,
    longitude: null,
    altitude_m: null,
    gps_accuracy_m: null,
    location_notes: null,
    site_name: 'Location withheld',
    location_withheld_reason:
      'The exact location of this species is not published, to protect it from collection.',
  };
}

function shapePlant(p, { full = false, viewer = null } = {}) {
  if (!p) return null;
  const sp = p.species_id ? db.species.find((s) => s.id === p.species_id) : null;
  const cs = sp ? statusById(sp.conservation_status_id) : null;
  const qr = activeQr(p.id);
  const registrar = byId('users', p.registered_by);
  const verifier = byId('users', p.verified_by);
  const photos = photosFor(p.id);
  const sub = db.plant_submissions
    .filter((s) => s.plant_id === p.id)
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null;

  const base = {
    id: p.id,
    plant_code: p.plant_code,
    status: p.status,
    species_id: p.species_id,
    proposed_species_name: p.proposed_species_name,
    species_not_listed: !p.species_id,
    scientific_name: sp?.scientific_name ?? null,
    common_name: sp?.common_name ?? null,
    local_name: sp?.local_name ?? null,
    family: sp?.family ?? null,
    genus: sp?.genus ?? null,
    growth_form: sp?.growth_form ?? null,
    conservation_code: cs?.code ?? null,
    conservation_label: cs?.label ?? null,
    latitude: p.latitude, longitude: p.longitude,
    altitude_m: p.altitude_m, gps_accuracy_m: p.gps_accuracy_m,
    site_name: p.site_name, location_notes: p.location_notes,
    height_m: p.height_m, trunk_diameter_cm: p.trunk_diameter_cm,
    health_status: p.health_status, life_stage: p.life_stage,
    morphology_notes: p.morphology_notes, notes: p.notes,
    view_count: p.view_count,
    registered_at: p.registered_at, verified_at: p.verified_at,
    registered_by: p.registered_by,
    registered_by_name: registrar?.full_name ?? null,
    verified_by_name: verifier?.full_name ?? null,
    qr_token: qr?.qr_token ?? null,
    photo: photos[0]?.file_path ?? null,
    photo_remote: photos[0]?.remote_url ?? null,
    photo_credit: photos[0]?.credit ?? null,
    photo_tint: photos[0]?.tint ?? null,
    photo_count: photos.length,
    review_comment: sub?.status === 'rejected' ? sub.review_comment : null,
    submission_id: sub?.id ?? null,
  };

  // Anyone not signed in as staff gets the protected view.
  const staff = !!viewer;
  const protect = !staff && isLocationProtected(base.conservation_code);

  if (!full) return protect ? withheldLocation(base) : base;

  const detail = {
    ...base,
    species: shapeSpecies(sp),
    photos,
    submission: sub,
    scan_count: db.qr_scans.filter((s) => s.plant_id === p.id).length,
    reports: db.plant_reports.filter((r) => r.plant_id === p.id).length,
  };

  return protect ? withheldLocation(detail) : detail;
}

/** Mirrors v_public_plants: approved, not deleted, species resolved. */
function publicPlants() {
  return db.plants.filter((p) => p.status === 'approved' && !p.deleted_at && p.species_id);
}

/* ------------------------------------------------------------------ */
/* Where a printed tag should point                                    */
/* ------------------------------------------------------------------ */

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;

/**
 * The address a QR tag encodes.
 *
 * A tag is printed once and then screwed to a post for years, so it must not
 * carry an address that only works on the machine that generated it. A
 * botanist printing tags from a laptop is browsing `localhost`, and a tag
 * encoding `localhost` sends every phone that scans it to its own device.
 *
 * Order of preference:
 *   1. `public_base_url`, which the park sets to its real domain before
 *      printing anything for real
 *   2. the LAN address, reachable from a phone on the same Wi-Fi, which is
 *      what makes the prototype demonstrable
 *   3. whatever the request came in on, as a last resort
 */
export function publicOrigin(req) {
  const configured = String(getSetting('public_base_url') || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const scheme = req.app.get('protoScheme') || req.protocol || 'https';
  const port = req.app.get('protoPort');
  const lan = lanAddresses()[0]?.address;
  if (lan) return `${scheme}://${lan}${port ? ':' + port : ''}`;

  const host = (req.get('host') || '').replace(/:\d+$/, '');
  if (!LOOPBACK.test(host)) return `${scheme}://${req.get('host')}`;

  // Nothing better available; the tag will only work on this machine.
  return `${scheme}://${req.get('host')}`;
}

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the CHECK constraints in plant_registry_schema.sql, so the API
 * refuses the same values MySQL would refuse. Returns an error string, or
 * null when the payload is acceptable.
 */
const LIMITS = {
  latitude: [-90, 90],
  longitude: [-180, 180],
  altitude_m: [-500, 9000],
  gps_accuracy_m: [0, 10000],
  height_m: [0, 150],
  trunk_diameter_cm: [0, 1200],
};

const TEXT_LIMITS = {
  site_name: 150,
  proposed_species_name: 180,
  location_notes: 2000,
  morphology_notes: 2000,
  notes: 2000,
};

const ENUMS = {
  health_status: ['healthy', 'fair', 'poor', 'dead'],
  life_stage: ['seedling', 'sapling', 'mature'],
};

function validatePlant(body) {
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    const v = body[field];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) return `${field} must be a number.`;
    if (n < min || n > max) return `${field} must be between ${min} and ${max}.`;
  }
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const v = body[field];
    if (typeof v === 'string' && v.length > max) {
      return `${field} is too long (${v.length} characters, maximum ${max}).`;
    }
  }
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const v = body[field];
    if (v === undefined || v === null || v === '') continue;
    if (!allowed.includes(v)) return `${field} must be one of: ${allowed.join(', ')}.`;
  }
  // Latitude and longitude only mean something together.
  const hasLat = body.latitude !== undefined && body.latitude !== null && body.latitude !== '';
  const hasLon = body.longitude !== undefined && body.longitude !== null && body.longitude !== '';
  if (hasLat !== hasLon) return 'Give both latitude and longitude, or neither.';
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * The five search fields from the proposal: common name, scientific name,
 * Plant ID, family or genus, and location.
 */
function matchesQuery(p, q, { viewer = null } = {}) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  const sp = p.species_id ? db.species.find((s) => s.id === p.species_id) : null;
  const cs = sp ? statusById(sp.conservation_status_id) : null;

  // Searching a trail name must not surface a plant whose location is
  // withheld, or the protection leaks straight back out through the search box.
  const hideLocation = !viewer && isLocationProtected(cs?.code);

  const hay = [
    p.plant_code, p.proposed_species_name,
    hideLocation ? null : p.site_name,
    hideLocation ? null : p.location_notes,
    sp?.scientific_name, sp?.common_name, sp?.local_name, sp?.family, sp?.genus,
  ].filter(Boolean).join(' ').toLowerCase();
  return needle.split(/\s+/).every((t) => hay.includes(t));
}

/* ------------------------------------------------------------------ */

export function createApi() {
  const api = express.Router();
  api.use(express.json({ limit: '12mb' }));

  /* -------- auth context on every request -------- */
  api.use((req, res, next) => {
    req.user = currentUser(req);
    req.can = (code) => userCan(req.user, code);
    next();
  });

  const need = (code) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    if (!req.can(code)) {
      return res.status(403).json({ error: 'Your role does not have permission: ' + code });
    }
    next();
  };

  /* ================================================================ */
  /* Bootstrap                                                        */
  /* ================================================================ */

  api.get('/bootstrap', (req, res) => {
    res.json({
      site_name: getSetting('site_name'),
      park_name: getSetting('park_name'),
      require_approval: getSetting('require_approval'),
      conservation_statuses: db.conservation_statuses,
      roles: db.roles.map((r) => ({ ...r, permissions: permissionsForRole(r.id) })),
      // Prototype convenience: the role switcher needs the demo roster.
      demo_accounts: db.users.map((u) => ({
        id: u.id, full_name: u.full_name, email: u.email, title: u.title,
        role: db.roles.find((r) => r.id === u.role_id)?.name,
        role_label: db.roles.find((r) => r.id === u.role_id)?.label,
        is_active: !!u.is_active,
      })),
      demo_password: 'demo1234',
      families: [...new Set(db.species.map((s) => s.family).filter(Boolean))].sort(),
      genera: [...new Set(db.species.map((s) => s.genus).filter(Boolean))].sort(),
      sites: [...new Set(db.plants.map((p) => p.site_name).filter(Boolean))].sort(),
      growth_forms: [...new Set(db.species.map((s) => s.growth_form).filter(Boolean))].sort(),
      data: {
        source: SPECIES_DATA.source,
        generated_at: SPECIES_DATA.generated_at,
        sources: SPECIES_DATA.sources,
        real_photos: hasRealPhotos,
      },
    });
  });

  api.get('/auth/me', (req, res) => res.json({ user: shapeUser(req.user) }));

  api.post('/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.users.find((u) => u.email.toLowerCase() === String(email || '').toLowerCase().trim());
    if (!user) {
      activity({ user_id: null, action: 'login_failed', detail: 'Unknown email: ' + email });
      return res.status(401).json({ error: 'No account with that email address.' });
    }
    if (password !== 'demo1234') {
      activity({ user_id: user.id, action: 'login_failed', detail: 'Wrong password' });
      return res.status(401).json({ error: 'Incorrect password. The demo password is demo1234.' });
    }
    if (!user.is_active) {
      activity({ user_id: user.id, action: 'login_failed', detail: 'Account deactivated' });
      return res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
    }
    user.last_login_at = nowIso();
    activity({ user_id: user.id, action: 'login', detail: 'Signed in' });
    res.json({ token: issueToken(user.id), user: shapeUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token && sessions.has(token)) {
      if (req.user) activity({ user_id: req.user.id, action: 'logout', detail: 'Signed out' });
      sessions.delete(token);
    }
    res.json({ ok: true });
  });

  /**
   * Prototype-only: jump straight into any demo account.
   * This is what the floating role switcher calls. It exists so the team and
   * the client can compare roles quickly; it is NOT part of the real design
   * and must not ship to production.
   */
  api.post('/auth/switch', (req, res) => {
    const user = byId('users', req.body?.user_id);
    if (!user) return res.status(404).json({ error: 'No such demo account' });
    if (!user.is_active) return res.status(403).json({ error: 'That account is deactivated - reactivate it from the Admin dashboard first.' });
    user.last_login_at = nowIso();
    activity({ user_id: user.id, action: 'login', detail: 'Switched role (prototype switcher)' });
    res.json({ token: issueToken(user.id), user: shapeUser(user) });
  });

  /* ================================================================ */
  /* Public register                                                  */
  /* ================================================================ */

  api.get('/public/plants', (req, res) => {
    const {
      q = '', family = '', genus = '', conservation = '', site = '', growth_form = '',
      sort = 'recent', limit = '24', offset = '0',
    } = req.query;
    let rows = publicPlants().filter((p) => matchesQuery(p, q, { viewer: req.user }));

    if (family || genus || conservation || growth_form) {
      rows = rows.filter((p) => {
        const sp = db.species.find((s) => s.id === p.species_id);
        const cs = statusById(sp?.conservation_status_id);
        if (family && sp?.family !== family) return false;
        if (genus && sp?.genus !== genus) return false;
        if (growth_form && sp?.growth_form !== growth_form) return false;
        if (conservation && cs?.code !== conservation) return false;
        return true;
      });
    }
    if (site) {
      rows = rows.filter((p) => {
        if (p.site_name !== site) return false;
        if (req.user) return true;
        const sp = db.species.find((s) => s.id === p.species_id);
        return !isLocationProtected(statusById(sp?.conservation_status_id)?.code);
      });
    }

    const shaped = rows.map((p) => shapePlant(p, { viewer: req.user }));
    const sorters = {
      recent: (a, b) => new Date(b.registered_at) - new Date(a.registered_at),
      name: (a, b) => (a.scientific_name || '').localeCompare(b.scientific_name || ''),
      code: (a, b) => a.plant_code.localeCompare(b.plant_code),
      popular: (a, b) => b.view_count - a.view_count,
    };
    shaped.sort(sorters[sort] || sorters.recent);

    // Paged: the register is big enough now that returning every record would
    // mean a phone downloading a hundred-odd photographs to show the first screen.
    const take = Math.min(100, Math.max(1, Number(limit) || 24));
    const skip = Math.max(0, Number(offset) || 0);
    const page = shaped.slice(skip, skip + take);

    res.json({
      total: shaped.length,
      offset: skip,
      limit: take,
      has_more: skip + page.length < shaped.length,
      results: page,
    });
  });

  /** The QR target. Opaque token in, public record out. */
  api.get('/public/plants/token/:token', (req, res) => {
    const qr = db.qr_codes.find((q) => q.qr_token === req.params.token);
    if (!qr) return res.status(404).json({ error: 'Unknown tag', reason: 'not_found' });
    const plant = byId('plants', qr.plant_id);
    if (!plant || plant.deleted_at) return res.status(404).json({ error: 'Unknown tag', reason: 'not_found' });

    if (plant.status !== 'approved') {
      return res.status(404).json({
        error: 'This plant is no longer on display.',
        reason: plant.status === 'archived' ? 'archived' : 'not_published',
        plant_code: plant.plant_code,
      });
    }

    plant.view_count += 1;
    insert('qr_scans', {
      qr_code_id: qr.id, plant_id: plant.id,
      user_id: req.user?.id ?? null,
      device_type: /android/i.test(req.get('user-agent') || '') ? 'android'
        : /iphone|ipad/i.test(req.get('user-agent') || '') ? 'ios' : 'web',
      ip_hash: crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex'),
      scanned_at: nowIso(),
    });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.get('/public/plants/:id', (req, res) => {
    const plant = byId('plants', req.params.id);
    if (!plant || plant.deleted_at) return res.status(404).json({ error: 'Not found' });
    const visible = plant.status === 'approved' || req.can('plant.view_all')
      || (req.user && plant.registered_by === req.user.id);
    if (!visible) return res.status(404).json({ error: 'Not found' });
    if (plant.status === 'approved') plant.view_count += 1;
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.get('/public/stats', (req, res) => {
    const pub = publicPlants();
    res.json({
      published_plants: pub.length,
      species: new Set(pub.map((p) => p.species_id)).size,
      families: new Set(pub.map((p) => db.species.find((s) => s.id === p.species_id)?.family)).size,
      threatened: pub.filter((p) => {
        const sp = db.species.find((s) => s.id === p.species_id);
        return ['VU', 'EN', 'CR', 'EW', 'EX'].includes(statusById(sp?.conservation_status_id)?.code);
      }).length,
      scans: db.qr_scans.length,
      sites: new Set(pub.map((p) => p.site_name)).size,
    });
  });

  /* ================================================================ */
  /* Species                                                          */
  /* ================================================================ */

  api.get('/species', (req, res) => {
    const q = String(req.query.q || '').toLowerCase().trim();
    let rows = db.species.filter((s) => !s.deleted_at);
    if (q) {
      rows = rows.filter((s) => [s.scientific_name, s.common_name, s.local_name, s.family, s.genus]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    rows.sort((a, b) => a.scientific_name.localeCompare(b.scientific_name));
    res.json({ results: rows.map(shapeSpecies) });
  });

  api.get('/species/:id', (req, res) => {
    const s = byId('species', req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({
      species: shapeSpecies(s),
      plants: db.plants
        .filter((p) => p.species_id === s.id && !p.deleted_at)
        .filter((p) => p.status === 'approved' || req.can('plant.view_all'))
        .map((p) => shapePlant(p, { viewer: req.user })),
    });
  });

  api.post('/species', need('species.manage'), (req, res) => {
    const body = req.body || {};
    if (!body.scientific_name?.trim()) return res.status(400).json({ error: 'Scientific name is required.' });
    const dupe = db.species.find((s) => s.scientific_name.toLowerCase() === body.scientific_name.trim().toLowerCase());
    if (dupe) return res.status(409).json({ error: 'That scientific name is already in the species list.' });

    const row = insert('species', {
      scientific_name: body.scientific_name.trim(),
      common_name: body.common_name || null,
      local_name: body.local_name || null,
      family: body.family || null,
      genus: body.genus || body.scientific_name.trim().split(' ')[0],
      species_epithet: body.species_epithet || body.scientific_name.trim().split(' ')[1] || null,
      description: body.description || null,
      characteristics: body.characteristics || null,
      growth_form: body.growth_form || null,
      leaf_description: body.leaf_description || null,
      flower_description: body.flower_description || null,
      fruit_description: body.fruit_description || null,
      habitat: body.habitat || null,
      distribution: body.distribution || null,
      conservation_status_id: body.conservation_status_id || db.conservation_statuses[0].id,
      created_by: req.user.id,
      updated_at: nowIso(), deleted_at: null,
    });
    audit({ user_id: req.user.id, action: 'create', entity_type: 'species', entity_id: row.id, new_values: { scientific_name: row.scientific_name } });
    res.status(201).json({ species: shapeSpecies(row) });
  });

  api.patch('/species/:id', need('species.manage'), (req, res) => {
    const s = byId('species', req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const before = { ...s };
    const allowed = ['scientific_name', 'common_name', 'local_name', 'family', 'genus', 'species_epithet',
      'description', 'characteristics', 'growth_form', 'leaf_description', 'flower_description',
      'fruit_description', 'habitat', 'distribution', 'conservation_status_id'];
    allowed.forEach((k) => { if (k in (req.body || {})) s[k] = req.body[k]; });
    s.updated_at = nowIso();
    audit({ user_id: req.user.id, action: 'update', entity_type: 'species', entity_id: s.id, old_values: before, new_values: { ...s } });
    res.json({ species: shapeSpecies(s) });
  });

  /* ================================================================ */
  /* Plants - staff register                                          */
  /* ================================================================ */

  api.get('/plants', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const { q = '', status = '', family = '', conservation = '', site = '', mine = '' } = req.query;

    let rows = db.plants.filter((p) => !p.deleted_at);

    // A ranger without plant.view_all sees only their own records.
    if (!req.can('plant.view_all')) rows = rows.filter((p) => p.registered_by === req.user.id);
    if (mine === '1') rows = rows.filter((p) => p.registered_by === req.user.id);
    if (status) rows = rows.filter((p) => p.status === status);
    rows = rows.filter((p) => matchesQuery(p, q, { viewer: req.user }));
    if (family || conservation) {
      rows = rows.filter((p) => {
        const sp = db.species.find((s) => s.id === p.species_id);
        if (family && sp?.family !== family) return false;
        if (conservation && statusById(sp?.conservation_status_id)?.code !== conservation) return false;
        return true;
      });
    }
    if (site) rows = rows.filter((p) => p.site_name === site);

    rows.sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
    res.json({ total: rows.length, results: rows.map((p) => shapePlant(p, { viewer: req.user })) });
  });

  api.get('/plants/counts', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const scope = req.can('plant.view_all')
      ? db.plants.filter((p) => !p.deleted_at)
      : db.plants.filter((p) => !p.deleted_at && p.registered_by === req.user.id);
    const count = (s) => scope.filter((p) => p.status === s).length;
    res.json({
      all: scope.length,
      pending: count('pending'), approved: count('approved'),
      rejected: count('rejected'), archived: count('archived'),
      mine: db.plants.filter((p) => !p.deleted_at && p.registered_by === req.user.id).length,
      queue: req.can('plant.approve') ? db.plant_submissions.filter((s) => s.status === 'pending').length : 0,
      unread_notifications: db.notifications.filter((n) => n.user_id === req.user.id && !n.is_read).length,
      open_reports: req.can('report.view') ? db.plant_reports.filter((r) => r.status === 'open').length : 0,
    });
  });

  api.post('/plants', need('plant.create'), (req, res) => {
    const b = req.body || {};
    if (b.species_id && !byId('species', b.species_id)) {
      return res.status(400).json({ error: 'No such species.' });
    }
    if (!b.species_id && !b.proposed_species_name?.trim()) {
      return res.status(400).json({ error: 'Choose a species, or type a name under "species not listed".' });
    }
    if (!b.site_name?.trim()) return res.status(400).json({ error: 'A location or site name is required.' });

    const invalid = validatePlant(b);
    if (invalid) return res.status(400).json({ error: invalid });

    const requireApproval = getSetting('require_approval');
    const canPublish = req.can('plant.approve');
    // Botanist entries publish immediately. Ranger entries follow the setting,
    // but a "species not listed" entry always needs review.
    let status = 'pending';
    if (canPublish && b.species_id) status = 'approved';
    else if (!requireApproval && b.species_id) status = 'approved';

    const seq = db.plants.length + 1;
    const plant = insert('plants', {
      plant_code: getSetting('plant_code_prefix') + '-2026-' + String(seq).padStart(4, '0'),
      species_id: b.species_id ? Number(b.species_id) : null,
      proposed_species_name: b.species_id ? null : (b.proposed_species_name?.trim() || null),
      status,
      latitude: b.latitude ?? null, longitude: b.longitude ?? null,
      altitude_m: b.altitude_m ?? null, gps_accuracy_m: b.gps_accuracy_m ?? null,
      site_name: b.site_name.trim(), location_notes: b.location_notes || null,
      height_m: b.height_m ?? null, trunk_diameter_cm: b.trunk_diameter_cm ?? null,
      health_status: b.health_status || null, life_stage: b.life_stage || null,
      morphology_notes: b.morphology_notes || null, notes: b.notes || null,
      view_count: 0,
      registered_by: req.user.id, registered_at: nowIso(),
      verified_by: status === 'approved' ? req.user.id : null,
      verified_at: status === 'approved' ? nowIso() : null,
      updated_at: nowIso(), deleted_at: null,
    });

    // Photographs. The prototype accepts data URLs from the camera / file
    // picker and stores them in memory; the real API writes files to disk and
    // keeps only the path, exactly as plant_photos.file_path implies.
    const photos = Array.isArray(b.photos) ? b.photos.slice(0, 6) : [];
    photos.forEach((p, i) => insert('plant_photos', {
      plant_id: plant.id,
      file_path: p.data_url || p.file_path,
      thumbnail_path: p.data_url || p.file_path,
      file_name: p.file_name || 'capture-' + (i + 1) + '.jpg',
      mime_type: p.mime_type || 'image/jpeg',
      size_bytes: p.size_bytes || 0,
      width_px: null, height_px: null,
      caption: p.caption || null,
      is_primary: i === 0 ? 1 : 0,
      uploaded_by: req.user.id, deleted_at: null,
    }));

    if (status === 'approved') {
      issueQr(plant, req.user.id);
    } else {
      const sub = insert('plant_submissions', {
        plant_id: plant.id, submission_type: 'new', status: 'pending',
        proposed_changes: null, submitted_by: req.user.id, submitted_at: nowIso(),
        reviewed_by: null, reviewed_at: null, review_comment: null,
      });
      notifyPermission('plant.approve', {
        type: 'submission.new',
        title: 'New submission awaiting review',
        body: req.user.full_name + ' submitted ' + plant.plant_code + ' from ' + plant.site_name + '.',
        related_type: 'submission', related_id: sub.id,
      });
    }

    audit({
      user_id: req.user.id, action: 'create', entity_type: 'plants', entity_id: plant.id,
      new_values: { plant_code: plant.plant_code, status },
    });
    res.status(201).json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.patch('/plants/:id', need('plant.edit'), (req, res) => {
    const plant = byId('plants', req.params.id);
    if (!plant || plant.deleted_at) return res.status(404).json({ error: 'Not found' });
    const invalid = validatePlant(req.body || {});
    if (invalid) return res.status(400).json({ error: invalid });

    const before = { ...plant };
    const allowed = ['species_id', 'proposed_species_name', 'site_name', 'location_notes',
      'latitude', 'longitude', 'altitude_m', 'height_m', 'trunk_diameter_cm',
      'health_status', 'life_stage', 'morphology_notes', 'notes'];
    allowed.forEach((k) => { if (k in (req.body || {})) plant[k] = req.body[k]; });
    if (plant.species_id && !byId('species', plant.species_id)) {
      return res.status(400).json({ error: 'No such species.' });
    }
    if (plant.species_id) plant.proposed_species_name = null;
    plant.updated_at = nowIso();

    recordRevisions(plant.id, req.user.id, before, plant, req.body?.change_reason || null);
    audit({
      user_id: req.user.id, action: 'update', entity_type: 'plants', entity_id: plant.id,
      old_values: before, new_values: { ...plant },
    });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  /* -------- review workflow -------- */

  function issueQr(plant, userId) {
    const existing = db.qr_codes.find((q) => q.plant_id === plant.id && q.status === 'active');
    if (existing) return existing;
    // Reactivate a tag that was withdrawn when the record was archived, so a
    // printed tag stays valid across archive -> restore.
    const old = db.qr_codes.find((q) => q.plant_id === plant.id && q.status === 'inactive');
    if (old) {
      old.status = 'active';
      old.deactivated_at = null;
      old.deactivation_reason = null;
      return old;
    }
    return insert('qr_codes', {
      plant_id: plant.id, qr_token: crypto.randomUUID(),
      image_path: null, target_url: null, version: 1, status: 'active',
      generated_by: userId ?? null, generated_at: nowIso(),
      deactivated_at: null, deactivation_reason: null,
    });
  }

  api.post('/plants/:id/approve', need('plant.approve'), (req, res) => {
    const plant = byId('plants', req.params.id);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    if (!plant.species_id) {
      return res.status(400).json({
        error: 'This record has no confirmed species. Set the species first, then approve it.',
      });
    }
    const before = { ...plant };
    plant.status = 'approved';
    plant.verified_by = req.user.id;
    plant.verified_at = nowIso();
    plant.updated_at = nowIso();

    const qr = issueQr(plant, req.user.id);
    const sub = db.plant_submissions.find((s) => s.plant_id === plant.id && s.status === 'pending');
    if (sub) {
      sub.status = 'approved';
      sub.reviewed_by = req.user.id;
      sub.reviewed_at = nowIso();
      sub.review_comment = req.body?.note || null;
      notify({
        user_id: sub.submitted_by, type: 'submission.approved',
        title: 'Submission published: ' + plant.plant_code,
        body: req.user.full_name + ' approved your record. It is now on the public site and its tag can be printed.',
        related_type: 'plant', related_id: plant.id,
      });
    }
    recordRevisions(plant.id, req.user.id, before, plant, 'Approved by botanist');
    audit({
      user_id: req.user.id, action: 'approve', entity_type: 'plants', entity_id: plant.id,
      old_values: { status: before.status }, new_values: { status: 'approved', qr_token: qr.qr_token },
    });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.post('/plants/:id/reject', need('plant.approve'), (req, res) => {
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'A note is required when rejecting, so the ranger knows what to change.' });
    const plant = byId('plants', req.params.id);
    if (!plant) return res.status(404).json({ error: 'Not found' });

    const before = { ...plant };
    plant.status = 'rejected';
    plant.updated_at = nowIso();
    const sub = db.plant_submissions.find((s) => s.plant_id === plant.id && s.status === 'pending');
    if (sub) {
      sub.status = 'rejected';
      sub.reviewed_by = req.user.id;
      sub.reviewed_at = nowIso();
      sub.review_comment = note;
      notify({
        user_id: sub.submitted_by, type: 'submission.rejected',
        title: 'Submission returned: ' + plant.plant_code,
        body: req.user.full_name + ' asked for changes. ' + note.slice(0, 120),
        related_type: 'plant', related_id: plant.id,
      });
    }
    recordRevisions(plant.id, req.user.id, before, plant, note);
    audit({
      user_id: req.user.id, action: 'reject', entity_type: 'plants', entity_id: plant.id,
      old_values: { status: before.status }, new_values: { status: 'rejected', note },
    });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.post('/plants/:id/archive', need('plant.archive'), (req, res) => {
    const plant = byId('plants', req.params.id);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    const before = { ...plant };
    plant.status = 'archived';
    plant.updated_at = nowIso();
    const qr = db.qr_codes.find((q) => q.plant_id === plant.id && q.status === 'active');
    if (qr) {
      qr.status = 'inactive';
      qr.deactivated_at = nowIso();
      qr.deactivation_reason = req.body?.reason || 'Record archived';
    }

    // Archiving something that was still awaiting review has to close the
    // submission too. Left pending it stays in the botanist queue, where
    // approving it would publish a record somebody had already withdrawn.
    const pending = db.plant_submissions.find((s) => s.plant_id === plant.id && s.status === 'pending');
    if (pending) {
      const reason = req.body?.reason || 'The record was archived before review.';
      pending.status = 'rejected';
      pending.reviewed_by = req.user.id;
      pending.reviewed_at = nowIso();
      pending.review_comment = reason;
      notify({
        user_id: pending.submitted_by, type: 'submission.rejected',
        title: 'Submission withdrawn: ' + plant.plant_code,
        body: req.user.full_name + ' archived this record before it was reviewed. ' + reason.slice(0, 120),
        related_type: 'plant', related_id: plant.id,
      });
    }

    recordRevisions(plant.id, req.user.id, before, plant, req.body?.reason || null);
    audit({ user_id: req.user.id, action: 'archive', entity_type: 'plants', entity_id: plant.id, old_values: { status: before.status }, new_values: { status: 'archived' } });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.post('/plants/:id/restore', need('plant.archive'), (req, res) => {
    const plant = byId('plants', req.params.id);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    const before = { ...plant };
    plant.status = 'approved';
    plant.updated_at = nowIso();
    issueQr(plant, req.user.id);
    recordRevisions(plant.id, req.user.id, before, plant, 'Restored to public view');
    audit({ user_id: req.user.id, action: 'update', entity_type: 'plants', entity_id: plant.id, old_values: { status: 'archived' }, new_values: { status: 'approved' } });
    res.json({ plant: shapePlant(plant, { full: true, viewer: req.user }) });
  });

  api.get('/plants/:id/history', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const plant = byId('plants', req.params.id);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    const own = plant.registered_by === req.user.id;
    if (!req.can('plant.history') && !own) return res.status(403).json({ error: 'Not permitted' });

    const revisions = db.plant_revisions
      .filter((r) => r.plant_id === plant.id)
      .map((r) => ({ ...r, changed_by_name: byId('users', r.changed_by)?.full_name || 'System' }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const audits = db.audit_logs
      .filter((a) => a.entity_type === 'plants' && a.entity_id === plant.id)
      .map((a) => ({ ...a, user_name: byId('users', a.user_id)?.full_name || 'System' }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ revisions, audits });
  });

  /* -------- submissions -------- */

  api.get('/submissions', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const status = String(req.query.status || 'pending');
    const mine = req.query.mine === '1' || !req.can('plant.approve');

    let rows = db.plant_submissions.filter((s) => (status === 'all' ? true : s.status === status));
    if (mine) rows = rows.filter((s) => s.submitted_by === req.user.id);

    rows.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    res.json({
      results: rows.map((s) => ({
        ...s,
        submitted_by_name: byId('users', s.submitted_by)?.full_name || null,
        reviewed_by_name: byId('users', s.reviewed_by)?.full_name || null,
        plant: shapePlant(byId('plants', s.plant_id), { full: true, viewer: req.user }),
      })),
    });
  });

  /* ================================================================ */
  /* QR codes                                                         */
  /* ================================================================ */

  api.get('/qr/:plantId', async (req, res) => {
    const plant = byId('plants', req.params.plantId);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    const qr = activeQr(plant.id);
    if (!qr) return res.status(404).json({ error: 'No QR code has been issued for this record yet.' });

    const target = `${publicOrigin(req)}/p/${qr.qr_token}`;
    qr.target_url = target;

    const [png, svg] = await Promise.all([
      QRCode.toDataURL(target, { margin: 1, width: 900, errorCorrectionLevel: 'M', color: { dark: '#14281d', light: '#ffffff' } }),
      QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    ]);
    res.json({
      qr_token: qr.qr_token, status: qr.status, version: qr.version,
      target_url: target, png, svg,
      plant_code: plant.plant_code,
      scientific_name: db.species.find((s) => s.id === plant.species_id)?.scientific_name || null,
      common_name: db.species.find((s) => s.id === plant.species_id)?.common_name || null,
      scans: db.qr_scans.filter((s) => s.plant_id === plant.id).length,
    });
  });

  /* ================================================================ */
  /* Notifications                                                    */
  /* ================================================================ */

  api.get('/notifications', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const rows = db.notifications
      .filter((n) => n.user_id === req.user.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ unread: rows.filter((n) => !n.is_read).length, results: rows });
  });

  api.post('/notifications/:id/read', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    const n = byId('notifications', req.params.id);
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    n.is_read = 1; n.read_at = nowIso();
    res.json({ ok: true });
  });

  api.post('/notifications/read-all', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    db.notifications.filter((n) => n.user_id === req.user.id && !n.is_read)
      .forEach((n) => { n.is_read = 1; n.read_at = nowIso(); });
    res.json({ ok: true });
  });

  /* ================================================================ */
  /* Public error reports                                             */
  /* ================================================================ */

  api.post('/reports', (req, res) => {
    const b = req.body || {};
    const plant = byId('plants', b.plant_id);
    if (!plant) return res.status(404).json({ error: 'Not found' });
    if (!b.description?.trim()) return res.status(400).json({ error: 'Please describe what looks wrong.' });
    const row = insert('plant_reports', {
      plant_id: plant.id, reported_by: req.user?.id ?? null,
      reporter_name: b.reporter_name || null, reporter_email: b.reporter_email || null,
      issue_type: b.issue_type || 'other', description: b.description.trim(),
      status: 'open', handled_by: null, handled_at: null, resolution_note: null,
    });
    notifyPermission('report.view', {
      type: 'report.new', title: 'Visitor reported incorrect information',
      body: 'A visitor flagged ' + plant.plant_code + ': ' + b.description.trim().slice(0, 100),
      related_type: 'plant', related_id: plant.id,
    });
    res.status(201).json({ report: row });
  });

  api.get('/reports', need('report.view'), (req, res) => {
    const rows = db.plant_reports
      .map((r) => ({
        ...r,
        plant: shapePlant(byId('plants', r.plant_id), { viewer: req.user }),
        handled_by_name: byId('users', r.handled_by)?.full_name || null,
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ open: rows.filter((r) => r.status === 'open').length, results: rows });
  });

  api.post('/reports/:id/resolve', need('report.resolve'), (req, res) => {
    const r = byId('plant_reports', req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    r.status = req.body?.dismiss ? 'dismissed' : 'resolved';
    r.handled_by = req.user.id;
    r.handled_at = nowIso();
    r.resolution_note = req.body?.note || null;
    audit({ user_id: req.user.id, action: 'update', entity_type: 'plant_reports', entity_id: r.id, new_values: { status: r.status } });
    res.json({ report: r });
  });

  /* ================================================================ */
  /* Admin - users, activity, audit, settings                         */
  /* ================================================================ */

  api.get('/users', need('user.view'), (req, res) => {
    res.json({
      results: db.users.filter((u) => !u.deleted_at).map((u) => ({
        ...shapeUser(u),
        created_by_name: byId('users', u.created_by)?.full_name || null,
        plants_registered: db.plants.filter((p) => p.registered_by === u.id).length,
        plants_verified: db.plants.filter((p) => p.verified_by === u.id).length,
      })),
    });
  });

  api.post('/users', need('user.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.full_name?.trim()) return res.status(400).json({ error: 'Full name is required.' });
    if (!b.email?.trim()) return res.status(400).json({ error: 'Email address is required.' });
    if (!EMAIL_RE.test(b.email.trim())) return res.status(400).json({ error: 'That does not look like an email address.' });
    if (db.users.some((u) => u.email.toLowerCase() === b.email.trim().toLowerCase())) {
      return res.status(409).json({ error: 'An account with that email address already exists.' });
    }
    if (!db.roles.some((r) => r.id === Number(b.role_id))) return res.status(400).json({ error: 'Choose a role.' });

    const row = insert('users', {
      role_id: Number(b.role_id),
      full_name: b.full_name.trim(), email: b.email.trim().toLowerCase(),
      title: b.title || null, phone: b.phone || null,
      password_hash: 'demo$' + Buffer.from('demo1234').toString('base64'),
      must_change_password: 1, is_active: 1,
      email_verified_at: null, last_login_at: null,
      created_by: req.user.id, updated_at: nowIso(), deleted_at: null,
    });
    audit({ user_id: req.user.id, action: 'create', entity_type: 'users', entity_id: row.id, new_values: { email: row.email, role_id: row.role_id } });
    res.status(201).json({ user: shapeUser(row), temporary_password: 'demo1234' });
  });

  api.patch('/users/:id', need('user.manage'), (req, res) => {
    const u = byId('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const before = { ...u };
    if ('role_id' in (req.body || {})) {
      if (!req.can('user.assign_role')) return res.status(403).json({ error: 'Not permitted to change roles.' });
      u.role_id = Number(req.body.role_id);
    }
    ['full_name', 'title', 'phone'].forEach((k) => { if (k in (req.body || {})) u[k] = req.body[k]; });
    if ('is_active' in (req.body || {})) {
      u.is_active = req.body.is_active ? 1 : 0;
      if (!u.is_active) {
        // Revoke live sessions so a deactivated account loses access at once.
        for (const [token, uid] of sessions) if (uid === u.id) sessions.delete(token);
      }
    }
    u.updated_at = nowIso();
    audit({
      user_id: req.user.id,
      action: before.role_id !== u.role_id ? 'role_change' : 'update',
      entity_type: 'users', entity_id: u.id,
      old_values: { role_id: before.role_id, is_active: before.is_active, full_name: before.full_name },
      new_values: { role_id: u.role_id, is_active: u.is_active, full_name: u.full_name },
    });
    res.json({ user: shapeUser(u) });
  });

  api.post('/users/:id/reset-password', need('user.manage'), (req, res) => {
    const u = byId('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    u.must_change_password = 1;
    u.updated_at = nowIso();
    for (const [token, uid] of sessions) if (uid === u.id) sessions.delete(token);
    audit({ user_id: req.user.id, action: 'password_reset', entity_type: 'users', entity_id: u.id, new_values: { must_change_password: 1 } });
    activity({ user_id: req.user.id, action: 'password_changed', detail: 'Reset the password for ' + u.email });
    res.json({ ok: true, temporary_password: 'demo1234' });
  });

  api.get('/activity', need('system.audit'), (req, res) => {
    const rows = db.user_activity_logs
      .map((a) => ({ ...a, user_name: byId('users', a.user_id)?.full_name || 'Unknown', user_email: byId('users', a.user_id)?.email || null }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 300);
    res.json({ results: rows });
  });

  api.get('/audit', need('system.audit'), (req, res) => {
    const { entity_type = '', action = '' } = req.query;
    let rows = db.audit_logs.map((a) => ({ ...a, user_name: byId('users', a.user_id)?.full_name || 'System' }));
    if (entity_type) rows = rows.filter((r) => r.entity_type === entity_type);
    if (action) rows = rows.filter((r) => r.action === action);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({
      total: rows.length,
      entity_types: [...new Set(db.audit_logs.map((a) => a.entity_type))],
      actions: [...new Set(db.audit_logs.map((a) => a.action))],
      results: rows.slice(0, 300),
    });
  });

  api.get('/admin/stats', need('user.view'), (req, res) => {
    res.json({
      users: db.users.filter((u) => !u.deleted_at).length,
      active_users: db.users.filter((u) => u.is_active && !u.deleted_at).length,
      by_role: db.roles.map((r) => ({
        role: r.name, label: r.label,
        count: db.users.filter((u) => u.role_id === r.id && !u.deleted_at).length,
      })),
      logins_7d: db.user_activity_logs.filter((a) => a.action === 'login'
        && Date.now() - new Date(a.created_at) < 7 * 86400000).length,
      failed_logins: db.user_activity_logs.filter((a) => a.action === 'login_failed').length,
      audit_entries: db.audit_logs.length,
    });
  });

  api.get('/settings', need('system.settings'), (req, res) => {
    res.json({
      results: db.settings.map((s) => ({ ...s, updated_by_name: byId('users', s.updated_by)?.full_name || null })),
    });
  });

  api.patch('/settings/:key', need('system.settings'), (req, res) => {
    const row = db.settings.find((s) => s.setting_key === req.params.key);
    if (!row) return res.status(404).json({ error: 'Unknown setting' });
    const before = row.setting_value;
    setSetting(req.params.key, req.body?.value, req.user.id);
    audit({
      user_id: req.user.id, action: 'update', entity_type: 'settings', entity_id: null,
      old_values: { [req.params.key]: before }, new_values: { [req.params.key]: row.setting_value },
    });
    res.json({ setting: row });
  });

  /* ================================================================ */
  /* IoT - hardware not received yet                                  */
  /* ================================================================ */

  api.get('/sensors', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    res.json({
      status: 'coming_soon',
      message: 'Sensor hardware has not been received yet. The IoT dashboard is scheduled for a later sprint.',
      devices: [], readings: [], alerts: [],
      offline_minutes: getSetting('sensor_offline_minutes'),
    });
  });

  /* ================================================================ */
  /* Photos + connect                                                 */
  /* ================================================================ */

  /** Photographs cached by scripts/import-species.mjs. */
  api.get('/photos/file/:name', (req, res) => {
    const name = req.params.name;
    if (!photoExists(name)) return res.status(404).json({ error: 'No such photograph' });
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.type('image/jpeg');
    res.sendFile(path.join(PHOTO_DIR, name));
  });

  api.get('/photos/:name', (req, res) => {
    res.type('image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(renderPhoto(req.params.name));
  });

  /** Everything the "open on your phone" screen needs. */
  api.get('/connect', async (req, res) => {
    const port = req.app.get('protoPort');
    const scheme = req.app.get('protoScheme') || 'http';
    const addrs = lanAddresses();
    const primary = addrs[0]?.address || '127.0.0.1';
    const url = `${scheme}://${primary}:${port}`;
    const png = await QRCode.toDataURL(url, {
      margin: 1, width: 900, errorCorrectionLevel: 'M',
      color: { dark: '#14281d', light: '#ffffff' },
    });
    res.json({
      url, png, port, scheme,
      addresses: addrs.map((a) => ({ ...a, url: `${scheme}://${a.address}:${port}` })),
      secure: scheme === 'https',
      // Where a phone can download the local CA certificate to trust it.
      ca_url: req.app.get('protoCaPath') || null,
      note: scheme === 'https'
        ? 'Your phone will warn about the local certificate. Accept it once and the in-app camera scanner will work; trust it (below) to remove the warning for good.'
        : 'Browsers only allow camera access over HTTPS or localhost, so the in-app scanner cannot open the camera on this plain-HTTP address. Run "npm run https" if you need the live camera on your phone.',
    });
  });

  api.use((req, res) => res.status(404).json({ error: 'No such endpoint: ' + req.path }));

  // Always answer the client in JSON - an HTML error page would surface in the
  // UI as an unhelpful parse failure.
  api.use((err, req, res, _next) => {
    console.error('API error on ' + req.method + ' ' + req.path + ':', err);
    res.status(500).json({ error: err.message || 'Unexpected server error' });
  });

  return api;
}
