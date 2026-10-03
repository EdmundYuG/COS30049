export const CONSERVATION = {
  NE: { label: 'Not evaluated', short: 'NE', threat: false },
  DD: { label: 'Data deficient', short: 'DD', threat: false },
  LC: { label: 'Least concern', short: 'LC', threat: false },
  NT: { label: 'Near threatened', short: 'NT', threat: false },
  VU: { label: 'Vulnerable', short: 'VU', threat: true },
  EN: { label: 'Endangered', short: 'EN', threat: true },
  CR: { label: 'Critically endangered', short: 'CR', threat: true },
  EW: { label: 'Extinct in the wild', short: 'EW', threat: true },
  EX: { label: 'Extinct', short: 'EX', threat: true },
};

export const STATUS = {
  pending:  { label: 'Pending review', cls: 'badge-warn' },
  approved: { label: 'Published', cls: 'badge-ok' },
  rejected: { label: 'Returned', cls: 'badge-danger' },
  archived: { label: 'Archived', cls: 'badge-neutral' },
};

export const HEALTH = {
  healthy: 'Healthy', fair: 'Fair', poor: 'Poor', dead: 'Dead',
};

export const LIFE_STAGE = {
  seedling: 'Seedling', sapling: 'Sapling', mature: 'Mature',
};

export const GROWTH_FORM = {
  tree: 'Tree', shrub: 'Shrub', herb: 'Herb', palm: 'Palm',
  climber: 'Climber', epiphyte: 'Epiphyte', parasite: 'Parasite',
};

export const titleCase = (s) =>
  String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DTF = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
});
const DTF_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const formatDate = (iso) => (iso ? DTF.format(new Date(iso)) : '--');
export const formatDateTime = (iso) => (iso ? DTF_TIME.format(new Date(iso)) : '--');

export function relativeTime(iso) {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hrs / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  if (days < 31) {
    const w = Math.round(days / 7);
    return w + (w === 1 ? ' week ago' : ' weeks ago');
  }
  return formatDate(iso);
}

export const num = (n) => (n === null || n === undefined ? '--' : Number(n).toLocaleString('en-GB'));

export function coords(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

export const measure = (v, unit) => (v === null || v === undefined ? null : `${v} ${unit}`);

/** Where a role should land after signing in. */
export function homeFor(user) {
  if (!user) return '/';
  if (user.permissions?.includes('user.manage')) return '/staff/users';
  return '/staff/plants';
}
