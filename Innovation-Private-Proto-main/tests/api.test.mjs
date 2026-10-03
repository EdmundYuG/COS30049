/**
 * API test suite.
 *
 * Covers the quality targets named in the project proposal:
 *   - access control     (negative tests across the three roles + anonymous)
 *   - publication control (nothing unapproved reachable from a public URL)
 *   - input validation    (the CHECK constraints from the SQL schema)
 *   - the record lifecycle and the verification workflow
 *   - audit completeness
 *
 * Run against a server already started with `npm run dev`:
 *   npm run test:api
 */

// The dev server serves HTTPS by default, with a self-signed certificate.
// This is a local run against our own machine, so trusting it is fine.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PORT = process.env.PORT || (await readPort());
const ORIGIN = await detectOrigin(PORT);
const BASE = `${ORIGIN}/api`;

async function readPort() {
  const fs = await import('node:fs');
  try {
    return JSON.parse(fs.readFileSync(new URL('../proto.config.json', import.meta.url), 'utf8')).port;
  } catch {
    throw new Error('No proto.config.json - start the server once with "npm run dev" first.');
  }
}

/** The server can run on either scheme; find out which, rather than assume. */
async function detectOrigin(port) {
  for (const scheme of ['https', 'http']) {
    try {
      const res = await fetch(`${scheme}://localhost:${port}/api/bootstrap`);
      if (res.ok) return `${scheme}://localhost:${port}`;
    } catch { /* try the other scheme */ }
  }
  throw new Error(`Nothing answering on port ${port}. Start the server with "npm run dev".`);
}

/* ------------------------------------------------------------------ */
/* Tiny test harness                                                   */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
let group = '';

const section = (name) => { group = name; console.log(`\n\x1b[1m${name}\x1b[0m`); };

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mok\x1b[0m   ${label}`);
  } else {
    failures.push({ group, label, detail });
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? '\n         ' + detail : ''}`);
  }
}

const eq = (label, actual, expected) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/* ------------------------------------------------------------------ */

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const get = (p, t) => call('GET', p, { token: t });
const post = (p, body, t) => call('POST', p, { token: t, body });
const patch = (p, body, t) => call('PATCH', p, { token: t, body });

async function login(email, password = 'demo1234') {
  const r = await post('/auth/login', { email, password });
  return r.body?.token;
}

const ADMIN = 'admin@niah.sarawak.gov.my';
const BOTANIST = 'suehan.lee@niah.sarawak.gov.my';
const RANGER = 'edmund.yu@niah.sarawak.gov.my';
const DEACTIVATED = 'jiaqi.hu@niah.sarawak.gov.my';

/* ================================================================== */

console.log(`FloraScan API tests against ${BASE}\n`);

const adminT = await login(ADMIN);
const botT = await login(BOTANIST);
const rangerT = await login(RANGER);

