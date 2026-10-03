import { useEffect, useRef, useState } from 'react';

/**
 * Motion helpers.
 *
 * The rule here is that movement should explain something — that content has
 * arrived, that an image has finished loading, that a number is a running
 * total. Nothing moves just to look busy, and everything obeys
 * prefers-reduced-motion, where each effect collapses to its finished state.
 */

const reduced = () =>
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */

/**
 * Fades and lifts its children into place the first time they are scrolled
 * near. `index` staggers a list so the eye follows it left to right.
 */
export function Reveal({ children, index = 0, as: Tag = 'div', className = '', style, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => reduced());

  useEffect(() => {
    if (shown) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    if (!('IntersectionObserver' in window)) { setShown(true); return undefined; }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setShown(true); io.disconnect(); }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <Tag
      ref={ref}
      className={`reveal${shown ? ' is-in' : ''}${className ? ' ' + className : ''}`}
      style={{ '--reveal-delay': `${Math.min(index, 10) * 45}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Counts up to `value`. Used only for the headline figures, where watching
 * the number settle tells you it is a live count rather than a caption.
 */
export function CountUp({ value, duration = 900, format = (n) => n.toLocaleString('en-GB') }) {
  const [n, setN] = useState(() => (reduced() ? value : 0));
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (reduced()) { setN(value); return undefined; }
    const el = ref.current;
    if (!el) return undefined;

    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        // easeOutExpo: fast start, gentle settle
        const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        setN(Math.round(value * eased));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    if (!('IntersectionObserver' in window)) { setN(value); return undefined; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) { started.current = true; run(); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(el);

    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration]);

  return <span ref={ref} className="tabular">{format(n)}</span>;
}

/* ------------------------------------------------------------------ */

/**
 * An image that fades up once decoded, over a tinted placeholder, so a slow
 * photograph never lands as a white flash. Falls back to a generated
 * illustration if the file is missing.
 */
/**
 * A tint derived from the source path, used behind the image while it loads.
 * A photograph resolving out of a related green reads as the picture arriving;
 * the same grey box everywhere reads as something being broken.
 */
function tintFor(src) {
  if (!src) return null;
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = 95 + ((h >>> 0) % 55) - 20;
  return `hsl(${hue} 22% 26%)`;
}

export function SmartImage({
  src, alt = '', fallback, tint, className = '', ratio, style, eager = false, ...rest
}) {
  const [state, setState] = useState('loading'); // loading | ready | failed
  const [current, setCurrent] = useState(src);
  const triedFallback = useRef(false);
  const imgRef = useRef(null);

  useEffect(() => {
    setCurrent(src);
    setState('loading');
    triedFallback.current = false;
  }, [src]);

  /*
   * An image served from cache - a back-navigation, or the service worker -
   * can finish before React attaches onLoad, and the load event never fires.
   * Without this check those images stay at opacity 0 forever, which looks
   * exactly like a broken photo. So ask the element directly once it mounts.
   */
  useEffect(() => {
    const img = imgRef.current;
    if (!img || state !== 'loading') return undefined;

    let cancelled = false;
    const settle = () => { if (!cancelled) setState('ready'); };

    if (img.complete) {
      if (img.naturalWidth > 0) {
        // decode() resolves once it can be painted, so there is no half-drawn frame.
        if (img.decode) img.decode().then(settle, settle);
        else settle();
      } else if (!triedFallback.current && fallback) {
        triedFallback.current = true;
        setCurrent(fallback);
      } else {
        setState('failed');
      }
    }
    return () => { cancelled = true; };
  }, [current, state, fallback]);

  const onError = () => {
    if (fallback && !triedFallback.current) {
      triedFallback.current = true;
      setCurrent(fallback);
      return;
    }
    setState('failed');
  };

  return (
    <span
      className={[
        'smart-img',
        state === 'ready' ? 'is-ready' : '',
        state === 'failed' ? 'is-failed' : '',
        className,
      ].filter(Boolean).join(' ')}
      // A measured average beats a guess from the filename, but either is
      // better than a grey box.
      style={{ aspectRatio: ratio, '--tint': tint || tintFor(current), ...style }}
    >
      {current && (
        <img
          ref={imgRef}
          src={current}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          // The hero is the one image worth fetching ahead of everything else.
          fetchpriority={eager ? 'high' : undefined}
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.decode) img.decode().then(() => setState('ready'), () => setState('ready'));
            else setState('ready');
          }}
          onError={onError}
          {...rest}
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

/** Re-runs its entrance animation whenever `k` changes (used per route). */
export function PageTransition({ k, children }) {
  const [key, setKey] = useState(k);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (k === key) return undefined;
    if (reduced()) { setKey(k); return undefined; }
    setPhase('out');
    const t = setTimeout(() => { setKey(k); setPhase('in'); }, 110);
    return () => clearTimeout(t);
  }, [k, key]);

  return <div className={`page-fade page-fade-${phase}`} key={key}>{children}</div>;
}
