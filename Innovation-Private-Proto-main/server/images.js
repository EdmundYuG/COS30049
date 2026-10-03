/**
 * Procedural SVG stand-in photographs.
 *
 * A prototype needs pictures on every plant page, and we have no licensed
 * field photographs yet. Rather than hotlink stock images that break without
 * internet, each record gets a deterministic generated illustration derived
 * from its species name and the shot angle (habit / leaf / bark / flower /
 * fruit / habitat). Swap this module for real uploads later - the API shape
 * (a path in plant_photos.file_path) does not change.
 */

/* ---------------------------------------------------------------- */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function hsl(h, s, l) {
  return `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`;
}

/* ---------------------------------------------------------------- */

const ANGLES = ['habit', 'leaf', 'bark', 'flower', 'fruit', 'habitat'];

/**
 * Parse "scientific-name--angle--id.svg" back into its parts.
 */
function parseName(name) {
  const clean = String(name).replace(/\.svg$/i, '');
  const parts = clean.split('--');
  const angle = ANGLES.includes(parts[1]) ? parts[1] : 'habit';
  return { key: clean, base: parts[0] || clean, angle };
}

/* ---------------------------------------------------------------- */
/* Shared scenery                                                     */
/* ---------------------------------------------------------------- */

function backdrop(r, hue, { deep = false } = {}) {
  const top = hsl(hue - 8, 30, deep ? 16 : 30);
  const mid = hsl(hue, 34, deep ? 11 : 22);
  const bot = hsl(hue + 10, 28, deep ? 7 : 14);

  let out = `<rect width="1600" height="1200" fill="url(#sky)"/>`;
  out += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${mid}"/>
    <stop offset="1" stop-color="${bot}"/></linearGradient></defs>`;

  // Light shafts through the canopy.
  for (let i = 0; i < 4; i++) {
    const x = r() * 1600;
    const w = 90 + r() * 200;
    out += `<polygon points="${x},0 ${x + w},0 ${x + w * 1.9},1200 ${x + w * 0.5},1200"
      fill="${hsl(hue + 40, 60, 78)}" opacity="${(0.035 + r() * 0.05).toFixed(3)}"/>`;
  }
  return out;
}

/** Out-of-focus foliage discs, the bokeh that reads as depth. */
function bokeh(r, hue, count = 22, opacity = 0.16) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const cx = r() * 1600;
    const cy = r() * 1200;
    const rad = 18 + r() * 120;
    out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}"
      fill="${hsl(hue + r() * 50 - 15, 45 + r() * 25, 30 + r() * 45)}"
      opacity="${(opacity * (0.35 + r() * 0.9)).toFixed(3)}"/>`;
  }
  return out;
}

function vignetteAndGrain() {
  return `
  <defs>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.42"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>
      <feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="1600" height="1200" fill="url(#vig)"/>
  <rect width="1600" height="1200" filter="url(#grain)" opacity="0.05"/>`;
}

/* ---------------------------------------------------------------- */
/* Motifs                                                             */
/* ---------------------------------------------------------------- */

