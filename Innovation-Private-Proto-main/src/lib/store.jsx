import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setToken, getToken, ApiError } from './api.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const THEME_KEY = 'florascan.theme';
const VIEW_KEY = 'florascan.view';

// Browser chrome colour (Android address bar, installed-app title bar) for a
// theme chosen by hand. On "system" the media-qualified tags in index.html apply.
const THEME_COLOR = { light: '#f7f6f2', dark: '#0f2a1a' };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    if (meta.dataset.auto === undefined) meta.dataset.auto = meta.content;
    meta.content = theme === 'system' ? meta.dataset.auto : THEME_COLOR[theme];
  }
}

export function AppProvider({ children }) {
  const [boot, setBoot] = useState(null);
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_KEY) || 'system');

  /**
   * View mode decides which shell renders: the desktop website or the
   * phone app. It follows the viewport by default but can be forced, so the
   * team can demo the Android layout on a laptop.
   */
  const [viewPref, setViewPref] = useState(() => localStorage.getItem(VIEW_KEY) || 'auto');
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 860px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback((t) => {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  }, []);

  const setView = useCallback((v) => {
    localStorage.setItem(VIEW_KEY, v);
    setViewPref(v);
  }, []);

  const mobile = viewPref === 'auto' ? narrow : viewPref === 'mobile';

  /* ---------------- toasts ---------------- */
  const seq = useRef(0);
  const toast = useCallback((message, kind = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3800);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* ---------------- bootstrap ---------------- */
  const refreshCounts = useCallback(async () => {
    if (!getToken()) { setCounts(null); return; }
    try { setCounts(await api.counts()); } catch { setCounts(null); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.bootstrap();
        setBoot(b);
      } catch (e) {
        console.error('bootstrap failed', e);
      }
      if (getToken()) {
        try {
          const { user: u } = await api.me();
          setUser(u);
          if (u) await refreshCounts();
          else setToken(null);
        } catch {
          setToken(null);
        }
      }
      setReady(true);
    })();
  }, [refreshCounts]);

  /* ---------------- auth ---------------- */
  const applySession = useCallback(async (res) => {
    setToken(res.token);
    setUser(res.user);
    await refreshCounts();
    // The demo roster shows who is active, so keep it fresh after admin edits.
    try { setBoot(await api.bootstrap()); } catch { /* non-fatal */ }
    return res.user;
  }, [refreshCounts]);

  const signIn = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    return applySession(res);
  }, [applySession]);

  const switchRole = useCallback(async (userId) => {
    const res = await api.switchRole(userId);
    return applySession(res);
  }, [applySession]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* already gone */ }
    setToken(null);
    setUser(null);
    setCounts(null);
  }, []);

  const can = useCallback((code) => !!user?.permissions?.includes(code), [user]);

  /** Wrap an action so API errors surface as a toast instead of a blank screen. */
  const run = useCallback(async (fn, { success } = {}) => {
    try {
      const out = await fn();
      if (success) toast(success, 'ok');
      return out;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'err');
      throw e;
    }
  }, [toast]);

  const value = useMemo(() => ({
    boot, setBoot, user, setUser, counts, refreshCounts, ready,
    toasts, toast, dismissToast,
    theme, setTheme, viewPref, setView, mobile, narrow,
    signIn, signOut, switchRole, can, run,
  }), [boot, user, counts, refreshCounts, ready, toasts, toast, dismissToast,
       theme, setTheme, viewPref, setView, mobile, narrow, signIn, signOut, switchRole, can, run]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
