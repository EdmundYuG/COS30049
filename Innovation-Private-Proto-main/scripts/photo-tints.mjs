/**
 * Average colour for every cached photograph.
 *
 * A placeholder tinted like the photograph that is about to land reads as the
 * picture arriving; a grey rectangle reads as something broken. This produces
 * `server/data/photo-tints.json`, which the API hands to the client so each
 * image can sit on its own colour while it loads.
 *
 * Chrome does the decoding, since there is no image library in this project.
 * Cheap to run: one page, every photo, one pass.
 *
 *   node scripts/photo-tints.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHOTOS = path.join(ROOT, 'server', 'data', 'photos');
const OUT = path.join(ROOT, 'server', 'data', 'photo-tints.json');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });

if (!CHROME) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(1);
}
if (!fs.existsSync(PHOTOS)) {
  console.error('No cached photos. Run "npm run import:species" first.');
  process.exit(1);
}

const files = fs.readdirSync(PHOTOS).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
if (!files.length) {
  console.error('No photographs in ' + PHOTOS);
  process.exit(1);
}
console.log(`Sampling ${files.length} photographs...`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'florascan-tints-'));

/*
 * Downscale each image to a single pixel and read it back: the browser's own
 * filtering gives the mean colour far faster than walking the pixels, and the
 * result is darkened slightly so pale photos still sit behind light text.
 */
const page = `<!doctype html><meta charset="utf-8"><body><script>
const FILES = ${JSON.stringify(files)};
const out = {};
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 1;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function sample(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        // Pull towards the dark end: the placeholder sits under a shimmer and
        // behind white captions.
        const mix = (v) => Math.round(v * 0.62);
        out[file] = '#' + [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
      } catch { /* tainted or undecodable */ }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = 'photos/' + encodeURIComponent(file);
  });
}

(async () => {
  for (const f of FILES) await sample(f);
  document.title = 'DONE ' + JSON.stringify(out);
})();
</script></body>`;

// Served from the photo directory's parent so relative paths resolve.
const pagePath = path.join(path.dirname(PHOTOS), 'tints.html');
fs.writeFileSync(pagePath, page);

try {
  const dump = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--allow-file-access-from-files',
    '--virtual-time-budget=120000',
    '--dump-dom',
    `--user-data-dir=${path.join(tmp, 'profile')}`,
    'file:///' + pagePath.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const m = dump.match(/<title>DONE ([\s\S]*?)<\/title>/);
  if (!m) throw new Error('Chrome did not report a result');

  const tints = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const count = Object.keys(tints).length;
  if (!count) throw new Error('No colours sampled (file access blocked?)');

  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    count,
    tints,
  }, null, 1) + '\n');

  console.log(`${count} of ${files.length} sampled -> server/data/photo-tints.json`);
  const sample = Object.entries(tints).slice(0, 3);
  sample.forEach(([f, c]) => console.log(`  ${c}  ${f}`));
} finally {
  fs.rmSync(pagePath, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
