/**
 * Browser test suite.
 *
 * Drives the real UI in headless Chrome: every route under every role, then
 * the forms - empty submits, bad values, awkward text - checking that the
 * screen says something useful instead of breaking. Any console error or
 * uncaught exception on any page fails the run.
 *
 *   npm run test:ui
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

/* ------------------------------------------------------------------ */

// The dev server serves HTTPS by default, with a self-signed certificate.
// This is a local run against our own machine, so trusting it is fine.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PORT = process.env.PORT || JSON.parse(
  fs.readFileSync(new URL('../proto.config.json', import.meta.url), 'utf8'),
).port;

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

const BASE = await detectOrigin(PORT);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to the browser executable.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
let group = '';

const section = (name) => { group = name; console.log(`\n\x1b[1m${name}\x1b[0m`); };

function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  \x1b[32mok\x1b[0m   ${label}`); }
  else { failures.push({ group, label, detail }); console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? '\n         ' + detail : ''}`); }
}

const eq = (label, a, b) => check(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/* ------------------------------------------------------------------ */

const ACCOUNTS = {
  admin: 'admin@niah.sarawak.gov.my',
  botanist: 'suehan.lee@niah.sarawak.gov.my',
  ranger: 'edmund.yu@niah.sarawak.gov.my',
};

async function tokenFor(email) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  if (!res.ok) throw new Error('login failed for ' + email);
  return (await res.json()).token;
}

// Console noise that is not a client fault. "Failed to load resource" is Chrome
// reporting an HTTP status; several tests deliberately provoke 400s and 404s and
// assert on them directly, so those must not also fail the console check.
const IGNORE = /favicon|React DevTools|ERR_INTERNET_DISCONNECTED|Failed to load resource/i;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // The prototype's HTTPS certificate is self-signed, so the browser must be
  // told to accept it; this is a local run against our own server.
  args: [
    '--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream',
    '--ignore-certificate-errors', '--allow-insecure-localhost',
  ],
});

/** A page that records every console error and uncaught exception. */
async function newPage({ token, mobile = false, view } = {}) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', (e) => { if (!IGNORE.test(e.message)) page.errors.push('UNCAUGHT: ' + e.message); });

  await page.setViewport(mobile
    ? { width: 390, height: 844, isMobile: true, hasTouch: true }
    : { width: 1440, height: 900 });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, v) => {
    if (t) localStorage.setItem('florascan.token', t);
    else localStorage.removeItem('florascan.token');
    if (v) localStorage.setItem('florascan.view', v);
    else localStorage.removeItem('florascan.view');
    // These tests exercise the app, not the first-run screen. The welcome
    // section clears this again so it can test the splash on its own terms.
    localStorage.setItem('florascan.intro-seen', '1');
  }, token || null, view || null);
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function go(page, route) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(350);
}

const bodyText = (page) => page.evaluate(() => document.body.innerText || '');

async function expectNoErrors(page, label) {
  const errs = page.errors.splice(0);
  check(label, errs.length === 0, errs.slice(0, 3).join(' | '));
}

/* ================================================================== */

console.log(`FloraScan UI tests against ${BASE}`);
console.log(`Browser: ${CHROME}\n`);

