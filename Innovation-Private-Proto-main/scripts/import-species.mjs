/**
 * Species importer.
 *
 * Builds `server/data/species.json` from open biodiversity databases, and
 * caches the photographs locally so the prototype still works with no
 * internet.
 *
 *   GBIF          which plants are actually recorded in Sarawak, their
 *                 accepted taxonomy, IUCN Red List category, vernacular
 *                 names, and real georeferenced coordinates
 *   iNaturalist   photographs, under Creative Commons licences, with the
 *                 photographer credited
 *   Wikipedia     a plain-language description
 *
 * Usage:
 *   node scripts/import-species.mjs              # default: 60 imported species
 *   node scripts/import-species.mjs --limit 30
 *   node scripts/import-species.mjs --no-photos
 *
 * Re-running is safe: cached photos are not downloaded twice.
 *
 * Attribution: every photograph keeps its licence code and the credit string
 * iNaturalist supplies, and both are shown on the plant page. Nothing is
 * modified, so even the CC BY-NC-ND photos are used within their terms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES as CURATED } from '../server/seed-species.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'server', 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const OUT = path.join(DATA_DIR, 'species.json');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i === -1 ? d : args[i + 1];
};
const LIMIT = Number(flag('limit', 60));
const WITH_PHOTOS = !args.includes('--no-photos');
const UA = 'FloraScan-COS30049-prototype/0.1 (university project; contact via course)';

fs.mkdirSync(PHOTO_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Polite HTTP                                                         */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** iNaturalist asks for no more than 60 requests a minute; stay well under. */
let lastINat = 0;
async function throttleINat() {
  const wait = 1100 - (Date.now() - lastINat);
  if (wait > 0) await sleep(wait);
  lastINat = Date.now();
}

async function getJson(url, { tries = 3, inat = false } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (inat) await throttleINat();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (res.status === 429) { await sleep(4000 * attempt); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (attempt === tries) {
        process.stdout.write(`\n    ! ${url.slice(0, 90)} -> ${e.message}\n`);
        return null;
      }
      await sleep(900 * attempt);
    }
  }
  return null;
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

const GBIF = 'https://api.gbif.org/v1';
const INAT = 'https://api.inaturalist.org/v1';
const WIKI = 'https://en.wikipedia.org/api/rest_v1';

/** Species keys of vascular plants recorded in Sarawak, commonest first. */
async function sarawakSpeciesKeys(count) {
  const url = `${GBIF}/occurrence/search?country=MY&stateProvince=Sarawak`
    + `&kingdomKey=6&taxonRank=SPECIES&hasCoordinate=true&hasGeospatialIssue=false`
    + `&limit=0&facet=speciesKey&facetLimit=${count * 3}`;
  const j = await getJson(url);
  const facet = j?.facets?.find((f) => f.field === 'SPECIES_KEY');
  return (facet?.counts || []).map((c) => ({ key: Number(c.name), records: c.count }));
}

async function gbifSpecies(key) {
  const j = await getJson(`${GBIF}/species/${key}`);
  if (!j || j.rank !== 'SPECIES') return null;
  // Follow synonyms to the accepted name so the register has no duplicates.
  if (j.taxonomicStatus && j.taxonomicStatus !== 'ACCEPTED' && j.acceptedKey) {
    const acc = await getJson(`${GBIF}/species/${j.acceptedKey}`);
    if (acc?.rank === 'SPECIES') return acc;
  }
  return j;
}

async function iucnCode(key) {
  const j = await getJson(`${GBIF}/species/${key}/iucnRedListCategory`);
  return j?.code || null;
}

async function vernacular(key) {
  const j = await getJson(`${GBIF}/species/${key}/vernacularNames?limit=60`);
  const rows = j?.results || [];
  const pick = (langs) => rows.find((r) => langs.includes((r.language || '').toLowerCase()))?.vernacularName || null;
  return {
    // Malay and Indonesian are close enough that an Indonesian name is a
    // useful stand-in for a local name until the client supplies their own.
    common: pick(['eng']),
    local: pick(['msa', 'may', 'zlm', 'ind']),
  };
}

/** Real coordinates inside Sarawak, used to place demo specimens. */
async function sarawakPoints(key, want = 4) {
  const j = await getJson(
    `${GBIF}/occurrence/search?speciesKey=${key}&country=MY&stateProvince=Sarawak`
    + `&hasCoordinate=true&hasGeospatialIssue=false&limit=${want}`,
  );
  return (j?.results || [])
    .filter((r) => typeof r.decimalLatitude === 'number' && typeof r.decimalLongitude === 'number')
    .map((r) => ({
      lat: Number(r.decimalLatitude.toFixed(6)),
      lon: Number(r.decimalLongitude.toFixed(6)),
      locality: r.locality || r.verbatimLocality || null,
      elevation: typeof r.elevation === 'number' ? r.elevation : null,
      year: r.year || null,
      dataset: r.datasetName || r.institutionCode || null,
    }));
}