/** One leaf blade with a midrib and side veins. */
function leafBlade(r, hue, { cx, cy, len, wid, rot, light = 0 }) {
  const g = hsl(hue + r() * 16 - 8, 40 + r() * 22, 22 + light + r() * 14);
  const vein = hsl(hue + 20, 35, 40 + light);
  let veins = '';
  const pairs = 5 + Math.floor(r() * 6);
  for (let i = 1; i <= pairs; i++) {
    const t = i / (pairs + 1);
    const y = -len / 2 + len * t;
    const spread = Math.sin(t * Math.PI) * wid * 0.46;
    veins += `<path d="M0 ${y.toFixed(1)} Q ${(spread * 0.6).toFixed(1)} ${(y + len * 0.06).toFixed(1)} ${spread.toFixed(1)} ${(y + len * 0.11).toFixed(1)}"
        stroke="${vein}" stroke-width="2.2" fill="none" opacity="0.5"/>
      <path d="M0 ${y.toFixed(1)} Q ${(-spread * 0.6).toFixed(1)} ${(y + len * 0.06).toFixed(1)} ${(-spread).toFixed(1)} ${(y + len * 0.11).toFixed(1)}"
        stroke="${vein}" stroke-width="2.2" fill="none" opacity="0.5"/>`;
  }
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})">
    <path d="M0 ${-len / 2} C ${wid / 2} ${-len / 4}, ${wid / 2} ${len / 4}, 0 ${len / 2}
             C ${-wid / 2} ${len / 4}, ${-wid / 2} ${-len / 4}, 0 ${-len / 2} Z"
          fill="${g}"/>
    <line x1="0" y1="${-len / 2}" x2="0" y2="${len / 2}" stroke="${vein}" stroke-width="3.4" opacity="0.65"/>
    ${veins}
  </g>`;
}

function drawTree(r, hue) {
  let out = '';
  const baseX = 780 + (r() - 0.5) * 160;
  const trunkW = 70 + r() * 60;
  const bark = hsl(hue + 22, 18, 24);
  // Buttresses
  out += `<path d="M${baseX - trunkW * 2.2} 1200 Q ${baseX - trunkW * 0.9} 980 ${baseX - trunkW / 2} 860
    L ${baseX + trunkW / 2} 860 Q ${baseX + trunkW * 0.9} 980 ${baseX + trunkW * 2.2} 1200 Z" fill="${bark}"/>`;
  // Trunk
  out += `<path d="M${baseX - trunkW / 2} 900 Q ${baseX - trunkW * 0.35} 500 ${baseX - trunkW * 0.3} 240
    L ${baseX + trunkW * 0.3} 240 Q ${baseX + trunkW * 0.35} 500 ${baseX + trunkW / 2} 900 Z"
    fill="${hsl(hue + 22, 20, 28)}"/>`;
  // Canopy
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rad = r() * 400;
    out += `<ellipse cx="${(baseX + Math.cos(a) * rad).toFixed(0)}" cy="${(250 + Math.sin(a) * rad * 0.5).toFixed(0)}"
      rx="${(70 + r() * 130).toFixed(0)}" ry="${(45 + r() * 80).toFixed(0)}"
      fill="${hsl(hue + r() * 30 - 10, 45, 18 + r() * 26)}" opacity="0.88"/>`;
  }
  return out;
}

function drawPalm(r, hue) {
  let out = '';
  const cx = 800, cy = 1080;
  out += `<rect x="${cx - 16}" y="620" width="32" height="470" rx="14" fill="${hsl(hue + 25, 22, 26)}"/>`;
  const fronds = 9 + Math.floor(r() * 4);
  for (let i = 0; i < fronds; i++) {
    const rot = (i / fronds) * 360 + r() * 18;
    out += leafBlade(r, hue, { cx, cy: 600, len: 620 + r() * 200, wid: 200 + r() * 120, rot, light: 4 });
  }
  return out;
}

function drawHerb(r, hue) {
  let out = '';
  const cx = 800, cy = 1140;
  const n = 7 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const rot = -70 + (i / (n - 1)) * 140 + (r() - 0.5) * 14;
    out += `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin((rot * Math.PI) / 180) * 340}"
      y2="${cy - Math.cos((rot * Math.PI) / 180) * 340}" stroke="${hsl(hue + 30, 30, 26)}" stroke-width="10"/>`;
    out += leafBlade(r, hue, {
      cx: cx + Math.sin((rot * Math.PI) / 180) * 470,
      cy: cy - Math.cos((rot * Math.PI) / 180) * 470,
      len: 420 + r() * 200, wid: 250 + r() * 130, rot, light: 3,
    });
  }
  return out;
}

