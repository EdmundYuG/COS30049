import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  installAdvice, onInstallChange, promptInstall, isDismissed, dismiss, isStandalone, platform,
} from '../lib/install.js';
import { useApp } from '../lib/store.jsx';
import * as I from '../lib/icons.jsx';

/* ------------------------------------------------------------------ */

/** The iOS share glyph, so the instruction points at something recognisable. */
const ShareIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" className="ico" aria-hidden="true" {...p}>
    <path d="M12 15V3" /><path d="m8.5 6.5 3.5-3.5 3.5 3.5" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);

function useAdvice() {
  const [advice, setAdvice] = useState(() => installAdvice());
  useEffect(() => onInstallChange(() => setAdvice(installAdvice())), []);
  return advice;
}

/* ------------------------------------------------------------------ */
/* The bar that slides in near the bottom of a phone screen            */
/* ------------------------------------------------------------------ */

export default function InstallPrompt() {
  const { mobile } = useApp();
  const advice = useAdvice();
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(true);
  const [closing, setClosing] = useState(false);

  // The Connect screen already explains installing, in more detail than a bar
  // can. Two copies of the same offer on one screen is just clutter.
  const redundantHere = pathname === '/connect';

  useEffect(() => {
    if (!mobile || !advice || redundantHere || isDismissed() || isStandalone()) return undefined;
    // Let the visitor look at the page first; an instant pop-up is the most
    // annoying thing a site can do.
    const t = setTimeout(() => setHidden(false), 4000);
    return () => clearTimeout(t);
  }, [mobile, advice, redundantHere]);

  if (hidden || !advice || !mobile || redundantHere) return null;

  const close = () => {
    setClosing(true);
    dismiss();
    setTimeout(() => setHidden(true), 220);
  };

  const add = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted' || outcome === 'dismissed') close();
  };

  return (
    <div className={'install-bar no-print' + (closing ? ' is-closing' : '')} role="complementary">
      <span className="install-mark">
        <img src="/icons/icon-192.png" alt="" width="34" height="34" />
      </span>

      <div className="grow" style={{ minWidth: 0 }}>
        <div className="install-title">{advice.title}</div>
        <div className="install-body">
          {advice.kind === 'ios' ? (
            <>Tap <ShareIcon style={{ width: 13, height: 13, display: 'inline', verticalAlign: -2 }} /> below, then <strong>Add to Home Screen</strong>.</>
          ) : advice.body}
        </div>
      </div>

      {advice.kind === 'prompt' ? (
        <button className="btn btn-primary btn-sm" onClick={add}>Add</button>
      ) : (
        <button className="btn btn-sm" onClick={close}>Got it</button>
      )}
      <button className="btn btn-ghost btn-icon install-x" onClick={close} aria-label="Dismiss">
        <I.X />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The fuller version, for the Connect screen                          */
/* ------------------------------------------------------------------ */

export function InstallCard() {
  const advice = useAdvice();
  const [done, setDone] = useState(false);

  if (isStandalone()) {
    return (
      <div className="card card-pad row" style={{ gap: 12 }}>
        <span className="avatar"><I.Check style={{ width: 16, height: 16 }} /></span>
        <div>
          <h3 style={{ marginBottom: 2 }}>Running from your home screen</h3>
          <div className="small mute">You are using the installed app, not the browser.</div>
        </div>
      </div>
    );
  }
  if (!advice) return null;

  const p = platform();

  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
        <span className="install-mark" style={{ flex: 'none' }}>
          <img src="/icons/icon-192.png" alt="" width="42" height="42" />
        </span>
        <div>
          <h3 style={{ marginBottom: 3 }}>{advice.title}</h3>
          <div className="small mute">{advice.body}</div>
        </div>
      </div>

      {advice.kind === 'ios' && (
        <ol className="install-steps">
          <li><ShareIcon /> Tap the <strong>Share</strong> button in Safari&rsquo;s toolbar</li>
          <li><I.Plus /> Scroll down and choose <strong>Add to Home Screen</strong></li>
          <li><I.Check /> Tap <strong>Add</strong>, then open FloraScan from your home screen</li>
        </ol>
      )}

      {advice.kind === 'android' && (
        <ol className="install-steps">
          <li><I.Menu /> Open the browser menu (&#8942;)</li>
          <li><I.Plus /> Choose <strong>Add to Home screen</strong> or <strong>Install app</strong></li>
          <li><I.Check /> Confirm, then open it from your home screen</li>
        </ol>
      )}

      {advice.kind === 'prompt' && (
        <button
          className="btn btn-primary"
          onClick={async () => { const o = await promptInstall(); if (o === 'accepted') setDone(true); }}
        >
          <I.Download /> {advice.action}
        </button>
      )}

      {done && (
        <div style={{ marginTop: 12 }}>
          <span className="badge badge-ok"><I.Check style={{ width: 12, height: 12 }} /> Added to your home screen</span>
        </div>
      )}

      <div className="tiny faint" style={{ marginTop: 12 }}>
        {p === 'desktop'
          ? 'On a phone this is how a ranger keeps the app one tap away in the field.'
          : 'Once added it opens full screen, and pages you have already viewed still open with no signal.'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Both platforms side by side, for the walkthrough                    */
/* ------------------------------------------------------------------ */

/**
 * Android and iOS install completely differently, and during a demo you are
 * usually holding one of them while talking about the other. This shows both.
 */
export function PlatformGuides() {
  const overHttps = window.location.protocol === 'https:';
  const here = platform();

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">Adding it to a home screen</h3>
        <span className="tiny faint">Android and iOS differ</span>
      </div>

      <div className="card-body">
        <div className="grid grid-2" style={{ gap: 18 }}>
          {/* ---- Android ---- */}
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 9 }}>
              <strong style={{ fontSize: '0.92rem' }}>Android</strong>
              {here === 'android' && <span className="badge badge-ok">You are here</span>}
              {overHttps
                ? <span className="badge badge-ok">One tap</span>
                : <span className="badge badge-warn">Menu only</span>}
            </div>

            {overHttps ? (
              <>
                <p className="small mute">
                  Chrome shows its own <strong>Install app</strong> prompt, and the bar at the bottom of
                  the screen installs it in one tap.
                </p>
                <ol className="install-steps">
                  <li><I.Download /> Tap <strong>Add</strong> on the prompt</li>
                  <li><I.Check /> Confirm, and it lands on the home screen</li>
                </ol>
              </>
            ) : (
              <>
                <p className="small mute">
                  One-tap install needs a genuinely secure origin. This page is on plain
                  <span className="mono"> http://</span>, so Chrome will not offer it. The manual route
                  still works, and gives the same result:
                </p>
                <ol className="install-steps">
                  <li><I.Menu /> Open the browser menu (&#8942;)</li>
                  <li><I.Plus /> Choose <strong>Add to Home screen</strong></li>
                  <li><I.Check /> Confirm</li>
                </ol>
                <div className="tiny faint" style={{ marginTop: 9 }}>
                  For the one-tap version, restart with <span className="mono">npm run https</span>.
                </div>
              </>
            )}
          </div>

          {/* ---- iOS ---- */}
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 9 }}>
              <strong style={{ fontSize: '0.92rem' }}>iPhone and iPad</strong>
              {(here === 'ios-safari' || here === 'ios-other') && <span className="badge badge-ok">You are here</span>}
              <span className="badge badge-neutral">Always manual</span>
            </div>
            <p className="small mute">
              iOS has no install API at all, on any browser, and only Safari can add to the home
              screen. There is no one-tap route to offer.
            </p>
            <ol className="install-steps">
              <li><I.Phone /> Open the page in <strong>Safari</strong></li>
              <li><I.Download /> Tap <strong>Share</strong> in the toolbar</li>
              <li><I.Plus /> Scroll to <strong>Add to Home Screen</strong></li>
            </ol>
            {here === 'ios-other' && (
              <div className="tiny" style={{ marginTop: 9, color: 'var(--warn-fg)' }}>
                You are not in Safari. Copy the address into Safari first.
              </div>
            )}
            {overHttps && (
              <div className="tiny faint" style={{ marginTop: 9 }}>
                Icon shows a plain letter? <a href="/connect#trust">Trust this server first</a>, then add it again.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card-foot tiny mute">
        Either way the result is the same: a home-screen icon that opens full screen, with no
        browser bars, and pages already visited still open with no signal.
      </div>
    </div>
  );
}