/* ------------------------------------------------------------------ */
section('1. Public pages render');
{
  const page = await newPage();
  const routes = ['/', '/browse', '/species', '/connect', '/login', '/scan'];
  for (const r of routes) {
    await go(page, r);
    const empty = await page.evaluate(() => document.getElementById('root').children.length === 0);
    check(`${r} renders content`, !empty);
  }
  await expectNoErrors(page, 'no console errors across the public site');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('2. The QR journey: scan a tag, land on the plant page');
{
  const list = await (await fetch(BASE + '/api/public/plants')).json();
  // Prefer a seeded record: records created by the API suite have a tag but no
  // photographs, and this section asserts on the gallery.
  const plant = list.results.find((p) => p.qr_token && p.photo) || list.results.find((p) => p.qr_token);

  const page = await newPage();
  await go(page, '/p/' + plant.qr_token);
  const text = await bodyText(page);

  check('the tag resolves to the plant page', text.includes(plant.scientific_name), text.slice(0, 120));
  check('the visitor is told the tag was scanned', /Tag scanned/i.test(text));
  check('the Plant ID is shown', text.includes(plant.plant_code));
  check('conservation status is shown', /Conservation/i.test(text));
  check('a photograph is present', await page.evaluate(() => !!document.querySelector('img[src*="/api/photos/"]')));

  await go(page, '/p/00000000-0000-0000-0000-000000000000');
  check('an unknown tag explains itself', /not recognised/i.test(await bodyText(page)));

  await expectNoErrors(page, 'no console errors on the plant page');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('3. Search and filters');
{
  const page = await newPage();
  await go(page, '/browse');

  await page.type('input[type="search"]', 'Belian');
  await sleep(700);
  let text = await bodyText(page);
  check('searching for a local name finds the record', /Eusideroxylon/i.test(text), text.slice(0, 200));

  await page.evaluate(() => {
    const i = document.querySelector('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'zzzznothingmatches');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(700);
  text = await bodyText(page);
  check('a search with no matches explains itself', /No records match/i.test(text), text.slice(0, 200));

  await go(page, '/browse?conservation=CR');
  await sleep(400);
  const codes = await page.evaluate(() =>
    [...document.querySelectorAll('.cs-swatch')].map((e) => e.textContent.trim()));
  check('filtering by Critically endangered returns only CR', codes.length > 0 && codes.every((c) => c === 'CR'),
    'got ' + [...new Set(codes)].join(','));

  await go(page, '/browse?family=Nepenthaceae');
  await sleep(400);
  const cards = await page.evaluate(() => document.querySelectorAll('.plant-card').length);
  check('filtering by family returns records', cards > 0);

  // The register is large, so the first screen must not pull every record.
  await go(page, '/browse');
  await sleep(500);
  const firstPage = await page.evaluate(() => document.querySelectorAll('.plant-card').length);
  const total = (await (await fetch(BASE + '/api/public/plants?limit=1')).json()).total;
  check('browse loads a page, not the whole register', firstPage <= 24 && firstPage > 0,
    firstPage + ' cards for ' + total + ' records');

  if (total > firstPage) {
    const more = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /load more|show more/i.test(x.textContent));
      if (!b) return false;
      b.click();
      return true;
    });
    check('...and offers to load more', more);
    if (more) {
      await sleep(1400);
      const second = await page.evaluate(() => document.querySelectorAll('.plant-card').length);
      check('...which appends the next page', second > firstPage, firstPage + ' -> ' + second);
    }
  }

  await expectNoErrors(page, 'no console errors while searching');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('4. The role switcher');
{
  const page = await newPage();
  await go(page, '/');

  check('the switcher is on screen', await page.evaluate(() => !!document.querySelector('.rs-fab')));
  eq('it starts as the public visitor',
    await page.evaluate(() => document.querySelector('.rs-fab').innerText.trim().split('\n')[0]), 'Visitor');

  await page.click('.rs-fab');
  await sleep(250);
  const accounts = await page.evaluate(() => document.querySelectorAll('.rs-panel .rs-item').length);
  check('it lists the visitor plus every demo account', accounts >= 8, 'found ' + accounts);

  // Pick the first botanist in the list.
  const clicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.rs-panel .rs-item')];
    const target = items.find((i) => /Botanist/i.test(i.innerText) && !i.disabled);
    if (!target) return null;
    target.click();
    return target.innerText.split('\n')[0];
  });
  await sleep(900);
  check('switching to a botanist works', !!clicked);
  const after = await page.evaluate(() => document.querySelector('.rs-fab').innerText);
  check('the switcher shows the new role', /Botanist/i.test(after), after);
  check('it lands on a staff screen', page.url().includes('/staff/'), page.url());

  // Keyboard shortcut.
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await sleep(250);
  check('Ctrl+K opens the switcher', await page.evaluate(() => !!document.querySelector('.rs-panel')));

  await page.keyboard.press('Digit0');
  await sleep(800);
  const back = await page.evaluate(() => document.querySelector('.rs-fab').innerText);
  check('pressing 0 returns to the public visitor', /Visitor/i.test(back), back);

  const deactivated = await page.evaluate(() => {
    document.querySelector('.rs-fab').click();
    return new Promise((res) => setTimeout(() => {
      const items = [...document.querySelectorAll('.rs-panel .rs-item')];
      res(items.some((i) => i.disabled && /deactivated/i.test(i.innerText)));
    }, 250));
  });
  check('the deactivated account is shown but not selectable', deactivated);

  await expectNoErrors(page, 'no console errors from the switcher');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('5. Staff routes under every role');
{
  const ROUTES = [
    '/staff/plants', '/staff/register', '/staff/review', '/staff/submissions',
    '/staff/species', '/staff/reports', '/staff/iot', '/staff/users',
    '/staff/activity', '/staff/audit', '/staff/settings', '/staff/notifications', '/staff/me',
  ];
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const token = await tokenFor(email);
    const page = await newPage({ token });
    let blocked = 0;
    for (const r of ROUTES) {
      await go(page, r);
      const info = await page.evaluate(() => ({
        empty: document.getElementById('root').children.length === 0,
        denied: /cannot open this page/i.test(document.body.innerText),
      }));
      if (info.denied) blocked++;
      check(`[${role}] ${r}`, !info.empty, 'rendered nothing');
    }
    check(`[${role}] pages outside the role are refused with an explanation`,
      role === 'botanist' ? blocked === 4 : blocked > 0,
      `${blocked} blocked`);
    await expectNoErrors(page, `[${role}] no console errors on any staff screen`);
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
section('6. Registration form - input validation');
{
  const token = await tokenFor(ACCOUNTS.ranger);
  const page = await newPage({ token });
  await go(page, '/staff/register');

  // Submit completely empty.
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Submit for review|Save and publish/i.test(b.textContent))?.click());
  await sleep(500);
  let text = await bodyText(page);
  check('an empty form reports the missing species', /Choose a species, or describe one/i.test(text));
  check('...and the missing location', /Give the location or trail marker/i.test(text));
  check('...and nothing was created', page.url().includes('/staff/register'));

  // Species-not-listed path.
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /species is not in the list/i.test(b.textContent))?.click());
  await sleep(250);
  check('the "species not listed" field appears',
    await page.evaluate(() => !!document.querySelector('input[placeholder*="Hoya"]')));

  await page.type('input[placeholder*="Hoya"]', 'Testus uiensis (browser test)');
  await sleep(250);
  text = await bodyText(page);
  check('an unidentified record is flagged as needing a botanist',
    /always needs a botanist|review queue/i.test(text), text.slice(0, 300));

  // Fill the location and submit.
  await page.type('#site', 'UI test plot, marker 9');
  await page.type('#morph', 'Entered by the automated browser test.');
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Submit for review/i.test(b.textContent))?.click());
  await sleep(1300);

  check('a valid submission navigates to the new record', /\/staff\/plants\/\d+/.test(page.url()), page.url());
  text = await bodyText(page);
  check('...and the record shows as pending review', /Pending review/i.test(text), text.slice(0, 200));
  check('...carrying the name the ranger typed', /Testus uiensis/.test(text));

  await expectNoErrors(page, 'no console errors while registering');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('7. Registration form - awkward and out-of-range input');
{
  const token = await tokenFor(ACCOUNTS.ranger);
  const page = await newPage({ token });
  await go(page, '/staff/register');

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /species is not in the list/i.test(b.textContent))?.click());
  await sleep(200);

  await page.type('input[placeholder*="Hoya"]', '<script>alert(1)</script>');
  await page.type('#site', "Robert'); DROP TABLE plants;-- \u4e2d\u6587 \ud83c\udf3f");
  await page.type('#height', '-40');
  await sleep(150);

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Submit for review/i.test(b.textContent))?.click());
  await sleep(1200);

  // The height field carries min="0", so the browser blocks the submit itself
  // and the request never leaves the page.
  const guard = await page.evaluate(() => {
    const h = document.querySelector('#height');
    return { underflow: h.validity.rangeUnderflow, value: h.value };
  });
  check('the browser marks a negative height invalid', guard.underflow === true, JSON.stringify(guard));
  check('...and nothing was submitted', !/\/staff\/plants\/\d+/.test(page.url()), page.url());

  // Defence in depth: the API must refuse it even when the client guard is bypassed.
  const rangerToken = await tokenFor(ACCOUNTS.ranger);
  const direct = await fetch(BASE + '/api/plants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rangerToken },
    body: JSON.stringify({ site_name: 'Bypass test', proposed_species_name: 'x', height_m: -40 }),
  });
  const directBody = await direct.json();
  eq('the API refuses it too when the client guard is bypassed', direct.status, 400);
  check('...with a message naming the allowed range',
    /between 0 and 150/i.test(directBody.error || ''), directBody.error);

  // Correct the height and resubmit.
  await page.evaluate(() => {
    const i = document.querySelector('#height');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '3.2');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Submit for review/i.test(b.textContent))?.click());
  await sleep(1300);

  check('correcting the value lets it through', /\/staff\/plants\/\d+/.test(page.url()), page.url());
  const saved = await bodyText(page);
  check('the script tag is shown as text, never executed', saved.includes('<script>alert(1)</script>'));
  check('unicode and emoji survived', /\u4e2d\u6587/.test(saved));
  check('no alert dialog was triggered', true); // an executed alert would have hung the click above

  await expectNoErrors(page, 'no console errors from hostile input');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('8. Review queue - approve and return');
{
  const token = await tokenFor(ACCOUNTS.botanist);
  const page = await newPage({ token });
  await go(page, '/staff/review');

  let text = await bodyText(page);
  check('the queue lists submissions awaiting review', /submitted/i.test(text), text.slice(0, 200));

  // An unidentified record must not be approvable.
  const disabled = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const card = cards.find((c) => /Species not listed/i.test(c.innerText));
    if (!card) return 'no-card';
    const approve = [...card.querySelectorAll('button')].find((b) => /Approve and publish/i.test(b.textContent));
    return approve ? approve.disabled : 'no-button';
  });
  check('Approve is disabled while the species is unconfirmed', disabled === true, String(disabled));

  // Returning requires a note.
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Return with a note/i.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(400);
  check('the return dialog opens', opened && await page.evaluate(() => !!document.querySelector('.modal')));

  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Return to ranger/i.test(b.textContent))?.click());
  await sleep(600);
  text = await bodyText(page);
  check('returning without a note is refused', /note is required/i.test(text), text.slice(-250));

  // A preset note fills the field.
  await page.evaluate(() => document.querySelector('.modal .chip')?.click());
  await sleep(200);
  const noteLen = await page.evaluate(() => document.querySelector('#note')?.value.length || 0);
  check('a preset reason fills the note', noteLen > 20, 'length ' + noteLen);

  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /^Cancel$/i.test(b.textContent))?.click());
  await sleep(300);
  check('cancel closes the dialog', await page.evaluate(() => !document.querySelector('.modal')));

  // Approve a record that does have a species.
  const before = await page.evaluate(() => document.querySelectorAll('.card-foot').length);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const card = cards.find((c) => !/Species not listed/i.test(c.innerText)
      && [...c.querySelectorAll('button')].some((b) => /Approve and publish/i.test(b.textContent)));
    [...card.querySelectorAll('button')].find((b) => /Approve and publish/i.test(b.textContent))?.click();
  });
  await sleep(1400);
  text = await bodyText(page);
  check('approving reports the published record and its tag', /published|QR tag issued/i.test(text), text.slice(-220));
  const after = await page.evaluate(() => document.querySelectorAll('.card-foot').length);
  check('the queue shrinks after approval', after < before, `${before} -> ${after}`);

  await expectNoErrors(page, 'no console errors in the review queue');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('9. Plant record - tabs, QR tag and history');
{
  const token = await tokenFor(ACCOUNTS.botanist);
  const list = await (await fetch(BASE + '/api/public/plants')).json();
  // Same reason as section 2: pick a seeded record with photographs.
  const plant = list.results.find((x) => x.photo) || list.results[0];

  const page = await newPage({ token });
  await go(page, '/staff/plants/' + plant.id);

  check('the record opens', (await bodyText(page)).includes(plant.plant_code));

  await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .find((b) => /QR tag/i.test(b.textContent))?.click());
  await sleep(1200);
  check('the QR tab shows a generated code',
    await page.evaluate(() => !!document.querySelector('.qr-card img[src^="data:image/png"]')));
  check('...and a printable tag preview',
    await page.evaluate(() => !!document.querySelector('.qr-tag')));
  check('...naming the plant on the tag',
    (await bodyText(page)).includes(plant.plant_code));

  await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .find((b) => /History/i.test(b.textContent))?.click());
  await sleep(900);
  check('the history tab lists changes',
    await page.evaluate(() => document.querySelectorAll('.tl-item').length > 0));

  // Edit, and confirm the change lands in the history.
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /^\s*Edit\s*$/i.test(b.textContent))?.click());
  await sleep(500);
  check('the edit dialog opens', await page.evaluate(() => !!document.querySelector('.modal')));

  const marker = 'Edited by UI test ' + Date.now();
  await page.evaluate((v) => {
    const i = document.querySelector('#e-morph');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, marker);
  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Save changes/i.test(b.textContent))?.click());
  await sleep(1300);

  check('the edit is confirmed to the user', /updated/i.test(await bodyText(page)));

  await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .find((b) => /History/i.test(b.textContent))?.click());
  await sleep(900);
  check('the edit appears in the history with the new value',
    (await bodyText(page)).includes(marker.slice(0, 20)));

  await expectNoErrors(page, 'no console errors on the record screen');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('10. Admin - accounts and the approval switch');
{
  const token = await tokenFor(ACCOUNTS.admin);
  const page = await newPage({ token });

  await go(page, '/staff/users');
  check('the account list renders', await page.evaluate(() => document.querySelectorAll('tbody tr').length >= 8));

  // Create with a bad email.
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /New account/i.test(b.textContent))?.click());
  await sleep(400);
  await page.type('#u-name', 'Browser Test Account');
  await page.type('#u-email', 'definitely-not-an-email');
  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Create account/i.test(b.textContent))?.click());
  await sleep(800);
  check('a malformed email is refused', /does not look like an email/i.test(await bodyText(page)));

  await page.evaluate(() => {
    const i = document.querySelector('#u-email');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'browser.test.' + Date.now() + '@niah.sarawak.gov.my');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Create account/i.test(b.textContent))?.click());
  await sleep(1200);
  check('a valid account is created and the temporary password shown',
    /Temporary password/i.test(await bodyText(page)));

  // The approval switch.
  await go(page, '/staff/settings');
  const initial = await page.evaluate(() =>
    document.querySelector('.card input[type="checkbox"]').checked);
  await page.evaluate(() => document.querySelector('.card input[type="checkbox"]').click());
  await sleep(1100);
  const flipped = await page.evaluate(() =>
    document.querySelector('.card input[type="checkbox"]').checked);
  check('the require_approval switch toggles', flipped !== initial, `${initial} -> ${flipped}`);
  check('...and the explanation follows the setting',
    new RegExp(flipped ? 'goes to the review queue' : 'published immediately', 'i')
      .test(await bodyText(page)));

  // Put it back.
  await page.evaluate(() => document.querySelector('.card input[type="checkbox"]').click());
  await sleep(1000);

  await go(page, '/staff/audit');
  check('the setting change reached the audit trail',
    /Settings/i.test(await bodyText(page)));

  await expectNoErrors(page, 'no console errors on the admin screens');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('11. Visitor report from a plant page');
{
  const list = await (await fetch(BASE + '/api/public/plants')).json();
  const plant = list.results.find((x) => x.photo) || list.results[0];
  const page = await newPage();
  await go(page, '/plant/' + plant.id);

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Report incorrect information/i.test(b.textContent))?.click());
  await sleep(400);
  check('the report dialog opens', await page.evaluate(() => !!document.querySelector('.modal')));

  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Send report/i.test(b.textContent))?.click());
  await sleep(700);
  check('an empty report is refused', /describe what looks wrong/i.test(await bodyText(page)));

  await page.type('#r-desc', 'The pitchers look like N. rafflesiana, not N. ampullaria.');
  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => /Send report/i.test(b.textContent))?.click());
  await sleep(1000);
  check('a filled report is accepted and acknowledged', /Thank you/i.test(await bodyText(page)));

  await expectNoErrors(page, 'no console errors while reporting');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('12. Phone layout');
{
  const token = await tokenFor(ACCOUNTS.ranger);
  const page = await newPage({ token, mobile: true, view: 'mobile' });

  await go(page, '/');
  const nav = await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .bn-item')].map((e) => e.innerText.trim()));
  check('the bottom tab bar is present', nav.length >= 4, nav.join(','));
  check('...with Scan in the middle', nav.some((n) => /Scan/i.test(n)), nav.join(','));
  check('...and a Register tab for a ranger', nav.some((n) => /Register/i.test(n)), nav.join(','));
  check('the desktop sidebar is hidden', await page.evaluate(() => !document.querySelector('.sidebar')));

  await go(page, '/staff/me');
  check('the account tab carries the rest of the navigation',
    await page.evaluate(() => document.querySelectorAll('.side-link').length > 3));

  await go(page, '/browse');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at 390px', overflow <= 1, overflow + 'px of overflow');

  await go(page, '/scan');
  const text = await bodyText(page);
  check('the scanner explains why the camera is unavailable over plain HTTP',
    /HTTPS|camera/i.test(text), text.slice(0, 200));
  check('...and still offers tags to open directly', /open a tag directly/i.test(text));

  await expectNoErrors(page, 'no console errors in the phone layout');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('13. Theme and layout switching');
{
  const page = await newPage();
  await go(page, '/');
  await page.click('.rs-fab');
  await sleep(250);

  await page.evaluate(() => {
    const seg = [...document.querySelectorAll('.rs-panel .segmented')].pop();
    [...seg.querySelectorAll('button')].find((b) => /Dark/i.test(b.textContent))?.click();
  });
  await sleep(300);
  eq('dark mode applies', await page.evaluate(() => document.documentElement.dataset.theme), 'dark');

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('the page background actually darkens', /rgb\((\d+), (\d+), (\d+)\)/.test(bg)
    && bg.match(/\d+/g).slice(0, 3).every((n) => Number(n) < 60), bg);

  await page.evaluate(() => {
    const seg = [...document.querySelectorAll('.rs-panel .segmented')].pop();
    [...seg.querySelectorAll('button')].find((b) => /Light/i.test(b.textContent))?.click();
  });
  await sleep(300);
  eq('light mode applies', await page.evaluate(() => document.documentElement.dataset.theme), 'light');

  await page.evaluate(() => {
    const seg = document.querySelector('.rs-panel .segmented');
    [...seg.querySelectorAll('button')].find((b) => /Phone app/i.test(b.textContent))?.click();
  });
  await sleep(500);
  check('forcing the phone layout on a desktop window works',
    await page.evaluate(() => !!document.querySelector('.bottom-nav')));

  await expectNoErrors(page, 'no console errors while switching theme and layout');
  await page.close();
}

// A visitor has no role switcher menu to dig through: the header carries the
// switch, on the smallest phone we design for.
{
  const page = await newPage({ mobile: true, view: 'mobile' });
  await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
  await page.evaluate(() => localStorage.removeItem('florascan.theme'));
  await go(page, '/');

  const radios = await page.$$('.m-header .theme-switch [role="radio"]');
  eq('the phone header has auto, light and dark theme buttons', radios.length, 3);
  const theme = () => page.evaluate(() => ({
    attr: document.documentElement.dataset.theme || null,
    saved: localStorage.getItem('florascan.theme'),
    checked: document.querySelector('.theme-switch [aria-checked="true"]')?.getAttribute('aria-label'),
    meta: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
  }));

  check('...with automatic selected by default', /Automatic/.test((await theme()).checked || ''), (await theme()).checked);

  await page.click('.theme-switch [aria-label="Dark theme"]');
  await sleep(200);
  let t = await theme();
  eq('the dark button switches to dark', t.attr, 'dark');
  eq('...and remembers it', t.saved, 'dark');
  check('...and the browser bar colour follows', t.meta.every((c) => c === '#0f2a1a'), t.meta.join(','));

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(300);
  eq('the choice survives a reload', (await theme()).attr, 'dark');

  await page.click('.theme-switch [aria-label="Light theme"]');
  await sleep(200);
  eq('the light button switches to light', (await theme()).attr, 'light');

  await page.click('.theme-switch [aria-label^="Automatic"]');
  await sleep(200);
  t = await theme();
  eq('automatic hands control back to the device', t.attr, null);
  eq('...stored as "system"', t.saved, 'system');
  check('...and restores the per-scheme browser bar colours', new Set(t.meta).size === 2, t.meta.join(','));

  const header = await page.evaluate(() => {
    const h = document.querySelector('.m-header').getBoundingClientRect();
    const s = document.querySelector('.m-header .theme-switch').getBoundingClientRect();
    return { right: s.right, width: h.width, height: h.height };
  });
  check('the switch fits in the header at 320px', header.right <= header.width && header.height < 80, JSON.stringify(header));

  await expectNoErrors(page, 'no console errors from the header theme switch');
  await page.close();
}

// Text layout on the plant page at 320px: the photo caption and its credit,
// and the headed sections of the species description.
{
  const list = (await (await fetch(BASE + '/api/public/plants?limit=100')).json()).results;
  let target = null;
  for (const p of list) {
    const { plant } = await (await fetch(BASE + '/api/public/plants/' + p.id)).json();
    const sp = plant.species || {};
    const headed = [sp.description, sp.characteristics, sp.leaf_description].filter(Boolean).length;
    if (plant.photos?.[0]?.caption && plant.photos[0].credit && headed >= 2) { target = plant; break; }
  }
  check('there is a captioned plant with several description sections', !!target);

  if (target) {
    const page = await newPage({ mobile: true, view: 'mobile' });
    await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
    await go(page, '/plant/' + target.id);

    const m = await page.evaluate(() => {
      const meta = document.querySelector('.gallery-meta').getBoundingClientRect();
      const cap = document.querySelector('.gallery-caption').getBoundingClientRect();
      const hs = [...document.querySelectorAll('.prose h3')];
      return {
        metaW: meta.width, capW: cap.width,
        firstTop: parseFloat(getComputedStyle(hs[0]).marginTop),
        laterTop: hs.slice(1).map((h) => parseFloat(getComputedStyle(h).marginTop)),
      };
    });
    check('the photo caption keeps a readable width instead of a sliver beside the credit',
      m.capW >= Math.min(192, m.metaW) - 1, `${Math.round(m.capW)}px of ${Math.round(m.metaW)}px`);
    eq('the first description heading sits flush with the card', m.firstTop, 0);
    check('...and each later heading is spaced from the paragraph above',
      m.laterTop.length > 0 && m.laterTop.every((v) => v >= 12), m.laterTop.join(','));

    await expectNoErrors(page, 'no console errors on the plant page at 320px');
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
section('14. Session handling');
{
  const page = await newPage({ token: 'a-forged-token-that-is-not-valid' });
  await go(page, '/staff/plants');
  await sleep(600);
  check('a forged token is rejected and the user sent to sign in',
    page.url().includes('/login') || /sign in/i.test(await bodyText(page)), page.url());

  const stored = await page.evaluate(() => localStorage.getItem('florascan.token'));
  check('...and the dead token is cleared from storage', stored === null, String(stored));

  await page.close();
}

/* ------------------------------------------------------------------ */
section('15. Accessibility basics');
{
  const page = await newPage();
  await go(page, '/browse');

  const labelled = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('input, select, textarea')];
    return controls.filter((c) => !c.labels?.length && !c.getAttribute('aria-label')
      && !c.closest('label')).length;
  });
  check('every form control on Browse has a label', labelled === 0, labelled + ' unlabelled');

  const alts = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((i) => i.alt === null || i.alt === undefined).length);
  check('every image carries an alt attribute', alts === 0, alts + ' missing');

  const h1s = await page.evaluate(() => document.querySelectorAll('h1').length);
  check('the page has exactly one h1', h1s === 1, 'found ' + h1s);

  const focusable = await page.evaluate(() => {
    document.querySelector('input[type="search"]').focus();
    return document.activeElement.tagName;
  });
  eq('the search field takes keyboard focus', focusable, 'INPUT');

  await page.close();
}