function drawPitcher(r, hue) {
  // Nepenthes-style traps hanging from tendrils.
  let out = '';
  for (let i = 0; i < 3; i++) {
    const x = 420 + i * 340 + (r() - 0.5) * 90;
    const y = 520 + (r() - 0.5) * 220;
    const h = 260 + r() * 130;
    const w = h * (0.42 + r() * 0.2);
    const body = hsl(hue + 35 + r() * 25, 45, 34 + r() * 12);
    out += `<path d="M${x} ${y - 180} Q ${x + 30} ${y - 90} ${x} ${y}" stroke="${hsl(hue + 20, 30, 30)}" stroke-width="9" fill="none"/>`;
    out += `<path d="M${x - w / 2} ${y} Q ${x - w / 1.5} ${y + h * 0.55} ${x - w / 2.6} ${y + h}
      Q ${x} ${y + h * 1.12} ${x + w / 2.6} ${y + h} Q ${x + w / 1.5} ${y + h * 0.55} ${x + w / 2} ${y} Z" fill="${body}"/>`;
    // Speckles
    for (let k = 0; k < 24; k++) {
      out += `<circle cx="${(x - w / 2 + r() * w).toFixed(0)}" cy="${(y + r() * h).toFixed(0)}"
        r="${(3 + r() * 7).toFixed(1)}" fill="${hsl(hue + 5, 55, 22)}" opacity="0.5"/>`;
    }
    // Peristome + lid
    out += `<ellipse cx="${x}" cy="${y}" rx="${w / 2 + 10}" ry="18" fill="${hsl(hue + 50, 55, 48)}"/>`;
    out += `<path d="M${x - w / 2} ${y - 6} Q ${x} ${y - w * 0.75} ${x + w / 2} ${y - 6} Z" fill="${hsl(hue + 45, 45, 38)}"/>`;
  }
  return out;
}

function drawRafflesia(r, hue) {
  const cx = 800, cy = 720, R = 330;
  let out = `<ellipse cx="${cx}" cy="${cy + 200}" rx="520" ry="150" fill="${hsl(hue + 25, 20, 14)}" opacity="0.8"/>`;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * R * 0.86;
    const py = cy + Math.sin(a) * R * 0.62;
    out += `<ellipse cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" rx="${R * 0.55}" ry="${R * 0.44}"
      transform="rotate(${((a * 180) / Math.PI + 90).toFixed(0)} ${px.toFixed(0)} ${py.toFixed(0)})"
      fill="${hsl(12, 58, 34 + r() * 8)}"/>`;
    for (let k = 0; k < 26; k++) {
      const wa = r() * Math.PI * 2, wr = r() * R * 0.45;
      out += `<circle cx="${(px + Math.cos(wa) * wr).toFixed(0)}" cy="${(py + Math.sin(wa) * wr * 0.8).toFixed(0)}"
        r="${(5 + r() * 12).toFixed(1)}" fill="hsl(28 45% 78%)" opacity="0.72"/>`;
    }
  }
  out += `<ellipse cx="${cx}" cy="${cy}" rx="${R * 0.46}" ry="${R * 0.36}" fill="hsl(8 48% 17%)"/>`;
  out += `<ellipse cx="${cx}" cy="${cy - 10}" rx="${R * 0.3}" ry="${R * 0.22}" fill="hsl(14 40% 26%)"/>`;
  return out;
}

function drawClimber(r, hue) {
  let out = '';
  for (let s = 0; s < 3; s++) {
    const x0 = 300 + s * 420;
    let d = `M${x0} 1200`;
    for (let y = 1200; y > -60; y -= 120) {
      d += ` Q ${(x0 + Math.sin(y / 170 + s) * 130).toFixed(0)} ${y - 60} ${(x0 + Math.sin(y / 210 + s) * 80).toFixed(0)} ${y - 120}`;
    }
    out += `<path d="${d}" stroke="${hsl(hue + 28, 26, 26)}" stroke-width="${12 + r() * 10}" fill="none"/>`;
    for (let i = 0; i < 12; i++) {
      const y = 1150 - i * 100;
      out += leafBlade(r, hue, {
        cx: x0 + Math.sin(y / 200 + s) * 110 + (r() - 0.5) * 120,
        cy: y, len: 170 + r() * 90, wid: 95 + r() * 55, rot: (r() - 0.5) * 160, light: 2,
      });
    }
  }
  return out;
}