const USABLE_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-nc', 'cc-by-sa', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd']);

async function inatTaxon(scientificName) {
  const search = await getJson(
    `${INAT}/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=5`,
    { inat: true },
  );
  const hit = (search?.results || []).find(
    (t) => t.name?.toLowerCase() === scientificName.toLowerCase(),
  );
  if (!hit) return null;

  const detail = await getJson(`${INAT}/taxa/${hit.id}`, { inat: true });
  const t = detail?.results?.[0] || hit;

  const photos = (t.taxon_photos || [])
    .map((p) => p.photo)
    .filter((p) => p && USABLE_LICENCES.has((p.license_code || '').toLowerCase()))
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      url: p.medium_url || p.url,
      large_url: p.large_url || p.medium_url || p.url,
      attribution: p.attribution || null,
      license: (p.license_code || '').toUpperCase(),
      source: 'iNaturalist',
      page: 'https://www.inaturalist.org/photos/' + p.id,
    }));

  return {
    inat_id: t.id,
    common: t.preferred_common_name || null,
    wikipedia_url: t.wikipedia_url || null,
    wikipedia_summary: t.wikipedia_summary || null,
    observations: t.observations_count || 0,
    photos,
  };
}

async function wikipedia(title) {
  if (!title) return null;
  const j = await getJson(`${WIKI}/page/summary/${encodeURIComponent(title)}`);
  if (!j || j.type === 'disambiguation' || !j.extract) return null;
  return { extract: j.extract, url: j.content_urls?.desktop?.page || null };
}

/** Rough growth form, inferred from the family and the description. */
function growthForm(family, text) {
  const t = (text || '').toLowerCase();
  if (family === 'Rafflesiaceae' || /\bholoparasit|parasitic plant/.test(t)) return 'parasite';
  if (family === 'Arecaceae') return /rattan|climbing palm/.test(t) ? 'climber' : 'palm';
  if (family === 'Nepenthaceae') return 'climber';
  if (/\bliana\b|climb|vine|scandent/.test(t)) return 'climber';
  if (/\bepiphyt/.test(t)) return 'epiphyte';
  if (/\bherb\b|herbaceous|rhizomatous/.test(t)) return 'herb';
  if (/\bshrub\b/.test(t)) return 'shrub';
  if (/\btree\b|timber|canopy|emergent/.test(t)) return 'tree';
  if (['Orchidaceae', 'Begoniaceae', 'Zingiberaceae', 'Araceae', 'Gesneriaceae'].includes(family)) return 'herb';
  if (['Dipterocarpaceae', 'Fagaceae', 'Myrtaceae', 'Moraceae', 'Lauraceae'].includes(family)) return 'tree';
  return 'shrub';
}