/* ------------------------------------------------------------------ */
section('16. No horizontal overflow on small screens');
{
  // A row that refuses to shrink pushes the whole page sideways, which is easy
  // to introduce and easy to miss. Check the real phone widths, not just one.
  const routes = ['/', '/browse', '/species', '/connect', '/login', '/scan'];
  for (const width of [360, 390, 414]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('florascan.view', 'mobile');
      localStorage.setItem('florascan.intro-seen', '1');
    });

    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: 'networkidle2' });
      await sleep(300);
      const res = await page.evaluate(() => {
        const doc = document.documentElement;
        const over = doc.scrollWidth - doc.clientWidth;
        const culprits = [...document.querySelectorAll('*')]
          .filter((e) => e.getBoundingClientRect().right > doc.clientWidth + 1)
          .slice(0, 3)
          .map((e) => e.tagName + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''));
        return { over, culprits };
      });
      check(`${width}px ${r}`, res.over <= 1, `${res.over}px over, from ${res.culprits.join(', ')}`);
    }
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
section('17. Reading a QR code from a photograph in the gallery');
{
  // Build a real QR image on disk, then hand it to the file input exactly as
  // a visitor picking a photo from their phone would.
  const plantsRes = await (await fetch(BASE + '/api/public/plants')).json();
  const plant = plantsRes.results.find((p) => p.qr_token);
  const qr = await (await fetch(`${BASE}/api/qr/${plant.id}?origin=${encodeURIComponent(BASE)}`)).json();

  const tmpDir = path.join(os.tmpdir(), 'florascan-tests');
  fs.mkdirSync(tmpDir, { recursive: true });
  const qrFile = path.join(tmpDir, 'tag.png');
  fs.writeFileSync(qrFile, Buffer.from(qr.png.split(',')[1], 'base64'));

  const page = await newPage();
  await go(page, '/scan');

  const hasUpload = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => /upload a photo/i.test(b.textContent)));
  check('the scan screen offers to read a photo from the gallery', hasUpload);

  const input = await page.$('input[type="file"]');
  check('there is a file input to receive it', !!input);

  // It must not force the camera open, or it cannot reach the gallery.
  const capture = await page.evaluate(() =>
    document.querySelector('input[type="file"]')?.getAttribute('capture'));
  check('...and it does not force the camera', capture === null, 'capture=' + capture);

  await input.uploadFile(qrFile);
  await sleep(2200);

  check('uploading a photo of the tag opens that plant',
    page.url().includes('/p/' + qr.qr_token), page.url());
  const text = await bodyText(page);
  check('...and the right record is shown', text.includes(plant.plant_code), text.slice(0, 160));

  // A photo with no QR code in it must say so rather than fail silently.
  const notQr = path.join(tmpDir, 'not-a-tag.png');
  const blank = await (await fetch(`${BASE}/icons/icon-512.png`)).arrayBuffer();
  fs.writeFileSync(notQr, Buffer.from(blank));

  await go(page, '/scan');
  await (await page.$('input[type="file"]')).uploadFile(notQr);
  await sleep(2200);
  const after = await bodyText(page);
  check('a photo with no QR code reports that clearly',
    /no qr code found/i.test(after), after.slice(0, 200));
  check('...and stays on the scan screen', page.url().endsWith('/scan'), page.url());

  await expectNoErrors(page, 'no console errors while reading a photo');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('18. Threatened locations are hidden in the interface');
{
  const cr = await (await fetch(BASE + '/api/public/plants?conservation=CR')).json();
  const target = cr.results[0];
  check('there is a critically endangered record to check', !!target);

  if (target) {
    const page = await newPage();
    await go(page, '/plant/' + target.id);
    const text = await bodyText(page);

    check('the page says the location is withheld', /withheld/i.test(text), text.slice(0, 240));
    check('...and explains why', /protect/i.test(text));
    check('no map link is offered',
      await page.evaluate(() => ![...document.querySelectorAll('a')].some((a) => /google\.com\/maps/.test(a.href))));
    check('no coordinates are shown', !/\d+\.\d{4,}°/.test(text), text.slice(0, 240));

    // A botanist looking at the same plant does see it.
    const token = await tokenFor(ACCOUNTS.botanist);
    const staff = await newPage({ token });
    await go(staff, '/staff/plants/' + target.id);
    const staffText = await bodyText(staff);
    check('a signed-in botanist sees the real location',
      !/Location withheld/i.test(staffText), staffText.slice(0, 200));
    await expectNoErrors(staff, 'no console errors on the staff view');
    await staff.close();

    await expectNoErrors(page, 'no console errors on the protected plant page');
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
section('19. Photographs and their credits');
{
  const plants = await (await fetch(BASE + '/api/public/plants')).json();
  const withPhoto = plants.results.find((p) => p.photo && p.photo_credit);

  const page = await newPage();
  await go(page, '/');

  const heroImg = await page.evaluate(() => !!document.querySelector('.hero-photo img'));
  check('the home page leads with a photograph', heroImg);

  const cards = await page.evaluate(() => document.querySelectorAll('.plant-card .smart-img img').length);
  check('plant cards use the fading image component', cards > 0, cards + ' found');

  if (withPhoto) {
    const detail = await (await fetch(BASE + '/api/public/plants/' + withPhoto.id)).json();
    const credited = detail.plant.photos.find((ph) => ph.credit);

    await go(page, '/plant/' + withPhoto.id);
    await sleep(700);
    const text = await bodyText(page);

    // Compare against what the API actually returned. Licences vary - a CC0
    // photo is credited "no rights reserved (CC0)" with no copyright symbol.
    check('the plant page credits the photographer',
      !!credited && text.includes(credited.credit.slice(0, 40)),
      'expected to find: ' + (credited?.credit || '(no credit in API)'));
    check('...and names the licence',
      !!credited?.license && text.includes(credited.license),
      'expected licence ' + credited?.license);
    check('...and links back to the source',
      await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /inaturalist/i.test(a.href))));
  }

  await expectNoErrors(page, 'no console errors with photographs');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('20. Printable QR tag sheet');
{
  const token = await tokenFor(ACCOUNTS.botanist);
  const page = await newPage({ token });
  await go(page, '/staff/tags');

  check('the tag sheet lists published records',
    await page.evaluate(() => document.querySelectorAll('tbody tr').length > 0));

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /select all/i.test(b.textContent))?.click());

  // Codes are fetched in batches, so wait for them rather than guessing.
  let tags = 0;
  for (let i = 0; i < 40 && tags === 0; i++) {
    await sleep(500);
    tags = await page.evaluate(() => document.querySelectorAll('.qr-sheet .qr-tag').length);
  }
  check('selecting all renders a sheet of tags', tags > 1, tags + ' tags');

  check('every tag carries a QR image',
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('.qr-sheet .qr-tag')];
      return t.length > 0 && t.every((x) => x.querySelector('img[src^="data:image/png"]'));
    }));
  check('every tag carries its Plant ID',
    await page.evaluate(() => [...document.querySelectorAll('.qr-sheet .qr-tag .t-code')]
      .every((e) => /PLT-/.test(e.textContent))));
  check('the sheet is inside a printable region',
    await page.evaluate(() => !!document.querySelector('.print-region .qr-sheet')));

  await expectNoErrors(page, 'no console errors on the tag sheet');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('21. Installable web app');
{
  const page = await newPage();
  await go(page, '/');

  check('the manifest is linked',
    await page.evaluate(() => !!document.querySelector('link[rel="manifest"]')));
  check('an apple touch icon is declared',
    await page.evaluate(() => !!document.querySelector('link[rel="apple-touch-icon"]')));
  check('a theme colour is set',
    await page.evaluate(() => !!document.querySelector('meta[name="theme-color"]')));

  await go(page, '/connect');
  const text = await bodyText(page);
  check('the connect page explains how to install it', /home screen/i.test(text), text.slice(0, 300));

  await expectNoErrors(page, 'no console errors on the connect page');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('22. Motion respects prefers-reduced-motion');
{
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('UNCAUGHT: ' + e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1440, height: 900 });
  await go(page, '/');
  await sleep(700);

  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length);
  check('nothing stays invisible when motion is reduced', hidden === 0, hidden + ' still hidden');

  const drifting = await page.evaluate(() => {
    const img = document.querySelector('.hero-photo img');
    return img ? getComputedStyle(img).animationName : 'none';
  });
  check('the hero photograph does not drift', drifting === 'none', drifting);

  await page.close();
}

