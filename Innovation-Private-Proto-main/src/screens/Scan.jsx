import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Notice, Empty, PageHead } from '../components/ui.jsx';
import * as I from '../lib/icons.jsx';

/**
 * In-app QR scanner.
 *
 * The scanner is a convenience, not a dependency: the tags encode an ordinary
 * https URL, so any phone camera opens the plant page without the app. That is
 * also why we can fall back to a tag picker when the browser refuses camera
 * access, which it does on plain http:// over the LAN.
 */
export default function Scan() {
  const navigate = useNavigate();
  const { toast } = useApp();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const handledRef = useRef(false);

  const fileRef = useRef(null);

  const [state, setState] = useState('idle'); // idle | starting | scanning | denied | unsupported
  const [message, setMessage] = useState(null);
  const [samples, setSamples] = useState([]);
  const [reading, setReading] = useState(false);

  const secure = window.isSecureContext;

  /* Demo fallback: a few real tags from the register. */
  useEffect(() => {
    api.publicPlants({ sort: 'popular' })
      .then((r) => setSamples(r.results.filter((p) => p.qr_token).slice(0, 6)))
      .catch(() => {});
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleResult = useCallback((text) => {
    if (handledRef.current) return;
    handledRef.current = true;
    stop();

    // Accept a full URL from the tag, or a bare token if someone pasted one.
    let token = null;
    try {
      const u = new URL(text);
      const m = u.pathname.match(/\/p\/([^/?#]+)/);
      token = m?.[1] || null;
      if (!token && u.origin !== window.location.origin) {
        setMessage('That QR code points somewhere else: ' + u.origin);
        handledRef.current = false;
        setState('scanning');
        return;
      }
    } catch {
      token = /^[0-9a-f-]{20,}$/i.test(text.trim()) ? text.trim() : null;
    }

    if (!token) {
      setMessage('That code is not a FloraScan plant tag.');
      handledRef.current = false;
      return;
    }
    navigate('/p/' + token);
  }, [navigate, stop]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    // Downscale: jsQR is fast enough at ~480px and this keeps phones cool.
    const w = 480;
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 640;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    if (code?.data) handleResult(code.data);
    else rafRef.current = requestAnimationFrame(tick);
  }, [handleResult]);

  const start = useCallback(async () => {
    setMessage(null);
    if (!secure) { setState('unsupported'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setState('scanning');
      handledRef.current = false;
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setState(e.name === 'NotAllowedError' ? 'denied' : 'unsupported');
      setMessage(e.message);
    }
  }, [secure, tick]);

  useEffect(() => () => stop(), [stop]);

  /* ---------------------------------------------------------------- */
  /* Decoding a QR code out of a photograph from the gallery           */
  /* ---------------------------------------------------------------- */

  /**
   * A photo of a tag is rarely a neat crop, so try progressively: the whole
   * image at a few sizes, then the centre half, then with inversion allowed
   * for a tag photographed against a dark background.
   */
  const decodeImage = (img) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const attempt = (width, crop) => {
      const sx = crop ? img.naturalWidth * 0.25 : 0;
      const sy = crop ? img.naturalHeight * 0.25 : 0;
      const sw = crop ? img.naturalWidth * 0.5 : img.naturalWidth;
      const sh = crop ? img.naturalHeight * 0.5 : img.naturalHeight;

      const scale = Math.min(1, width / sw);
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);

      return jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' })?.data || null;
    };

    for (const width of [1000, 1600, 640]) {
      const hit = attempt(width, false);
      if (hit) return hit;
    }
    for (const width of [1000, 1600]) {
      const hit = attempt(width, true);
      if (hit) return hit;
    }
    return null;
  };

  const readFile = async (file) => {
    if (!file) return;
    setMessage(null);
    setReading(true);
    stop();
    setState('idle');
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('That file could not be opened as an image.'));
        img.src = url;
      });

      const found = decodeImage(img);
      URL.revokeObjectURL(url);

      if (!found) {
        setMessage('No QR code found in that picture. Try a straighter, closer shot with the whole code visible.');
        return;
      }
      handledRef.current = false;
      handleResult(found);
    } catch (e) {
      setMessage(e.message || 'That file could not be read.');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="page" style={{ paddingTop: 18 }}>
      <div className="wrap wrap-narrow">
        <PageHead title="Scan a plant tag" sub="Point the camera at the QR code on the tag beside the plant." />

        {state === 'scanning' || state === 'starting' ? (
          <div className="scan-stage">
            <video ref={videoRef} muted playsInline />
            <div className="scan-frame"><span /><div className="scan-line" /></div>
            {state === 'starting' && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>
                <span className="spinner" />
              </div>
            )}
          </div>
        ) : (
          <div className="card card-pad center" style={{ padding: '34px 22px' }}>
            <I.Scan style={{ width: 46, height: 46, margin: '0 auto 14px', color: 'var(--text-faint)' }} />
            {state === 'unsupported' && (
              <>
                <h3 style={{ marginBottom: 6 }}>Camera not available here</h3>
                <p className="small mute" style={{ maxWidth: '46ch', marginInline: 'auto' }}>
                  {secure
                    ? 'This browser did not offer a camera.'
                    : 'Browsers only allow camera access on HTTPS or localhost. This page is on plain http:// over the network, so the live scanner is blocked.'}
                  {' '}Any phone camera app still opens the tags directly &mdash; the in-app scanner is only a shortcut.
                </p>
                {!secure && (
                  <p className="small mute" style={{ marginTop: 10 }}>
                    To use the live camera, restart the server with <span className="mono">npm run https</span>.
                  </p>
                )}
              </>
            )}
            {state === 'denied' && (
              <>
                <h3 style={{ marginBottom: 6 }}>Camera permission was refused</h3>
                <p className="small mute">Allow camera access for this site in your browser settings, then try again.</p>
              </>
            )}
            {state === 'idle' && (
              <>
                <h3 style={{ marginBottom: 6 }}>Ready when you are</h3>
                <p className="small mute">The camera opens only while this screen is on top.</p>
              </>
            )}
            <div className="row row-wrap" style={{ justifyContent: 'center', gap: 9, marginTop: 18 }}>
              <button className="btn btn-primary" onClick={start}>
                <I.Camera /> {state === 'idle' ? 'Start camera' : 'Try again'}
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={reading}>
                {reading ? <span className="spinner" /> : <I.Image />}
                {reading ? 'Reading…' : 'Upload a photo'}
              </button>
            </div>
            <div className="tiny faint" style={{ marginTop: 10 }}>
              Already have a picture of the tag? Pick it from your gallery and we will read the code from it.
            </div>
          </div>
        )}

        {state === 'scanning' && (
          <div className="row row-wrap" style={{ justifyContent: 'center', gap: 9, marginTop: 14 }}>
            <button className="btn" onClick={() => { stop(); setState('idle'); }}><I.X /> Stop camera</button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={reading}>
              {reading ? <span className="spinner" /> : <I.Image />} Upload a photo instead
            </button>
          </div>
        )}

        {/* Deliberately no `capture` attribute: that forces the camera open,
            and the whole point here is to reach the gallery. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }}
        />

        {message && <div style={{ marginTop: 14 }}><Notice kind="warn">{message}</Notice></div>}

        {/* Fallback / demo shortcut */}
        <div className="card" style={{ marginTop: 22 }}>
          <div className="card-head">
            <h3 className="grow">Or open a tag directly</h3>
            <span className="badge badge-warn">Demo</span>
          </div>
          <div className="card-body">
            <div className="small mute" style={{ marginBottom: 12 }}>
              These are real tokens from the register, so they follow exactly the same path as a scanned tag.
              Useful on a laptop, or when the camera is unavailable.
            </div>
            {samples.length === 0 ? (
              <Empty icon={I.QrIcon} title="No published tags yet" />
            ) : (
              <div style={{ display: 'grid', gap: 7 }}>
                {samples.map((p) => (
                  <button
                    key={p.id}
                    className="rs-item"
                    style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
                    onClick={() => navigate('/p/' + p.qr_token)}
                  >
                    <span style={{ width: 34, height: 34, borderRadius: 7, overflow: 'hidden', background: 'var(--surface-3)', flex: 'none' }}>
                      {p.photo && <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="nm sci truncate">{p.scientific_name}</span>
                      <span className="rl truncate">{p.plant_code} &middot; {p.site_name}</span>
                    </span>
                    <I.ChevronRight style={{ width: 15, height: 15, color: 'var(--text-faint)' }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