const MOTIF = { tree: drawTree, palm: drawPalm, herb: drawHerb, shrub: drawHerb, climber: drawClimber };

function motifFor(base, r, hue) {
  if (base.startsWith('rafflesia')) return drawRafflesia(r, hue);
  if (base.startsWith('nepenthes')) return drawPitcher(r, hue);
  if (base.startsWith('licuala') || base.startsWith('calamus')) return drawPalm(r, hue);
  if (base.startsWith('etlingera') || base.startsWith('alocasia') || base.startsWith('begonia')) return drawHerb(r, hue);
  if (base.startsWith('dillenia') || base.startsWith('hoya') || base.startsWith('bulbophyllum')) return drawClimber(r, hue);
  return (MOTIF.tree)(r, hue);
}

/* ---------------------------------------------------------------- */
/* Angle compositions                                                 */
/* ---------------------------------------------------------------- */

function compose(angle, base, r, hue) {
  switch (angle) {
    case 'leaf': {
      let out = backdrop(r, hue, { deep: true }) + bokeh(r, hue, 16, 0.2);
      out += leafBlade(r, hue, { cx: 800, cy: 600, len: 980, wid: 520, rot: 18 + r() * 24, light: 12 });
      out += leafBlade(r, hue, { cx: 380, cy: 950, len: 520, wid: 280, rot: -40, light: 2 });
      return out;
    }
    case 'bark': {
      let out = `<rect width="1600" height="1200" fill="${hsl(hue + 24, 16, 20)}"/>`;
      for (let i = 0; i < 90; i++) {
        const x = r() * 1600;
        out += `<path d="M${x.toFixed(0)} -20 q ${((r() - 0.5) * 90).toFixed(0)} 400 ${((r() - 0.5) * 70).toFixed(0)} 1240"
          stroke="${hsl(hue + 20 + r() * 20, 14 + r() * 16, 12 + r() * 30)}"
          stroke-width="${(3 + r() * 26).toFixed(1)}" fill="none" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`;
      }
      for (let i = 0; i < 26; i++) {
        out += `<ellipse cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 1200).toFixed(0)}"
          rx="${(10 + r() * 60).toFixed(0)}" ry="${(6 + r() * 26).toFixed(0)}"
          fill="${hsl(hue + 50, 22, 42)}" opacity="${(0.1 + r() * 0.22).toFixed(2)}"/>`;
      }
      return out;
    }
    case 'flower': {
      let out = backdrop(r, hue, { deep: true }) + bokeh(r, hue, 24, 0.22);
      const cx = 800, cy = 560;
      const petals = 5 + Math.floor(r() * 4);
      const ph = base.startsWith('etlingera') ? 340 : base.startsWith('rafflesia') ? 10 : 48 + r() * 60;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        const px = cx + Math.cos(a) * 190;
        const py = cy + Math.sin(a) * 190;
        out += `<ellipse cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" rx="215" ry="130"
          transform="rotate(${((a * 180) / Math.PI).toFixed(0)} ${px.toFixed(0)} ${py.toFixed(0)})"
          fill="${hsl(ph, 62, 58 + r() * 12)}" opacity="0.94"/>`;
      }
      out += `<circle cx="${cx}" cy="${cy}" r="112" fill="${hsl(ph + 30, 55, 42)}"/>`;
      for (let i = 0; i < 40; i++) {
        const a = r() * Math.PI * 2, rr = r() * 100;
        out += `<circle cx="${(cx + Math.cos(a) * rr).toFixed(0)}" cy="${(cy + Math.sin(a) * rr).toFixed(0)}"
          r="${(4 + r() * 9).toFixed(1)}" fill="${hsl(48, 70, 70)}" opacity="0.8"/>`;
      }
      out += leafBlade(r, hue, { cx: 330, cy: 980, len: 560, wid: 300, rot: -32, light: 0 });
      out += leafBlade(r, hue, { cx: 1290, cy: 1020, len: 480, wid: 260, rot: 38, light: 0 });
      return out;
    }
    case 'fruit': {
      let out = backdrop(r, hue, { deep: true }) + bokeh(r, hue, 18, 0.2);
      const fh = 18 + r() * 30;
      for (let i = 0; i < 4 + Math.floor(r() * 3); i++) {
        const cx = 420 + r() * 780;
        const cy = 480 + r() * 460;
        const rad = 110 + r() * 110;
        out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}"
          fill="${hsl(fh, 60, 40 + r() * 14)}"/>`;
        for (let k = 0; k < 30; k++) {
          const a = r() * Math.PI * 2, d = rad * (0.4 + r() * 0.6);
          out += `<circle cx="${(cx + Math.cos(a) * d).toFixed(0)}" cy="${(cy + Math.sin(a) * d).toFixed(0)}"
            r="${(4 + r() * 10).toFixed(1)}" fill="${hsl(fh - 10, 55, 28)}" opacity="0.55"/>`;
        }
      }
      out += leafBlade(r, hue, { cx: 250, cy: 1010, len: 520, wid: 270, rot: -46, light: 0 });
      return out;
    }
    case 'habitat': {
      let out = backdrop(r, hue);
      for (let layer = 0; layer < 4; layer++) {
        const l = 10 + layer * 7;
        let d = `M0 1200 L0 ${700 - layer * 60}`;
        for (let x = 0; x <= 1600; x += 80) {
          d += ` L${x} ${(700 - layer * 60 + Math.sin(x / 130 + layer * 2) * 70 + r() * 40).toFixed(0)}`;
        }
        d += ' L1600 1200 Z';
        out += `<path d="${d}" fill="${hsl(hue + layer * 6, 34, l)}" opacity="0.92"/>`;
      }
      for (let i = 0; i < 9; i++) {
        const x = r() * 1600;
        out += `<rect x="${x.toFixed(0)}" y="${(200 + r() * 200).toFixed(0)}" width="${(16 + r() * 36).toFixed(0)}"
          height="900" fill="${hsl(hue + 22, 18, 12 + r() * 10)}" opacity="0.85"/>`;
      }
      out += bokeh(r, hue, 14, 0.14);
      return out;
    }
    default: {
      // habit
      let out = backdrop(r, hue) + bokeh(r, hue, 14, 0.13);
      out += `<path d="M0 1050 Q 400 990 800 1030 T 1600 1010 L1600 1200 L0 1200 Z" fill="${hsl(hue + 28, 26, 13)}"/>`;
      out += motifFor(base, r, hue);
      return out;
    }
  }
}

/* ---------------------------------------------------------------- */

export function renderPhoto(name) {
  const { key, base, angle } = parseName(name);
  const seed = hash(key);
  const r = rng(seed);
  const hue = 95 + (seed % 60) - 20; // green band, shifted per species

  const body = compose(angle, base, r, hue);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" width="1600" height="1200"
    role="img" aria-label="Illustrative stand-in image (${angle}) for ${base.replace(/-/g, ' ')}">
  ${body}
  ${vignetteAndGrain()}
  <g opacity="0.55">
    <rect x="1216" y="1116" width="352" height="46" rx="10" fill="#000" opacity="0.45"/>
    <text x="1392" y="1146" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22"
      fill="#fff" text-anchor="middle" letter-spacing="0.6">Illustrative placeholder</text>
  </g>
</svg>`;
}

export { ANGLES };