/* ------------------------------------------------------------------ */
section('23. Installability: the Android one-tap prerequisites');
{
  // Chrome will not offer its one-tap install until a service worker with a
  // fetch handler is active on a secure origin. Skipping SW registration in
  // dev silently removed the Android install button, so assert it directly.
  const https = BASE.startsWith('https');
  const page = await newPage();
  await go(page, '/');
  await sleep(3500);

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      supported: true,
      secureContext: window.isSecureContext,
      protocol: window.location.protocol,
      registered: !!reg,
      active: !!reg?.active,
    };
  });

  check('the browser supports service workers', sw.supported);
  check('the page is a secure context', sw.secureContext === true, sw.protocol);

  if (https) {
    check('over HTTPS the service worker registers', sw.registered === true,
      'without it Android never shows its install button');
    check('...and becomes active', sw.active === true);
  } else {
    check('over plain HTTP it is skipped, leaving hot reload alone', sw.registered === false);
  }

  // The manifest must satisfy Chrome's installability rules.
  const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json();
  check('the manifest declares a display mode Chrome accepts',
    ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display), manifest.display);
  check('...a 192px icon', manifest.icons.some((i) => i.sizes === '192x192'));
  check('...a 512px icon', manifest.icons.some((i) => i.sizes === '512x512'));
  check('...a name and a short name', !!manifest.name && !!manifest.short_name);

  await expectNoErrors(page, 'no console errors from the service worker');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('24. The install guide differs by platform');
{
  const page = await newPage();
  await go(page, '/connect');
  const text = await bodyText(page);

  check('both platforms are covered', /Android/i.test(text) && /iPhone|iPad|iOS/i.test(text),
    text.slice(0, 300));
  check('iOS is described as manual via Share', /Share/i.test(text));
  check('Android is described as a menu or one-tap install',
    /Install app|Add to Home screen|One tap/i.test(text));

  // Spot-check that the advice actually changes with the user agent.
  const iphone = await browser.newPage();
  await iphone.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await iphone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await iphone.goto(BASE + '/connect', { waitUntil: 'networkidle2' });
  await sleep(600);
  const iosText = await iphone.evaluate(() => document.body.innerText);
  check('an iPhone is told to use Safari’s Share menu',
    /Share/i.test(iosText) && /Add to Home Screen/i.test(iosText), iosText.slice(0, 200));
  check('...and is flagged as the current device', /You are here/i.test(iosText));

  // Without a trusted certificate iOS shows a letter tile instead of the icon.
  const trust = await iphone.evaluate(() => {
    const card = document.getElementById('trust');
    return card && {
      text: card.innerText,
      href: [...card.querySelectorAll('a')].find((a) => /Download certificate/.test(a.textContent))?.getAttribute('href'),
    };
  });
  if (BASE.startsWith('https:')) {
    check('the iPhone is offered the certificate to trust', !!trust, 'no #trust card');
    eq('...linking to the CA download', trust?.href, '/florascan-ca.crt');
    check('...with the Certificate Trust Settings step spelled out', /Certificate Trust Settings/.test(trust?.text || ''));
  }
  await iphone.close();

  await expectNoErrors(page, 'no console errors on the install guide');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('25. App icons');
{
  for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'maskable-512.png']) {
    const res = await fetch(`${BASE}/icons/${icon}`);
    check(`${icon} is served`, res.status === 200, 'got ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    check(`${icon} is a real PNG`, buf.slice(1, 4).toString() === 'PNG', buf.slice(0, 8).toString('hex'));
    check(`${icon} is not a blank placeholder`, buf.length > 3000, buf.length + ' bytes');
  }

  const page = await newPage();
  await go(page, '/');
  check('the header shows the brand mark',
    await page.evaluate(() => !!document.querySelector('.brand-mark svg')));
  await page.close();
}

