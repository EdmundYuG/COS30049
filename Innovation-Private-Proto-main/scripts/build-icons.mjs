/**
 * Builds every app icon from one drawing.
 *
 *   npm run icons
 *
 * The artwork is a QR scan frame around a leaf. It is rendered with the same
 * headless Chrome or Edge the UI tests use, so there is no image library to
 * install. Outputs:
 *
 *   public/icons/icon-192.png, icon-512.png   rounded tile, transparent corners ("any")
 *   public/icons/maskable-512.png             full bleed, artwork inside the 80% safe zone
 *   public/icons/apple-touch-icon.png         180px, full bleed and opaque: iOS rounds
 *   public/apple-touch-icon.png               the corners itself, and draws a black
 *                                             fringe around anything transparent. The root
 *                                             copy is where iOS looks when no link is found.
 *   public/icons/mark.svg                     the foreground alone, for reuse
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = (...p) => path.join(root, 'public', ...p);

/* ------------------------------------------------------------------ */
/* Artwork, on a 512 grid                                              */
/* ------------------------------------------------------------------ */

const BG = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#2b8a55"/>
      <stop offset="0.55" stop-color="#176039"/>
      <stop offset="1" stop-color="#08200f"/>
    </linearGradient>
  </defs>`;

// The leaf is drawn upright about the centre, then turned 45 degrees so the
// tip points to the top right. Side veins leave the midrib angled towards the
// tip, as real pinnate veins do, and stop well inside the blade.
const MARK = `
  <g stroke="#a8e06a" stroke-width="27" fill="none" stroke-linecap="round">
    <path d="M120 188v-44a26 26 0 0 1 26-26h44"/>
    <path d="M392 188v-44a26 26 0 0 0-26-26h-44"/>
    <path d="M120 324v44a26 26 0 0 0 26 26h44"/>
    <path d="M392 324v44a26 26 0 0 1-26 26h-44"/>
  </g>
  <g transform="rotate(45 256 256)">
    <path d="M256 348C198 318 186 214 256 160C326 214 314 318 256 348Z" fill="#ffffff"/>
    <g stroke="#1d6b40" stroke-linecap="round" fill="none">
      <path d="M256 368V184" stroke-width="11"/>
      <path d="M256 304l-26-22M256 304l26-22M256 262l-22-19M256 262l22-19M256 222l-15-13M256 222l15-13" stroke-width="7"/>
    </g>
  </g>`;

function svg({ size, rounded = false, background = true }) {
  const tile = rounded
    ? '<rect width="512" height="512" rx="112" fill="url(#bg)"/>'
    : '<rect width="512" height="512" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">`
    + (background ? BG + tile : '')
    + MARK + '</svg>';
}

const TARGETS = [
  { file: out('icons', 'icon-192.png'), size: 192, rounded: true },
  { file: out('icons', 'icon-512.png'), size: 512, rounded: true },
  { file: out('icons', 'maskable-512.png'), size: 512 },
  { file: out('icons', 'apple-touch-icon.png'), size: 180 },
  { file: out('apple-touch-icon.png'), size: 180 },
];

/* ------------------------------------------------------------------ */

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to the browser executable.');
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  for (const t of TARGETS) {
    await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg(t)}</body></html>`,
    );
    const el = await page.$('svg');
    await el.screenshot({ path: t.file, omitBackground: true });
    console.log('  wrote', path.relative(root, t.file), `${t.size}x${t.size}`);
  }
} finally {
  await browser.close();
}

fs.writeFileSync(out('icons', 'mark.svg'), svg({ size: 512, background: false }).replace(/ width="512" height="512"/, '') + '\n');
console.log('  wrote', path.join('public', 'icons', 'mark.svg'));