/* ------------------------------------------------------------------ */
/* Photo caching                                                       */
/* ------------------------------------------------------------------ */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function cachePhotos(sci, photos) {
  if (!WITH_PHOTOS) return photos.map((p) => ({ ...p, file: null }));
  const out = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const name = `${slug(sci)}-${i + 1}.jpg`;
    const ok = await download(p.url, path.join(PHOTO_DIR, name));
    out.push({ ...p, file: ok ? name : null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

console.log('FloraScan species importer');
console.log('Sources: GBIF, iNaturalist, Wikipedia\n');

const records = [];
const seen = new Set();

/* --- 1. Enrich the hand-written species ------------------------------ */

console.log(`Enriching ${CURATED.length} curated species with real photographs and IUCN status...`);

for (const c of CURATED) {
  process.stdout.write(`  ${c.scientific_name.padEnd(30)}`);
  const match = await getJson(`${GBIF}/species/match?name=${encodeURIComponent(c.scientific_name)}`);
  const key = match?.usageKey;

  const [iucn, inat] = await Promise.all([
    key ? iucnCode(key) : null,
    inatTaxon(c.scientific_name),
  ]);
  const points = key ? await sarawakPoints(key) : [];
  const photos = await cachePhotos(c.scientific_name, inat?.photos || []);

  records.push({
    ...c,
    // The hand-written conservation code stays unless GBIF has a real
    // assessment, which is better evidence than my own reading.
    conservation: iucn || c.conservation,
    conservation_source: iucn ? 'IUCN Red List via GBIF' : 'project estimate',
    gbif_key: key || null,
    inat_id: inat?.inat_id || null,
    wikipedia_url: inat?.wikipedia_url || null,
    occurrence_points: points,
    photos,
    curated: true,
  });
  seen.add(c.scientific_name.toLowerCase());
  console.log(`${(iucn || c.conservation).padEnd(3)} ${photos.filter((p) => p.file).length} photo(s) ${points.length} point(s)`);
}

/* --- 2. Import more species recorded in Sarawak ---------------------- */

console.log(`\nFinding plant species recorded in Sarawak (GBIF)...`);
const keys = await sarawakSpeciesKeys(LIMIT);
console.log(`  ${keys.length} candidate species, taking up to ${LIMIT} with usable data\n`);

let added = 0;
for (const { key, records: n } of keys) {
  if (added >= LIMIT) break;

  const sp = await gbifSpecies(key);
  if (!sp?.canonicalName || !sp.family) continue;
  const sci = sp.canonicalName;
  if (seen.has(sci.toLowerCase())) continue;
  if (sci.split(' ').length !== 2) continue; // skip hybrids and infraspecifics

  process.stdout.write(`  ${String(added + 1).padStart(2)}. ${sci.padEnd(32)}`);

  const inat = await inatTaxon(sci);
  if (!inat || inat.photos.length === 0) { console.log('no usable photo, skipped'); continue; }

  const [iucn, names, points] = await Promise.all([
    iucnCode(sp.key || key),
    vernacular(sp.key || key),
    sarawakPoints(sp.key || key),
  ]);

  const wiki = inat.wikipedia_url
    ? await wikipedia(decodeURIComponent(inat.wikipedia_url.split('/wiki/')[1] || ''))
    : null;
  const description = wiki?.extract || inat.wikipedia_summary?.replace(/<[^>]+>/g, '') || null;
  if (!description) { console.log('no description, skipped'); continue; }

  const photos = await cachePhotos(sci, inat.photos);
  if (!photos.some((p) => p.file || !WITH_PHOTOS)) { console.log('photo download failed, skipped'); continue; }

  records.push({
    scientific_name: sci,
    authorship: sp.authorship || null,
    common_name: inat.common || names.common || null,
    local_name: names.local || null,
    family: sp.family,
    genus: sp.genus || sci.split(' ')[0],
    species_epithet: sci.split(' ')[1] || null,
    growth_form: growthForm(sp.family, description),
    conservation: iucn || 'NE',
    conservation_source: iucn ? 'IUCN Red List via GBIF' : 'not evaluated',
    description,
    characteristics: null,
    leaf_description: null,
    flower_description: null,
    fruit_description: null,
    // A locality is where one record was collected, not the species' habitat.
    // Leave habitat empty rather than claim something the source does not say.
    habitat: null,
    distribution: null,
    gbif_key: sp.key || key,
    gbif_records_sarawak: n,
    inat_id: inat.inat_id,
    wikipedia_url: wiki?.url || inat.wikipedia_url || null,
    occurrence_points: points,
    photos,
    curated: false,
  });
  seen.add(sci.toLowerCase());
  added++;
  console.log(`${(iucn || 'NE').padEnd(3)} ${photos.filter((p) => p.file).length} photo(s) ${points.length} point(s)`);
}

/* --- 3. Write ------------------------------------------------------- */

const payload = {
  generated_at: new Date().toISOString(),
  sources: [
    { name: 'GBIF', url: 'https://www.gbif.org', used_for: 'taxonomy, IUCN category, vernacular names, occurrence coordinates' },
    { name: 'iNaturalist', url: 'https://www.inaturalist.org', used_for: 'photographs (Creative Commons, photographer credited)' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org', used_for: 'descriptions (CC BY-SA 4.0)' },
  ],
  region: 'Sarawak, Malaysian Borneo',
  count: records.length,
  species: records,
};

fs.writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');

const photoCount = records.reduce((n, r) => n + r.photos.filter((p) => p.file).length, 0);
const withIucn = records.filter((r) => r.conservation_source.startsWith('IUCN')).length;
const bytes = fs.readdirSync(PHOTO_DIR).reduce((n, f) => n + fs.statSync(path.join(PHOTO_DIR, f)).size, 0);

console.log('\n' + '='.repeat(56));
console.log(`${records.length} species written to server/data/species.json`);
console.log(`${photoCount} photographs cached (${(bytes / 1048576).toFixed(1)} MB)`);
console.log(`${withIucn} with a real IUCN Red List assessment`);
console.log(`${records.reduce((n, r) => n + r.occurrence_points.length, 0)} real Sarawak coordinates`);