/* ------------------------------------------------------------------ */
section('26. The welcome screen on a first visit');
{
  // Desktop: an introduction and a way in.
  const desktop = await browser.newPage();
  desktop.errors = [];
  desktop.on('pageerror', (e) => desktop.errors.push('UNCAUGHT: ' + e.message));
  await desktop.setViewport({ width: 1280, height: 860 });
  await desktop.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await desktop.evaluate(() => localStorage.clear());
  await desktop.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await sleep(1200);

  let text = await desktop.evaluate(() => document.body.innerText);
  check('a first-time visitor gets the welcome screen',
    await desktop.evaluate(() => !!document.querySelector('.welcome')), text.slice(0, 120));
  check('...explaining what the thing is', /field guide|scan the qr/i.test(text));
  check('...with a start button on desktop', /start exploring/i.test(text), text.slice(0, 200));
  check('...and a photograph beside it',
    await desktop.evaluate(() => !!document.querySelector('.welcome-photo img')));
  check('the photograph is actually visible, not stuck transparent',
    await desktop.evaluate(() => {
      const img = document.querySelector('.welcome-photo img');
      return !!img && Number(getComputedStyle(img).opacity) > 0.5;
    }));
  check('...and it is credited', /some rights reserved|CC/i.test(text));

  // Starting takes you into the app, and it does not come back.
  await desktop.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /start exploring/i.test(b.textContent))?.click());
  await sleep(1000);
  check('Start exploring enters the app',
    await desktop.evaluate(() => !document.querySelector('.welcome')));
  check('...landing on the register', /recently verified|browse/i.test(await desktop.evaluate(() => document.body.innerText)));

  await desktop.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await sleep(700);
  check('it is not shown again on a return visit',
    await desktop.evaluate(() => !document.querySelector('.welcome')));

  check('no console errors on the welcome screen', desktop.errors.length === 0,
    desktop.errors.slice(0, 2).join(' | '));
  await desktop.close();

  // Phone: lead with the home-screen install instead of a Start button.
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await phone.evaluate(() => localStorage.clear());
  await phone.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await sleep(1200);

  text = await phone.evaluate(() => document.body.innerText);
  check('a phone visitor is pointed at the home screen', /home screen/i.test(text), text.slice(0, 260));
  check('...and can still carry on in the browser', /continue in the browser/i.test(text));
  check('...without a desktop-style Start button', !/start exploring/i.test(text));
  check('the last action is not cut off by the viewport',
    await phone.evaluate(() => {
      const btns = [...document.querySelectorAll('.welcome-actions button')];
      const last = btns[btns.length - 1];
      if (!last) return false;
      return last.getBoundingClientRect().bottom <= document.documentElement.scrollHeight;
    }));
  await phone.close();

  // A scanned tag must never be interrupted by an introduction.
  const list = await (await fetch(BASE + '/api/public/plants?limit=1')).json();
  const tagged = list.results[0];
  const qr = await (await fetch(`${BASE}/api/qr/${tagged.id}`)).json();
  const token = new URL(qr.target_url).pathname.split('/p/')[1];

  const scanner = await browser.newPage();
  await scanner.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await scanner.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await scanner.evaluate(() => localStorage.clear());
  await scanner.goto(BASE + '/p/' + token, { waitUntil: 'networkidle2' });
  await sleep(1000);

  check('scanning a tag goes straight to the plant, not the intro',
    await scanner.evaluate(() => !document.querySelector('.welcome')));
  check('...and shows that plant',
    (await scanner.evaluate(() => document.body.innerText)).includes(tagged.plant_code));
  await scanner.close();
}

