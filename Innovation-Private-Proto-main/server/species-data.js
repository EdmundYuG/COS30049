import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES as CURATED } from './seed-species.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PHOTO_DIR = path.join(ROOT, 'server', 'data', 'photos');
const DATA_FILE = path.join(ROOT, 'server', 'data', 'species.json');
const TINTS_FILE = path.join(ROOT, 'server', 'data', 'photo-tints.json');

/**
 * The species list the demo is seeded from.
 *
 * Prefers `server/data/species.json`, which `npm run import:species` builds
 * from GBIF, iNaturalist and Wikipedia — real taxonomy, real IUCN categories,
 * real Sarawak coordinates and real Creative Commons photographs.
 *
 * Falls back to the hand-written list so a fresh clone still runs with no
 * network and no import step; in that case the plant pages use the generated
 * illustrations instead of photographs.
 */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(raw.species) && raw.species.length) {
      return {
        source: 'imported',
        generated_at: raw.generated_at,
        sources: raw.sources || [],
        species: raw.species,
      };
    }
  } catch {
    // No import has been run, or the file is unreadable. Fall through.
  }
  return {
    source: 'curated',
    generated_at: null,
    sources: [],
    species: CURATED.map((s) => ({
      ...s,
      conservation_source: 'project estimate',
      photos: [],
      occurrence_points: [],
      curated: true,
    })),
  };
}

export const SPECIES_DATA = load();

/**
 * Average colour per cached photograph, produced by scripts/photo-tints.mjs.
 * Used as the placeholder behind an image while it loads, so a photo resolves
 * out of its own colour instead of out of a grey box. Optional: without the
 * file the client falls back to a tint derived from the filename.
 */
function loadTints() {
  try {
    const raw = JSON.parse(fs.readFileSync(TINTS_FILE, 'utf8'));
    return raw.tints || {};
  } catch {
    return {};
  }
}

export const PHOTO_TINTS = loadTints();

/** The stored colour for a cached photo path, if we have one. */
export function tintFor(file) {
  return (file && PHOTO_TINTS[file]) || null;
}

export const hasRealPhotos = SPECIES_DATA.species.some((s) => (s.photos || []).some((p) => p.file));

/** True when the named file was actually downloaded and is on disk. */
export function photoExists(file) {
  if (!file) return false;
  // Keep the lookup inside the photo directory.
  if (file.includes('/') || file.includes('\\') || file.includes('..')) return false;
  try {
    return fs.statSync(path.join(PHOTO_DIR, file)).size > 0;
  } catch {
    return false;
  }
}
