/**
 * Whether the visitor has seen the welcome screen.
 *
 * Kept out of the React tree so the router can decide where to send someone
 * before anything renders, and so a scanned tag is never interrupted: somebody
 * standing in front of a plant wants that plant's page, not an introduction.
 */

const KEY = 'florascan.intro-seen';

export function hasSeenIntro() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private browsing with storage blocked: show it, but never trap anyone.
    return false;
  }
}

export function markIntroSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
}

export function resetIntro() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/**
 * The welcome screen is for somebody opening the site cold. Any deeper link —
 * a scanned tag, a shared plant, a staff screen — goes where it says.
 */
export function shouldShowIntro(pathname) {
  return pathname === '/' && !hasSeenIntro();
}