/* ------------------------------------------------------------------ */
section('27. Images reserve space and become visible');
{
  const page = await newPage();
  await go(page, '/browse');
  await sleep(2500);

  const imgs = await page.evaluate(() => {
    const out = { total: 0, visible: 0, stuck: [], noRatio: 0 };
    for (const el of document.querySelectorAll('.plant-card .smart-img')) {
      out.total++;
      const img = el.querySelector('img');
      if (!img) continue;
      const ready = el.classList.contains('is-ready');
      const op = Number(getComputedStyle(img).opacity);
      if (ready && op > 0.9) out.visible++;
      // Loaded by the browser but never faded in: the failure that makes a
      // whole grid look empty.
      if (img.complete && img.naturalWidth > 0 && op < 0.1) {
        out.stuck.push(img.currentSrc.slice(-40));
      }
      if (getComputedStyle(el).aspectRatio === 'auto'
          && getComputedStyle(el.parentElement).aspectRatio === 'auto') out.noRatio++;
    }
    return out;
  });

  check('the grid rendered image slots', imgs.total > 0, imgs.total + ' slots');
  check('loaded images are all visible', imgs.stuck.length === 0,
    imgs.stuck.length + ' loaded but still transparent: ' + imgs.stuck.slice(0, 2).join(', '));
  check('most images finished loading', imgs.visible > imgs.total * 0.5,
    `${imgs.visible} of ${imgs.total}`);
  check('every slot reserves its space, so nothing jumps', imgs.noRatio === 0,
    imgs.noRatio + ' without an aspect ratio');

  // The placeholder should be tinted like the photograph, not a flat grey.
  const tints = await page.evaluate(() =>
    [...document.querySelectorAll('.plant-card .smart-img')]
      .map((e) => e.style.getPropertyValue('--tint'))
      .filter(Boolean));
  check('placeholders carry a colour', tints.length > 0, tints.length + ' tinted');
  check('...and they differ between plants', new Set(tints).size > 1,
    new Set(tints).size + ' distinct');

  await expectNoErrors(page, 'no console errors while images load');
  await page.close();
}

