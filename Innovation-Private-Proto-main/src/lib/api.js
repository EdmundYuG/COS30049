const TOKEN_KEY = 'florascan.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || null;
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it still running?', 0, null);
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

  if (!res.ok) {
    // A revoked or expired session should not leave a stale token behind.
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? '?' + s : '';
};

export const api = {
  get: (p, params) => request('GET', p + qs(params)),
  post: (p, body) => request('POST', p, body ?? {}),
  patch: (p, body) => request('PATCH', p, body ?? {}),

  bootstrap: () => request('GET', '/bootstrap'),
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout', {}),
  switchRole: (user_id) => request('POST', '/auth/switch', { user_id }),

  publicPlants: (params) => request('GET', '/public/plants' + qs(params)),
  publicStats: () => request('GET', '/public/stats'),
  plantByToken: (token) => request('GET', '/public/plants/token/' + encodeURIComponent(token)),
  plantById: (id) => request('GET', '/public/plants/' + id),

  species: (params) => request('GET', '/species' + qs(params)),
  speciesById: (id) => request('GET', '/species/' + id),

  plants: (params) => request('GET', '/plants' + qs(params)),
  counts: () => request('GET', '/plants/counts'),
  createPlant: (body) => request('POST', '/plants', body),
  updatePlant: (id, body) => request('PATCH', '/plants/' + id, body),
  approve: (id, note) => request('POST', `/plants/${id}/approve`, { note }),
  reject: (id, note) => request('POST', `/plants/${id}/reject`, { note }),
  archive: (id, reason) => request('POST', `/plants/${id}/archive`, { reason }),
  restore: (id) => request('POST', `/plants/${id}/restore`, {}),
  history: (id) => request('GET', `/plants/${id}/history`),

  submissions: (params) => request('GET', '/submissions' + qs(params)),
  qr: (plantId) => request('GET', `/qr/${plantId}`),

  notifications: () => request('GET', '/notifications'),
  readNotification: (id) => request('POST', `/notifications/${id}/read`, {}),
  readAllNotifications: () => request('POST', '/notifications/read-all', {}),

  reports: () => request('GET', '/reports'),
  createReport: (body) => request('POST', '/reports', body),
  resolveReport: (id, body) => request('POST', `/reports/${id}/resolve`, body),

  users: () => request('GET', '/users'),
  createUser: (body) => request('POST', '/users', body),
  updateUser: (id, body) => request('PATCH', '/users/' + id, body),
  resetPassword: (id) => request('POST', `/users/${id}/reset-password`, {}),

  activity: () => request('GET', '/activity'),
  audit: (params) => request('GET', '/audit' + qs(params)),
  adminStats: () => request('GET', '/admin/stats'),

  settings: () => request('GET', '/settings'),
  updateSetting: (key, value) => request('PATCH', '/settings/' + key, { value }),

  sensors: () => request('GET', '/sensors'),
  connect: () => request('GET', '/connect'),
};
