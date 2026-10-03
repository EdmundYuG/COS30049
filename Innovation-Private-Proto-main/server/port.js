import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = path.join(root, 'proto.config.json');

// Ephemeral-ish but memorable range, clear of common dev ports (3000/5173/8080).
const MIN = 41000;
const MAX = 48999;

function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function write(cfg) {
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * Pick a random port once, then reuse it on every later run so the QR code
 * you printed and the URL you bookmarked keep working.
 * `npm run port` re-rolls it.
 */
export async function resolvePort({ reroll = false } = {}) {
  // A one-off port, e.g. a second server for the tests beside a running one.
  // Not saved, so the bookmarked port and printed QR codes stay valid.
  if (!reroll && process.env.PORT) return Number(process.env.PORT);

  const cfg = read();
  if (!reroll && cfg.port && (await isFree(cfg.port))) return cfg.port;

  for (let i = 0; i < 200; i++) {
    const port = MIN + Math.floor(Math.random() * (MAX - MIN + 1));
    if (await isFree(port)) {
      write({ ...cfg, port });
      return port;
    }
  }
  throw new Error('Could not find a free port in range ' + MIN + '-' + MAX);
}

// Run directly (`npm run port`) to re-roll the saved port.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = await resolvePort({ reroll: true });
  console.log('New random port assigned: ' + port);
}