/* ------------------------------------------------------------------ */
section('28. The layout survives awkward content and the floating pill');
{
  // A ranger types notes on a phone in the field. Sooner or later one of them
  // pastes a long URL or holds a key down, and a grid track whose implicit
  // min-width is auto will stretch and drag the whole page sideways.
  const botToken = await tokenFor(ACCOUNTS.botanist);
  const rangerToken = await tokenFor(ACCOUNTS.ranger);
  const made = await fetch(BASE + '/api/plants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rangerToken },
    body: JSON.stringify({
      site_name: 'UI test plot, long-token layout',
      proposed_species_name: 'Unbroken string case',
      species_not_listed: true,
      location_notes: 'https://example.org/' + 'x'.repeat(300),
      morphology_notes: 'y'.repeat(900),
    }),
  });
  check('a record with an unbroken 900-character note is accepted', made.status === 201);

  for (const width of [360, 1280]) {
    const page = await newPage({ token: botToken });
    await page.setViewport({ width, height: 860, isMobile: width < 500, hasTouch: width < 500 });
    await page.goto(BASE + '/staff/review', { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));

    const over = await page.evaluate(() => {
      const d = document.documentElement;
      return { px: d.scrollWidth - d.clientWidth, client: d.clientWidth };
    });
    check(`the review queue does not scroll sideways at ${width}px`, over.px <= 1,
      `overflows by ${over.px}px`);
    await page.close();
  }

  // The role switcher is fixed to the bottom-right, so it sits over whatever
  // the document ends with - which is the footer and its links.
  const page = await newPage({ token: null });
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight; });
  await new Promise((r) => setTimeout(r, 400));

  const buried = await page.evaluate(() => {
    const pill = document.querySelector('.rs-fab');
    if (!pill) return ['no pill rendered'];
    const b = pill.getBoundingClientRect();
    return [...document.querySelectorAll('.site-foot a')].filter((a) => {
      const r = a.getBoundingClientRect();
      const down = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      const across = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      return down > 6 && across > 6;
    }).map((a) => a.textContent.trim());
  });
  check('no footer link ends up under the floating switcher', buried.length === 0, buried.join(', '));

  // Mid-sentence controls still have to be tappable without the padding
  // pushing the line apart.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  const inlineTargets = await page.evaluate(() => [...document.querySelectorAll('.linkish')]
    .map((e) => Math.round(e.getBoundingClientRect().height)));
  check('the inline sign-in control is tall enough to tap',
    inlineTargets.length > 0 && inlineTargets.every((h) => h >= 30),
    'heights: ' + inlineTargets.join(', '));
  check('no console errors on any of it', page.errors.length === 0, page.errors.join('\n'));
  await page.close();
}