if (!adminT || !botT || !rangerT) {
  console.error('Could not sign in the demo accounts. Is the server running?');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
section('1. Authentication');
{
  const ok = await post('/auth/login', { email: RANGER, password: 'demo1234' });
  eq('correct credentials return 200', ok.status, 200);
  check('a session token is issued', typeof ok.body.token === 'string' && ok.body.token.length > 20);
  check('the response carries the permission list', Array.isArray(ok.body.user.permissions));

  const bad = await post('/auth/login', { email: RANGER, password: 'wrong-password' });
  eq('wrong password is refused', bad.status, 401);
  check('the error does not reveal whether the account exists', !/no account/i.test(bad.body.error || ''));

  const unknown = await post('/auth/login', { email: 'nobody@example.com', password: 'demo1234' });
  eq('unknown email is refused', unknown.status, 401);

  const off = await post('/auth/login', { email: DEACTIVATED, password: 'demo1234' });
  eq('a deactivated account cannot sign in', off.status, 403);

  const empty = await post('/auth/login', { email: '', password: '' });
  eq('empty credentials are refused', empty.status, 401);

  const me = await get('/auth/me', 'not-a-real-token');
  eq('a forged token resolves to no user', me.body.user, null);

  const meAnon = await get('/auth/me');
  eq('no token resolves to no user', meAnon.body.user, null);
}

/* ------------------------------------------------------------------ */
section('2. Access control - anonymous visitors (negative tests)');
{
  const cases = [
    ['GET', '/plants'], ['GET', '/plants/counts'], ['GET', '/users'],
    ['GET', '/activity'], ['GET', '/audit'], ['GET', '/settings'],
    ['GET', '/submissions'], ['GET', '/notifications'], ['GET', '/reports'],
    ['GET', '/sensors'],
  ];
  for (const [m, p] of cases) {
    const r = await call(m, p);
    check(`anonymous ${m} ${p} is refused`, r.status === 401 || r.status === 403, 'got ' + r.status);
  }
  const create = await post('/plants', { site_name: 'x', proposed_species_name: 'y' });
  eq('anonymous cannot register a plant', create.status, 401);

  const approve = await post('/plants/1/approve', {});
  eq('anonymous cannot approve a record', approve.status, 401);
}

/* ------------------------------------------------------------------ */
section('3. Access control - ranger may not do a botanist or admin job');
{
  const pending = (await get('/plants?status=pending', botT)).body.results[0];
  const cases = [
    ['POST', `/plants/${pending.id}/approve`, {}],
    ['POST', `/plants/${pending.id}/reject`, { note: 'no' }],
    ['PATCH', `/plants/${pending.id}`, { site_name: 'hijacked' }],
    ['POST', `/plants/${pending.id}/archive`, {}],
    ['POST', '/species', { scientific_name: 'Testus rangerus' }],
    ['GET', '/users', undefined],
    ['POST', '/users', { full_name: 'X', email: 'x@y.com', role_id: 1 }],
    ['GET', '/activity', undefined],
    ['GET', '/audit', undefined],
    ['GET', '/settings', undefined],
    ['PATCH', '/settings/require_approval', { value: false }],
    ['GET', '/reports', undefined],
  ];
  for (const [m, p, b] of cases) {
    const r = await call(m, p, { token: rangerT, body: b });
    eq(`ranger ${m} ${p}`, r.status, 403);
  }
}

/* ------------------------------------------------------------------ */
section('4. Access control - botanist may not do an admin job');
{
  const cases = [
    ['GET', '/users'], ['GET', '/activity'], ['GET', '/audit'], ['GET', '/settings'],
  ];
  for (const [m, p] of cases) {
    const r = await call(m, p, { token: botT });
    eq(`botanist ${m} ${p}`, r.status, 403);
  }
  const setting = await patch('/settings/require_approval', { value: false }, botT);
  eq('botanist cannot change a system setting', setting.status, 403);
}

/* ------------------------------------------------------------------ */
section('5. Access control - admin may not do botanical work');
{
  const pending = (await get('/plants?status=pending', botT)).body.results[0];
  const cases = [
    ['POST', '/plants', { site_name: 'x', proposed_species_name: 'y' }],
    ['POST', `/plants/${pending.id}/approve`, {}],
    ['POST', `/plants/${pending.id}/reject`, { note: 'n' }],
    ['PATCH', `/plants/${pending.id}`, { site_name: 'x' }],
    ['POST', '/species', { scientific_name: 'Testus adminus' }],
  ];
  for (const [m, p, b] of cases) {
    const r = await call(m, p, { token: adminT, body: b });
    eq(`admin ${m} ${p}`, r.status, 403);
  }
}

/* ------------------------------------------------------------------ */
section('6. Data scoping');
{
  const rangerList = (await get('/plants', rangerT)).body.results;
  const botList = (await get('/plants', botT)).body.results;
  check('a ranger sees only their own records',
    rangerList.every((p) => p.registered_by_name === 'Edmund Guo Qian Yu'),
    'found a record registered by someone else');
  check('a botanist sees the whole register', botList.length > rangerList.length,
    `botanist ${botList.length} vs ranger ${rangerList.length}`);
}

/* ------------------------------------------------------------------ */
section('7. Publication control - nothing unapproved is public');
{
  const pub = (await get('/public/plants')).body;
  check('every public record is approved', pub.results.every((p) => p.status === 'approved'));
  check('every public record has a confirmed species', pub.results.every((p) => p.species_id));
  check('no public record is still awaiting identification', pub.results.every((p) => !p.species_not_listed));

  const all = (await get('/plants', botT)).body.results;
  for (const status of ['pending', 'rejected', 'archived']) {
    const row = all.find((p) => p.status === status);
    if (!row) continue;
    const anon = await get('/public/plants/' + row.id);
    eq(`a ${status} record is not readable anonymously`, anon.status, 404);
  }

  const archived = all.find((p) => p.status === 'archived' && p.qr_token);
  if (archived) {
    const scan = await get('/public/plants/token/' + archived.qr_token);
    eq('scanning an archived tag returns 404', scan.status, 404);
    eq('...with a reason the app can act on', scan.body.reason, 'archived');
  }

  const bogus = await get('/public/plants/token/00000000-0000-0000-0000-000000000000');
  eq('an unknown token is rejected', bogus.status, 404);
  check('QR tokens are not sequential ids',
    pub.results.every((p) => !p.qr_token || !/^\d+$/.test(p.qr_token)));
}

/* ------------------------------------------------------------------ */
section('8. Input validation - plant registration');
{
  const bad = [
    [{ site_name: 'Trail A' }, 'no species and no proposed name'],
    [{ proposed_species_name: 'Hoya sp.' }, 'no site name'],
    [{ site_name: '   ', proposed_species_name: 'Hoya sp.' }, 'whitespace-only site name'],
    [{ site_name: 'T', proposed_species_name: 'H', latitude: 91, longitude: 100 }, 'latitude above 90'],
    [{ site_name: 'T', proposed_species_name: 'H', latitude: -91, longitude: 100 }, 'latitude below -90'],
    [{ site_name: 'T', proposed_species_name: 'H', latitude: 3, longitude: 181 }, 'longitude above 180'],
    [{ site_name: 'T', proposed_species_name: 'H', latitude: 3 }, 'latitude without longitude'],
    [{ site_name: 'T', proposed_species_name: 'H', height_m: -5 }, 'negative height'],
    [{ site_name: 'T', proposed_species_name: 'H', height_m: 9999 }, 'implausible height'],
    [{ site_name: 'T', proposed_species_name: 'H', trunk_diameter_cm: -1 }, 'negative trunk diameter'],
    [{ site_name: 'T', proposed_species_name: 'H', height_m: 'tall' }, 'non-numeric height'],
    [{ site_name: 'T', proposed_species_name: 'H', health_status: 'sideways' }, 'unknown health status'],
    [{ site_name: 'T', proposed_species_name: 'H', life_stage: 'ancient' }, 'unknown life stage'],
    [{ site_name: 'x'.repeat(300), proposed_species_name: 'H' }, 'over-long site name'],
    [{ site_name: 'T', species_id: 999999 }, 'species id that does not exist'],
  ];
  for (const [body, label] of bad) {
    const r = await post('/plants', body, rangerT);
    eq(`rejected: ${label}`, r.status, 400);
  }

  const good = await post('/plants', {
    site_name: 'Test plot, validation suite',
    proposed_species_name: 'Hoya sp. (test record)',
    latitude: 3.8167, longitude: 113.7833,
    height_m: 2.4, health_status: 'fair', life_stage: 'sapling',
  }, rangerT);
  eq('a valid registration is accepted', good.status, 201);
  check('it is given a Plant ID', /^PLT-\d{4}-\d{4}$/.test(good.body.plant.plant_code || ''),
    good.body.plant?.plant_code);
}

/* ------------------------------------------------------------------ */
section('9. Input validation - review, species and users');
{
  const pending = (await get('/plants?status=pending', botT)).body.results[0];

  const noNote = await post(`/plants/${pending.id}/reject`, {}, botT);
  eq('rejecting without a note is refused', noNote.status, 400);

  const blankNote = await post(`/plants/${pending.id}/reject`, { note: '   ' }, botT);
  eq('a whitespace-only note is refused', blankNote.status, 400);

  const unidentified = (await get('/plants?status=pending', botT)).body.results
    .find((p) => p.species_not_listed);
  if (unidentified) {
    const r = await post(`/plants/${unidentified.id}/approve`, {}, botT);
    eq('a record with no species cannot be approved', r.status, 400);
  }

  const dupSpecies = await post('/species', { scientific_name: 'Rafflesia tuan-mudae' }, botT);
  eq('a duplicate scientific name is refused', dupSpecies.status, 409);

  const emptySpecies = await post('/species', { scientific_name: '  ' }, botT);
  eq('an empty scientific name is refused', emptySpecies.status, 400);

  const dupUser = await post('/users', { full_name: 'Clone', email: ADMIN, role_id: 2 }, adminT);
  eq('a duplicate email is refused', dupUser.status, 409);

  const noName = await post('/users', { full_name: '', email: 'new@niah.gov.my', role_id: 2 }, adminT);
  eq('a user with no name is refused', noName.status, 400);

  const badEmail = await post('/users', { full_name: 'Test', email: 'not-an-email', role_id: 2 }, adminT);
  eq('a malformed email is refused', badEmail.status, 400);

  const badRole = await post('/users', { full_name: 'Test', email: 'ok@niah.gov.my', role_id: 99 }, adminT);
  eq('an unknown role is refused', badRole.status, 400);

  const unknownSetting = await patch('/settings/does_not_exist', { value: 'x' }, adminT);
  eq('an unknown setting key is refused', unknownSetting.status, 404);

  const emptyReport = await post('/reports', { plant_id: 1, description: '' });
  eq('an empty visitor report is refused', emptyReport.status, 400);

  const missing = await get('/public/plants/99999999');
  eq('a missing record returns 404, not 500', missing.status, 404);

  const badEndpoint = await get('/no/such/endpoint');
  eq('an unknown endpoint returns JSON 404', badEndpoint.status, 404);
  check('...as JSON, not an HTML error page', typeof badEndpoint.body?.error === 'string');
}

/* ------------------------------------------------------------------ */
section('10. Hostile and awkward input is stored safely');
{
  const nasty = '<script>alert("xss")</script>';
  const sqlish = "Robert'); DROP TABLE plants;--";
  const unicode = 'Pokok  中文 नमस्ते 🌿 emoji';

  const r = await post('/plants', {
    site_name: nasty,
    proposed_species_name: sqlish,
    location_notes: unicode,
    morphology_notes: 'a'.repeat(1999),
  }, rangerT);
  eq('an awkward payload is accepted as data', r.status, 201);
  eq('the script tag is stored verbatim, not executed or stripped', r.body.plant.site_name, nasty);
  eq('the SQL-looking string is stored verbatim', r.body.plant.proposed_species_name, sqlish);
  eq('unicode and emoji survive intact', r.body.plant.location_notes, unicode);

  const stillThere = await get('/plants?status=pending', botT);
  check('the register still works after that payload', stillThere.status === 200 && stillThere.body.results.length > 0);

  const tooLong = await post('/plants', {
    site_name: 'Test', proposed_species_name: 'x', morphology_notes: 'a'.repeat(5000),
  }, rangerT);
  eq('an over-long note is refused', tooLong.status, 400);

  const searchInjection = await get('/public/plants?q=' + encodeURIComponent("' OR 1=1 --"));
  eq('a SQL-looking search term is handled', searchInjection.status, 200);
  eq('...and matches nothing', searchInjection.body.total, 0);
}

/* ------------------------------------------------------------------ */
section('11. The verification workflow end to end');
{
  const before = (await get('/plants/counts', botT)).body.queue;

  // A ranger registers a plant against a known species.
  const species = (await get('/species')).body.results.find((s) => s.scientific_name === 'Koompassia excelsa');
  const created = await post('/plants', {
    species_id: species.id,
    site_name: 'Workflow test, marker 1',
    latitude: 3.8, longitude: 113.78, height_m: 40,
  }, rangerT);
  eq('the ranger entry is created', created.status, 201);
  eq('...with the status pending', created.body.plant.status, 'pending');
  check('...and no QR tag yet', !created.body.plant.qr_token);

  const id = created.body.plant.id;

  const queueAfter = (await get('/plants/counts', botT)).body.queue;
  eq('the review queue grew by one', queueAfter, before + 1);

  const botNotes = (await get('/notifications', botT)).body.results;
  check('the botanist was notified',
    botNotes.some((n) => n.type === 'submission.new' && (n.body || '').includes(created.body.plant.plant_code)));

  const anonBefore = await get('/public/plants/' + id);
  eq('the pending record is not public', anonBefore.status, 404);

  // The botanist approves it.
  const approved = await post(`/plants/${id}/approve`, {}, botT);
  eq('approval succeeds', approved.status, 200);
  eq('...the status becomes approved', approved.body.plant.status, 'approved');
  check('...a QR tag is issued automatically', !!approved.body.plant.qr_token);
  check('...the verifier is recorded', approved.body.plant.verified_by_name === 'Dr Sue Han Lee');

  const token = approved.body.plant.qr_token;
  const scan = await get('/public/plants/token/' + token);
  eq('scanning the new tag resolves to the record', scan.status, 200);
  eq('...and returns the right plant', scan.body.plant.id, id);

  const rangerNotes = (await get('/notifications', rangerT)).body.results;
  check('the ranger was told it was published',
    rangerNotes.some((n) => n.type === 'submission.approved' && (n.body || '').includes('approved')));

  // Editing must not invalidate a printed tag.
  await patch(`/plants/${id}`, { site_name: 'Workflow test, marker 2 (moved)' }, botT);
  const afterEdit = await get('/public/plants/token/' + token);
  eq('the tag still works after an edit', afterEdit.status, 200);
  eq('...and shows the edited value', afterEdit.body.plant.site_name, 'Workflow test, marker 2 (moved)');

  // Archive withdraws it; restore brings the same token back.
  await post(`/plants/${id}/archive`, { reason: 'test' }, botT);
  const archivedScan = await get('/public/plants/token/' + token);
  eq('an archived record is withdrawn from the public site', archivedScan.status, 404);
  eq('...with the archived reason', archivedScan.body.reason, 'archived');

  await post(`/plants/${id}/restore`, {}, botT);
  const restored = await get('/public/plants/token/' + token);
  eq('restoring makes the same printed tag valid again', restored.status, 200);
}

/* ------------------------------------------------------------------ */
section('12. Rejection path');
{
  const species = (await get('/species')).body.results[0];
  const created = await post('/plants', {
    species_id: species.id, site_name: 'Rejection test plot',
  }, rangerT);
  const id = created.body.plant.id;

  const note = 'Photographs do not show the diagnostic features. Please re-photograph.';
  const rejected = await post(`/plants/${id}/reject`, { note }, botT);
  eq('rejection succeeds with a note', rejected.status, 200);
  eq('...the status becomes rejected', rejected.body.plant.status, 'rejected');

  const anon = await get('/public/plants/' + id);
  eq('a rejected record is not public', anon.status, 404);

  const mine = (await get('/submissions?status=all&mine=1', rangerT)).body.results;
  const found = mine.find((s) => s.plant_id === id);
  check('the ranger can see it under their submissions', !!found);
  eq('...with the botanist note attached', found?.review_comment, note);

  const notes = (await get('/notifications', rangerT)).body.results;
  check('the ranger was notified of the return',
    notes.some((n) => n.type === 'submission.rejected'));
}

/* ------------------------------------------------------------------ */
section('13. Botanist entries publish immediately');
{
  const species = (await get('/species')).body.results[1];
  const created = await post('/plants', {
    species_id: species.id, site_name: 'Botanist direct entry test',
  }, botT);
  eq('the botanist entry is created', created.status, 201);
  eq('...and is approved straight away', created.body.plant.status, 'approved');
  check('...with a QR tag already issued', !!created.body.plant.qr_token);
}

/* ------------------------------------------------------------------ */
section('14. The require_approval setting changes ranger behaviour');
{
  const species = (await get('/species')).body.results[2];

  await patch('/settings/require_approval', { value: false }, adminT);
  const direct = await post('/plants', {
    species_id: species.id, site_name: 'Approval-off test',
  }, rangerT);
  eq('with approval off, a ranger entry publishes immediately', direct.body.plant.status, 'approved');

  const unlisted = await post('/plants', {
    proposed_species_name: 'Unknown sp. (approval-off test)', site_name: 'Approval-off test 2',
  }, rangerT);
  eq('...but an unidentified record still needs a botanist', unlisted.body.plant.status, 'pending');

  await patch('/settings/require_approval', { value: true }, adminT);
  const reviewed = await post('/plants', {
    species_id: species.id, site_name: 'Approval-on test',
  }, rangerT);
  eq('with approval on, a ranger entry waits for review', reviewed.body.plant.status, 'pending');
}

/* ------------------------------------------------------------------ */
section('15. Search covers the five fields in the proposal');
{
  const sample = (await get('/public/plants')).body.results[0];
  const cases = [
    ['Plant ID', sample.plant_code],
    ['scientific name', sample.scientific_name],
    ['common name', sample.common_name],
    ['family', sample.family],
    ['genus', sample.genus],
    ['location', sample.site_name],
  ];
  for (const [label, term] of cases) {
    if (!term) continue;
    const r = await get('/public/plants?q=' + encodeURIComponent(term));
    check(`search by ${label} finds the record`,
      r.body.results.some((p) => p.id === sample.id),
      `"${term}" returned ${r.body.total} results`);
  }

  const caseInsensitive = await get('/public/plants?q=' + encodeURIComponent(sample.family.toUpperCase()));
  check('search ignores case', caseInsensitive.body.total > 0);

  const nonsense = await get('/public/plants?q=zzzzqqqqxxxx');
  eq('a nonsense search returns nothing rather than everything', nonsense.body.total, 0);

  const empty = await get('/public/plants?q=');
  check('an empty search returns the whole register', empty.body.total > 0);
}

/* ------------------------------------------------------------------ */
section('16. Audit completeness');
{
  const species = (await get('/species')).body.results[3];
  const created = await post('/plants', { species_id: species.id, site_name: 'Audit test plot' }, botT);
  const id = created.body.plant.id;

  await patch(`/plants/${id}`, { site_name: 'Audit test plot (renamed)', height_m: 12.5 }, botT);

  const hist = await get(`/plants/${id}/history`, botT);
  eq('the history is readable', hist.status, 200);

  const rev = hist.body.revisions.find((r) => r.field_name === 'site_name');
  check('the field change was recorded', !!rev);
  eq('...with the old value', rev?.old_value, 'Audit test plot');
  eq('...with the new value', rev?.new_value, 'Audit test plot (renamed)');
  check('...with the actor', rev?.changed_by_name === 'Dr Sue Han Lee');
  check('...with a timestamp', !!rev?.created_at);

  const audits = await get('/audit', adminT);
  const entry = audits.body.results.find((a) => a.entity_type === 'plants' && a.entity_id === id);
  check('the change reached the audit trail', !!entry);
  check('every audit entry names an actor', audits.body.results.every((a) => a.user_name));
  check('every audit entry has a timestamp', audits.body.results.every((a) => a.created_at));
}

/* ------------------------------------------------------------------ */
section('17. Admin account management');
{
  const email = `test.user.${Date.now()}@niah.sarawak.gov.my`;
  const created = await post('/users', { full_name: 'Temporary Test User', email, role_id: 2 }, adminT);
  eq('an account is created', created.status, 201);
  check('...and must change its password', created.body.user.must_change_password === true);

  const id = created.body.user.id;
  const newToken = await login(email);
  check('the new account can sign in', !!newToken);

  await patch(`/users/${id}`, { is_active: false }, adminT);
  const afterOff = await get('/plants', newToken);
  eq('deactivating revokes the live session immediately', afterOff.status, 401);

  const loginOff = await post('/auth/login', { email, password: 'demo1234' });
  eq('...and blocks a fresh sign in', loginOff.status, 403);

  await patch(`/users/${id}`, { is_active: true }, adminT);
  const backOn = await login(email);
  check('reactivating restores access', !!backOn);

  await patch(`/users/${id}`, { role_id: 3 }, adminT);
  const asBotanist = await get('/auth/me', backOn);
  eq('a role change takes effect', asBotanist.body.user.role, 'botanist');
  check('...and brings the new permissions', asBotanist.body.user.permissions.includes('plant.approve'));

  const reset = await post(`/users/${id}/reset-password`, {}, adminT);
  eq('a password reset succeeds', reset.status, 200);
  const afterReset = await get('/plants', backOn);
  eq('...and revokes the session', afterReset.status, 401);
}

/* ------------------------------------------------------------------ */
section('18. QR codes');
{
  const plant = (await get('/public/plants')).body.results[0];
  const qr = await get(`/qr/${plant.id}`);
  eq('a QR payload is returned', qr.status, 200);
  check('...as a PNG data URL', (qr.body.png || '').startsWith('data:image/png;base64,'));
  check('...and as SVG', (qr.body.svg || '').includes('<svg'));
  check('the target URL contains the opaque token', (qr.body.target_url || '').includes(qr.body.qr_token));
  check('the token is a UUID, not a database id',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(qr.body.qr_token || ''));

  const again = await get(`/qr/${plant.id}`);
  eq('the token is stable across requests', again.body.qr_token, qr.body.qr_token);
}

/* ------------------------------------------------------------------ */
section('19. Generated imagery and connect endpoint');
{
  const res = await fetch(`${ORIGIN}/api/photos/test-species--leaf--1.svg`);
  eq('a placeholder photo renders', res.status, 200);
  check('...as SVG', (res.headers.get('content-type') || '').includes('svg'));

  const conn = await get('/connect');
  eq('the connect endpoint answers', conn.status, 200);
  check('...with a LAN URL', /^https?:\/\/[\d.]+:\d+$/.test(conn.body.url || ''), conn.body.url);
  check('...and a scannable QR', (conn.body.png || '').startsWith('data:image/png'));
}

/* ------------------------------------------------------------------ */
section('20. IoT is reported as not built');
{
  const r = await get('/sensors', botT);
  eq('the sensors endpoint answers', r.status, 200);
  eq('...saying the feature is coming', r.body.status, 'coming_soon');
  check('...with no fabricated readings', r.body.devices.length === 0 && r.body.readings.length === 0);
}

/* ------------------------------------------------------------------ */
section('21. Threatened species locations are withheld from the public');
{
  const setting = (await get('/settings', adminT)).body.results.find((s) => s.setting_key === 'protect_locations');
  check('the protect_locations setting exists', !!setting);
  eq('...and defaults to CR', setting?.setting_value, 'CR');

  const pub = (await get('/public/plants?conservation=CR')).body.results;
  check('there are critically endangered records to check', pub.length > 0, pub.length + ' found');

  for (const p of pub) {
    check(`${p.plant_code} is flagged as protected`, p.location_protected === true);
    eq(`${p.plant_code} latitude withheld`, p.latitude, null);
    eq(`${p.plant_code} longitude withheld`, p.longitude, null);
    eq(`${p.plant_code} gps accuracy withheld`, p.gps_accuracy_m, null);
    eq(`${p.plant_code} finding notes withheld`, p.location_notes, null);
    check(`${p.plant_code} site name replaced`, p.site_name === 'Location withheld', p.site_name);
  }

  // The detail endpoint and the QR path must apply the same rule.
  const one = pub[0];
  const detail = await get('/public/plants/' + one.id);
  eq('the detail endpoint withholds the coordinates too', detail.body.plant.latitude, null);
  check('...and explains why', !!detail.body.plant.location_withheld_reason);

  if (one.qr_token) {
    const scan = await get('/public/plants/token/' + one.qr_token);
    eq('scanning the tag also withholds the location', scan.body.plant.latitude, null);
  }

  // Staff must still be able to find the plant.
  const staffView = (await get('/plants?conservation=CR', botT)).body.results;
  check('a botanist still sees real coordinates', staffView.some((p) => p.latitude !== null));
  check('...and the real site name', staffView.every((p) => p.site_name !== 'Location withheld'));

  // Non-threatened records are unaffected.
  const lc = (await get('/public/plants?conservation=LC')).body.results;
  check('least-concern records keep their location', lc.some((p) => p.latitude !== null));
  check('...and are not flagged as protected', lc.every((p) => !p.location_protected));
}

/* ------------------------------------------------------------------ */
section('22. The protection does not leak through search or filters');
{
  // Find a protected plant and the real site it stands on.
  const staffCR = (await get('/plants?conservation=CR', botT)).body.results;
  // Must be a published record, or it would be absent from the public
  // register for an entirely different reason and prove nothing.
  const publicIds = new Set((await get('/public/plants?conservation=CR')).body.results.map((p) => p.id));
  const target = staffCR.find((p) => publicIds.has(p.id) && p.site_name && p.latitude !== null);
  check('a protected plant with a known site was found', !!target);

  if (target) {
    const bySite = await get('/public/plants?q=' + encodeURIComponent(target.site_name));
    check('searching its trail name does not return it',
      !bySite.body.results.some((p) => p.id === target.id),
      'leaked via free-text search');

    const byFilter = await get('/public/plants?site=' + encodeURIComponent(target.site_name));
    check('filtering by that site does not return it',
      !byFilter.body.results.some((p) => p.id === target.id),
      'leaked via the site filter');

    const byCode = await get('/public/plants?q=' + encodeURIComponent(target.plant_code));
    const found = byCode.body.results.find((p) => p.id === target.id);
    check('it is still findable by Plant ID', !!found, 'should remain searchable by its own code');
    eq('...but still without a location', found?.latitude, null);

    // Staff searching the same site do get it.
    const staffSearch = await get('/plants?q=' + encodeURIComponent(target.site_name), botT);
    check('a botanist searching that site does find it',
      staffSearch.body.results.some((p) => p.id === target.id));
  }
}

/* ------------------------------------------------------------------ */
section('23. The protection threshold is configurable');
{
  const crPlant = (await get('/public/plants?conservation=CR')).body.results[0];

  await patch('/settings/protect_locations', { value: 'off' }, adminT);
  const off = (await get('/public/plants/' + crPlant.id)).body.plant;
  check('with protection off the location is published', off.latitude !== null);
  check('...and the flag is gone', !off.location_protected);

  await patch('/settings/protect_locations', { value: 'VU' }, adminT);
  const vu = (await get('/public/plants?conservation=VU')).body.results;
  if (vu.length) {
    check('raising it to VU protects vulnerable species too', vu.every((p) => p.location_protected));
  }
  const stillCr = (await get('/public/plants/' + crPlant.id)).body.plant;
  check('...and critically endangered stays protected', stillCr.location_protected === true);

  const lcAtVu = (await get('/public/plants?conservation=LC')).body.results;
  check('...while least concern is still published', lcAtVu.some((p) => p.latitude !== null));

  // Put it back the way the demo expects.
  await patch('/settings/protect_locations', { value: 'CR' }, adminT);
  const restored = (await get('/public/plants/' + crPlant.id)).body.plant;
  eq('the setting is restored to CR', restored.location_protected, true);
}

/* ------------------------------------------------------------------ */
section('24. Imported species data and photographs');
{
  const boot = (await get('/bootstrap')).body;
  check('the register reports where its data came from', !!boot.data);
  check('...naming GBIF, iNaturalist and Wikipedia',
    (boot.data.sources || []).length >= 3 || boot.data.source === 'curated',
    JSON.stringify(boot.data.sources));

  const sp = (await get('/species')).body.results;
  check('the species list is substantial', sp.length >= 20, sp.length + ' species');
  check('every species has a family', sp.every((s) => s.family));
  check('every species has a conservation code', sp.every((s) => s.conservation_code));

  if (boot.data.source === 'imported') {
    check('conservation categories cite their source',
      sp.some((s) => (s.conservation_source || '').includes('IUCN')));

    const withPhotos = (await get('/public/plants')).body.results.filter((p) => p.photo);
    check('published records carry photographs', withPhotos.length > 0, withPhotos.length + ' with photos');

    const real = withPhotos.filter((p) => p.photo.includes('/api/photos/file/') || p.photo.startsWith('http'));
    check('...and they are real photographs, not only illustrations', real.length > 0);
    check('real photographs are credited', real.some((p) => p.photo_credit));

    const detail = (await get('/public/plants/' + real[0].id)).body.plant;
    const credited = detail.photos.filter((ph) => ph.credit);
    check('each credited photograph names a licence', credited.every((ph) => ph.license));
    check('...and links back to its source', credited.every((ph) => ph.source_url));
  }
}

/* ------------------------------------------------------------------ */
section('25. Photo serving');
{
  const plants = (await get('/public/plants')).body.results;
  const local = plants.find((p) => p.photo && p.photo.includes('/api/photos/file/'));

  if (local) {
    const name = local.photo.split('/').pop();
    const res = await fetch(`${BASE}/photos/file/${name}`);
    eq('a cached photograph is served', res.status, 200);
    check('...as a JPEG', (res.headers.get('content-type') || '').includes('jpeg'));
    check('...and is cacheable', (res.headers.get('cache-control') || '').includes('max-age'));
  }

  const missing = await fetch(`${BASE}/photos/file/definitely-not-here.jpg`);
  eq('a missing photograph returns 404', missing.status, 404);

  // Path traversal must not reach outside the photo directory.
  for (const evil of ['..%2F..%2Fpackage.json', '..%5C..%5Cpackage.json', '%2Fetc%2Fpasswd']) {
    const res = await fetch(`${BASE}/photos/file/${evil}`);
    check(`traversal attempt "${decodeURIComponent(evil)}" is refused`,
      res.status === 404 || res.status === 400, 'got ' + res.status);
  }

  const svg = await fetch(`${BASE}/photos/some-species--leaf--1.svg`);
  eq('the generated illustration still works as a fallback', svg.status, 200);
}

/* ------------------------------------------------------------------ */
section('26. Installable web app');
{
  const origin = `${ORIGIN}`;

  const manifestRes = await fetch(`${origin}/manifest.webmanifest`);
  eq('the manifest is served', manifestRes.status, 200);
  const manifest = await manifestRes.json();
  check('it has a name', !!manifest.name);
  check('it has a short name for the home screen', !!manifest.short_name);
  eq('it opens standalone', manifest.display, 'standalone');
  check('it declares a start URL', !!manifest.start_url);
  check('it has a 192px icon', manifest.icons.some((i) => i.sizes === '192x192'));
  check('it has a 512px icon', manifest.icons.some((i) => i.sizes === '512x512'));
  check('it has a maskable icon for Android', manifest.icons.some((i) => i.purpose === 'maskable'));

  for (const icon of manifest.icons) {
    const r = await fetch(origin + icon.src);
    check(`icon ${icon.src} exists`, r.status === 200, 'got ' + r.status);
  }

  const apple = await fetch(`${origin}/icons/apple-touch-icon.png`);
  eq('the iOS touch icon exists', apple.status, 200);

  const sw = await fetch(`${origin}/sw.js`);
  eq('the service worker is served', sw.status, 200);
  const swText = await sw.text();
  check('...and never caches write requests', swText.includes("request.method !== 'GET'"));

  const html = await (await fetch(origin + '/')).text();
  check('the page links the manifest', html.includes('manifest.webmanifest'));
  check('...declares an apple touch icon', html.includes('apple-touch-icon'));
  check('...and sets apple-mobile-web-app-capable', html.includes('apple-mobile-web-app-capable'));
}

/* ------------------------------------------------------------------ */
section('27. A phone can trust the local certificate');
if (!ORIGIN.startsWith('https:')) {
  console.log('  (skipped: the server is on plain HTTP)');
} else {
  const { X509Certificate } = await import('node:crypto');
  const tls = await import('node:tls');
  const https = await import('node:https');

  const conn = await get('/connect');
  eq('the connect screen is told where the certificate is', conn.body.ca_url, '/florascan-ca.crt');

  const res = await fetch(ORIGIN + '/florascan-ca.crt');
  eq('the CA certificate downloads', res.status, 200);
  eq('...with the type iOS installs as a profile', res.headers.get('content-type'), 'application/x-x509-ca-cert');
  const der = Buffer.from(await res.arrayBuffer());
  check('...and never the private key', !der.toString('latin1').includes('PRIVATE KEY'));

  let ca = null;
  try { ca = new X509Certificate(der); } catch { /* reported below */ }
  check('it is a certificate authority', !!ca?.ca, ca ? ca.subject : 'not a certificate');

  const port = new URL(ORIGIN).port;
  const peer = await new Promise((resolve, reject) => {
    const s = tls.connect({ host: 'localhost', port, rejectUnauthorized: false, servername: 'localhost' }, () => {
      resolve(new X509Certificate(s.getPeerCertificate().raw)); s.end();
    });
    s.on('error', reject);
  });
  check('the server certificate is signed by it', !!ca && peer.checkIssued(ca) && peer.verify(ca.publicKey));
  check('...is for TLS servers', (peer.keyUsage || []).includes('1.3.6.1.5.5.7.3.1'), String(peer.keyUsage));
  const days = (new Date(peer.validTo) - new Date(peer.validFrom)) / 86400000;
  check('...and lives under the 825 days iOS allows', days <= 825, Math.round(days) + ' days');

  // What the phone does: reach the LAN address and verify strictly against the CA alone.
  const lanHost = new URL(conn.body.url).hostname;
  const strict = (host) => new Promise((resolve) => {
    https.get({ host, port, path: '/api/bootstrap', ca: ca?.toString(), rejectUnauthorized: true, agent: false }, (r) => {
      r.resume(); resolve(r.statusCode);
    }).on('error', (e) => resolve(e.code || e.message));
  });
  eq(`a client trusting only the CA reaches ${lanHost}`, await strict(lanHost), 200);
  eq('...and localhost', await strict('localhost'), 200);
}

/* ------------------------------------------------------------------ */
section('28. A printed tag points somewhere a phone can reach');
{
  const plant = (await get('/public/plants?limit=1')).body.results[0];

  // The address must never come from the browser that asked for the code: a
  // botanist printing tags is on localhost, and a tag encoding localhost sends
  // every phone that scans it to its own device.
  const spoofed = await get(`/qr/${plant.id}?origin=${encodeURIComponent('https://localhost:9999')}`);
  eq('a QR code is produced', spoofed.status, 200);
  check('the caller cannot dictate the address', !spoofed.body.target_url.includes('localhost:9999'),
    spoofed.body.target_url);

  const url = new URL(spoofed.body.target_url);
  check('the tag never encodes a loopback address',
    !/^(localhost|127\.|::1)/.test(url.hostname), url.hostname);
  check('...and it carries the opaque token', url.pathname.includes(spoofed.body.qr_token));

  const plain = await get(`/qr/${plant.id}`);
  eq('the address is the same with no origin given', plain.body.target_url, spoofed.body.target_url);

  // Following the encoded URL has to land on that plant.
  const token = url.pathname.split('/p/')[1];
  const scan = await get('/public/plants/token/' + token);
  eq('following the tag resolves the record', scan.status, 200);
  eq('...and it is the right plant', scan.body.plant.plant_code, plant.plant_code);

  // A park with a real domain configures it, and tags then carry that instead.
  await patch('/settings/public_base_url', { value: 'https://florascan.example.gov.my' }, adminT);
  const configured = await get(`/qr/${plant.id}`);
  check('a configured public address wins',
    configured.body.target_url.startsWith('https://florascan.example.gov.my/p/'),
    configured.body.target_url);

  await patch('/settings/public_base_url', { value: 'https://florascan.example.gov.my/' }, adminT);
  const trailing = await get(`/qr/${plant.id}`);
  check('a trailing slash does not double up',
    !trailing.body.target_url.includes('//p/'), trailing.body.target_url);

  await patch('/settings/public_base_url', { value: '' }, adminT);
  const back = await get(`/qr/${plant.id}`);
  check('clearing it falls back to the network address',
    !back.body.target_url.includes('example.gov.my'), back.body.target_url);
}

/* ------------------------------------------------------------------ */
section('29. Apple touch icons');
{
  const html = await (await fetch(ORIGIN + '/')).text();

  // iOS picks by `sizes`; a single un-sized link is the usual reason a home
  // screen ends up with a screenshot of the page instead of the logo.
  const links = [...html.matchAll(/<link[^>]*rel="apple-touch-icon"[^>]*>/g)].map((m) => m[0]);
  check('apple-touch-icon links are present', links.length >= 2, links.length + ' found');
  check('...and at least one declares a size', links.some((l) => /sizes="\d+x\d+"/.test(l)));
  check('...including 180x180, what a modern iPhone asks for',
    links.some((l) => l.includes('180x180')));

  for (const m of links) {
    const href = m.match(/href="([^"]+)"/)?.[1];
    if (!href) continue;
    const res = await fetch(ORIGIN + href);
    check(`${href} is served`, res.status === 200, 'got ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    // Colour type 6 is RGBA, 4 is grey+alpha. iOS fills alpha with black.
    check(`${href} is opaque`, buf[25] !== 6 && buf[25] !== 4, 'colour type ' + buf[25]);
  }

  // iOS probes these paths when no link tag suits.
  for (const p of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
    const r = await fetch(ORIGIN + p);
    check(`root fallback ${p} exists`, r.status === 200, 'got ' + r.status);
  }

  check('the web app title is set for iOS', /apple-mobile-web-app-title/.test(html));
}

/* ------------------------------------------------------------------ */
section('30. Photo tints for smoother loading');
{
  const plants = (await get('/public/plants?limit=12')).body.results;
  const withPhoto = plants.filter((p) => p.photo);

  if (withPhoto.length) {
    const tinted = withPhoto.filter((p) => p.photo_tint);
    check('cards carry a placeholder colour', tinted.length > 0,
      `${tinted.length} of ${withPhoto.length} — run "npm run import:tints"`);
    check('...and it is a hex colour',
      tinted.every((p) => /^#[0-9a-f]{6}$/i.test(p.photo_tint)),
      tinted[0]?.photo_tint);

    const detail = (await get('/public/plants/' + withPhoto[0].id)).body.plant;
    check('each cached photograph on the record carries one too',
      detail.photos.every((ph) => !ph.file || ph.tint));
  }
}

/* ------------------------------------------------------------------ */
section('31. Archiving a record that was still awaiting review');
{
  const made = await post('/plants', {
    site_name: 'Debug plot, archive-while-pending',
    proposed_species_name: 'Unknown archive case',
    species_not_listed: true,
  }, rangerT);
  eq('a ranger submits a record', made.status, 201);
  const id = made.body.plant.id;

  const queued = await get('/submissions?status=pending', botT);
  check('it shows in the botanist queue', queued.body.results.some((s) => s.plant.id === id));

  const arch = await post(`/plants/${id}/archive`, { reason: 'Withdrawn, wrong tree' }, botT);
  eq('a botanist archives it before reviewing', arch.status, 200);

  const after = await get('/submissions?status=pending', botT);
  check('it no longer sits in the queue', !after.body.results.some((s) => s.plant.id === id),
    'an archived record left in the queue could be approved and published');

  const closed = (await get('/submissions?status=all', botT)).body.results.find((s) => s.plant.id === id);
  check('the submission is closed, not just hidden', closed && closed.status !== 'pending');
  check('...and says why', !!closed?.review_comment);
}

/* ------------------------------------------------------------------ */
section('32. Tidying up after the run');
{
  // These suites create records to exercise the workflow. Left behind, they
  // sit at the top of the public register and make a demo look broken, so
  // archive them: the same soft-delete a botanist would use, which keeps the
  // audit trail intact rather than pretending they never happened.
  const all = (await get('/plants', botT)).body.results;
  // Section 10's awkward payload hides its markers in the species name and the
  // notes rather than the site, so match across every field a suite writes to -
  // otherwise that record sits in the review queue for the next demo.
  const MARKERS = /test plot|test, marker|Bypass test|Approval-o|Botanist direct entry|Workflow test|Rejection test|Audit test|DROP TABLE|Debug plot|<script>|a{200,}/i;
  const litter = all.filter((p) =>
    p.status !== 'archived'
    && MARKERS.test([p.site_name, p.proposed_species_name, p.location_notes, p.morphology_notes].join(' ')));

  let archived = 0;
  for (const p of litter) {
    const r = await post(`/plants/${p.id}/archive`, { reason: 'Created by the automated test suite' }, botT);
    if (r.status === 200) archived++;
  }
  check(`archived ${archived} of ${litter.length} test records`, archived === litter.length,
    `${litter.length - archived} could not be archived`);

  const stillPublic = (await get('/public/plants?limit=100')).body.results
    .filter((p) => MARKERS.test([p.site_name, p.scientific_name, p.common_name].join(' ')));
  check('no test records remain in the public register', stillPublic.length === 0,
    stillPublic.map((p) => p.plant_code + ' @ ' + p.site_name).join(', '));
}

/* ================================================================== */

console.log('\n' + '='.repeat(60));
if (failures.length === 0) {
  console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m`);
} else {
  console.log(`\x1b[31m${failures.length} of ${passed + failures.length} checks failed:\x1b[0m`);
  failures.forEach((f) => console.log(`  - [${f.group}] ${f.label}${f.detail ? '\n      ' + f.detail : ''}`));
  process.exitCode = 1;
}
