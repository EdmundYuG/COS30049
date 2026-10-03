import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { SmartImage } from '../components/motion.jsx';
import { installAdvice, onInstallChange, promptInstall, isStandalone, platform } from '../lib/install.js';
import { markIntroSeen } from '../lib/intro.js';
import * as I from '../lib/icons.jsx';

/**
 * First run.
 *
 * A visitor arriving here has usually just scanned a tag on a trail, or been
 * handed a link. They get one screen explaining what this is, and then the
 * right next step for the device in their hand: a desktop visitor is sent
 * straight into the register, while a phone visitor is offered the home-screen
 * install first, because that is what makes it usable in the field.
 *
 * Shown once. Dismissing it is remembered.
 */
export default function Welcome() {
  const { boot, mobile } = useApp();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [hero, setHero] = useState(null);
  const [heroCredit, setHeroCredit] = useState(null);
  const [advice, setAdvice] = useState(() => installAdvice());
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    api.publicStats().then(setStats).catch(() => {});
    api.publicPlants({ limit: 12, sort: 'popular' })
      .then((r) => {
        const pick = r.results.find((p) => p.photo && ['tree', 'palm'].includes(p.growth_form))
          || r.results.find((p) => p.photo);
        setHero(pick?.photo || null);
        setHeroCredit(pick?.photo_credit || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => onInstallChange(() => setAdvice(installAdvice())), []);

  const enter = (to = '/') => {
    markIntroSeen();
    navigate(to, { replace: true });
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') setInstalled(true);
  };

  const p = platform();
  const alreadyInstalled = isStandalone();

  const facts = [
    { n: stats?.published_plants, label: 'plants tagged' },
    { n: stats?.species, label: 'species' },
    { n: stats?.families, label: 'families' },
  ].filter((f) => f.n);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-top">
          <span className="welcome-mark">
            <img src="/icons/icon-192.png" alt="" width="52" height="52" />
          </span>
          <div>
            <h1>FloraScan</h1>
            <p className="welcome-place">
              <I.MapPin style={{ width: 13, height: 13 }} />
              {boot?.park_name || 'Niah National Park'}, Sarawak
            </p>
          </div>
        </div>

        <p className="welcome-lead">
          A field guide to every tagged plant in the park. Scan the QR code on a
          trailside tag and read what a botanist has confirmed about that exact
          specimen &mdash; no app to install, no account to create.
        </p>

        <ul className="welcome-points">
          <li>
            <I.Scan />
            <div>
              <strong>Scan a tag</strong>
              <span>Any phone camera opens the plant&rsquo;s page.</span>
            </div>
          </li>
          <li>
            <I.Shield />
            <div>
              <strong>Checked by a botanist</strong>
              <span>Rangers record what they find; nothing is published until it is verified.</span>
            </div>
          </li>
          <li>
            <I.Leaf />
            <div>
              <strong>Search the whole register</strong>
              <span>By name, family, conservation status or where you are standing.</span>
            </div>
          </li>
        </ul>

        {facts.length > 0 && (
          <div className="welcome-facts">
            {facts.map((f) => (
              <span key={f.label}><strong>{f.n}</strong> {f.label}</span>
            ))}
          </div>
        )}

        {/* The next step depends on the device. */}
        {mobile && !alreadyInstalled ? (
          <div className="welcome-actions">
            {advice?.kind === 'prompt' && !installed && (
              <button className="btn btn-primary btn-lg btn-block" onClick={install}>
                <I.Download /> Add to home screen
              </button>
            )}

            {advice?.kind === 'ios' && (
              <div className="welcome-ios">
                <div className="welcome-ios-head">
                  <I.Phone /> Keep it one tap away
                </div>
                <ol>
                  <li>Tap <strong>Share</strong> in Safari&rsquo;s toolbar</li>
                  <li>Choose <strong>Add to Home Screen</strong></li>
                </ol>
              </div>
            )}

            {advice?.kind === 'android' && (
              <div className="welcome-ios">
                <div className="welcome-ios-head">
                  <I.Phone /> Keep it one tap away
                </div>
                <ol>
                  <li>Open the browser menu (&#8942;)</li>
                  <li>Choose <strong>Add to Home screen</strong></li>
                </ol>
              </div>
            )}

            {installed && (
              <div className="welcome-ios">
                <div className="welcome-ios-head"><I.Check /> Added to your home screen</div>
              </div>
            )}

            <button className="btn btn-lg btn-block welcome-ghost" onClick={() => enter()}>
              Continue in the browser <I.ChevronRight />
            </button>
          </div>
        ) : (
          <div className="welcome-actions">
            <button className="btn btn-primary btn-lg" onClick={() => enter()}>
              Start exploring <I.ChevronRight />
            </button>
            <button className="btn btn-lg welcome-ghost" onClick={() => enter('/scan')}>
              <I.Scan /> I have a tag to scan
            </button>
          </div>
        )}

        <div className="welcome-foot">
          {p === 'desktop' && !mobile && (
            <>Built for the trail &mdash; open it on your phone from <button className="linkish" onClick={() => enter('/connect')}>Open on phone</button>. </>
          )}
          Park staff can <button className="linkish" onClick={() => enter('/login')}>sign in</button> to register and verify plants.
        </div>
      </div>

      {hero && (
        <div className="welcome-photo">
          <SmartImage src={hero} alt="" eager />
          {/* These are other people’s photographs under Creative Commons,
              so the credit travels with the image even here. */}
          {heroCredit && <span className="welcome-credit">{heroCredit}</span>}
        </div>
      )}
    </div>
  );
}