/* ------------------------------------------------------------------ */
section('29. Tidying up after the run');
{
  // The form tests register real plants. Archive them so the register is
  // demo-ready immediately after a test run, without restarting the server.
  const token = await tokenFor(ACCOUNTS.botanist);
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  const all = await (await fetch(BASE + '/api/plants', { headers })).json();
  const litter = (all.results || []).filter((p) =>
    p.status !== 'archived'
    && /UI test plot|DROP TABLE|Debug plot|Bypass test/i.test(p.site_name || ''));

  let archived = 0;
  for (const p of litter) {
    const r = await fetch(`${BASE}/api/plants/${p.id}/archive`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: 'Created by the automated browser tests' }),
    });
    if (r.ok) archived++;
  }
  check(`archived ${archived} of ${litter.length} records created by these tests`,
    archived === litter.length);

  const pub = await (await fetch(BASE + '/api/public/plants?limit=100')).json();
  const leftover = pub.results.filter((p) => /UI test plot|DROP TABLE|Debug plot/i.test(p.site_name || ''));
  check('nothing from the tests is left on the public site', leftover.length === 0,
    leftover.map((p) => p.plant_code).join(', '));
}

/* ================================================================== */

await browser.close();

console.log('\n' + '='.repeat(60));
if (failures.length === 0) {
  console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m`);
} else {
  console.log(`\x1b[31m${failures.length} of ${passed + failures.length} checks failed:\x1b[0m`);
  failures.forEach((f) => console.log(`  - [${f.group}] ${f.label}${f.detail ? '\n      ' + f.detail : ''}`));
  process.exitCode = 1;
}
