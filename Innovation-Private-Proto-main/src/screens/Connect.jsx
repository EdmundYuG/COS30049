import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { CopyButton, LoadingBlock, Notice, PageHead } from '../components/ui.jsx';
import { InstallCard, PlatformGuides } from '../components/InstallPrompt.jsx';
import * as I from '../lib/icons.jsx';

/**
 * Installing the local CA on a phone. Accepting the browser warning only
 * covers the page: iOS fetches the home-screen icon separately, refuses the
 * untrusted certificate, and falls back to a plain letter tile.
 */
function TrustCard({ caUrl }) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return (
    <div className="card" id="trust">
      <div className="card-head">
        <I.Shield style={{ width: 18, height: 18, flex: 'none', color: 'var(--accent)' }} />
        <h3 className="grow">Trust this server on your phone</h3>
        <span className="tiny faint nowrap">Once per phone</span>
      </div>
      <div className="card-body">
        <p className="small mute">
          Without this, an iPhone puts a plain <strong>&ldquo;F&rdquo;</strong> on the home screen instead of the
          FloraScan icon, because iOS will not fetch the icon from a server it does not trust. It also removes the
          certificate warning. It keeps working when this computer&rsquo;s address changes.
        </p>

        <div className="grid" style={{ gap: 18, marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          <div>
            <strong style={{ fontSize: '0.92rem' }}>iPhone and iPad</strong>
            <ol className="install-steps" style={{ marginTop: 8 }}>
              <li><I.Download /><span>In <strong>Safari</strong>, tap <strong>Download certificate</strong>, then <strong>Allow</strong></span></li>
              <li><I.Settings /><span>Open <strong>Settings</strong> &rarr; <strong>Profile Downloaded</strong> &rarr; <strong>Install</strong></span></li>
              <li><I.Shield /><span><strong>General</strong> &rarr; <strong>About</strong> &rarr; <strong>Certificate Trust Settings</strong>, and switch on <strong>FloraScan local CA</strong></span></li>
              <li><I.Refresh /><span>Delete the old home-screen icon and add FloraScan again</span></li>
            </ol>
          </div>
          <div>
            <strong style={{ fontSize: '0.92rem' }}>Android</strong>
            <ol className="install-steps" style={{ marginTop: 8 }}>
              <li><I.Download /><span>Tap <strong>Download certificate</strong></span></li>
              <li><I.Settings /><span><strong>Settings</strong> &rarr; <strong>Security</strong> &rarr; <strong>Install a certificate</strong> &rarr; <strong>CA certificate</strong> (the menu names vary by phone)</span></li>
            </ol>
          </div>
        </div>

        <div className="row row-wrap" style={{ gap: 10, marginTop: 14 }}>
          <a className="btn btn-primary" href={caUrl}><I.Download /> Download certificate</a>
          {standalone && (
            <span className="tiny" style={{ color: 'var(--warn-fg)' }}>
              Open this page in Safari first: the installed app cannot download profiles.
            </span>
          )}
        </div>
      </div>
      <div className="card-foot tiny mute">
        The certificate can only vouch for <span className="mono">localhost</span> and private network addresses
        (<span className="mono">10.x</span>, <span className="mono">172.16&ndash;31.x</span>, <span className="mono">192.168.x</span>),
        never a public website. Remove it when you are done with the prototype: on iPhone, <strong>General</strong> &rarr; <strong>VPN &amp; Device Management</strong>.
      </div>
    </div>
  );
}

/**
 * "Open this on my phone."
 * Shows the LAN address of the running dev server as a QR code, so a phone on
 * the same Wi-Fi or hotspot can jump straight in without typing an IP.
 */
export default function Connect() {
  const { setView, viewPref, mobile } = useApp();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.connect().then(setInfo).catch((e) => setError(e.message));
  }, []);

  const onPhone = /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  if (error) {
    return (
      <div className="page"><div className="wrap wrap-narrow">
        <Notice kind="danger" title="Could not read the server address">{error}</Notice>
      </div></div>
    );
  }
  if (!info) return <LoadingBlock label="Working out this machine's address" />;

  return (
    <div className="page">
      <div className="wrap wrap-narrow">
        <PageHead
          title="Open on your phone"
          sub="Scan this with your phone's camera while it is on the same Wi-Fi network or hotspot as this computer."
        />

        {onPhone ? (
          <Notice kind="ok" title="You are already on a phone">
            You are viewing the prototype on a mobile device. Use the switcher (bottom right) to force the
            website layout instead, if you want to compare them.
          </Notice>
        ) : (
          <div className="card card-pad center" style={{ marginBottom: 20 }}>
            <div className="connect-qr">
              <img src={info.png} alt={'QR code for ' + info.url} />
            </div>
            <div className="mono" style={{ marginTop: 14, fontSize: '1.02rem', fontWeight: 600 }}>{info.url}</div>
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
              <CopyButton text={info.url} label="Copy address" />
              <a className="btn btn-sm" href={info.url} target="_blank" rel="noreferrer"><I.External /> Open in a new tab</a>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <InstallCard />
        </div>

        {info.ca_url && (
          <div style={{ marginBottom: 20 }}>
            <TrustCard caUrl={info.ca_url} />
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <PlatformGuides />
        </div>

        <div className="grid grid-2" style={{ marginBottom: 20 }}>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>How to connect</h3>
            <ol className="small mute" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.85 }}>
              <li>Put your phone on the <strong>same Wi-Fi or hotspot</strong> as this computer.</li>
              <li>Open the camera app and point it at the QR code.</li>
              <li>Tap the notification that appears.</li>
              {info.secure && <li>Accept the certificate warning once (Advanced &rarr; Proceed).</li>}
            </ol>
          </div>

          <div className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>Layout</h3>
            <div className="small mute" style={{ marginBottom: 12 }}>
              The prototype follows the screen size, but you can force either layout for a demo.
            </div>
            <div className="segmented">
              {[['auto', 'Auto'], ['web', 'Website'], ['mobile', 'Phone app']].map(([v, l]) => (
                <button key={v} className={viewPref === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>
              ))}
            </div>
            <div className="tiny faint" style={{ marginTop: 10 }}>
              Currently showing the <strong>{mobile ? 'phone app' : 'website'}</strong> layout.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Notice kind={info.secure ? 'ok' : 'warn'} title={info.secure ? 'Running over HTTPS' : 'Camera scanning needs HTTPS'}>
            {info.note}
          </Notice>
        </div>

        {info.addresses.length > 1 && (
          <div className="card">
            <div className="card-head"><h3>Other network addresses on this machine</h3></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Adapter</th><th>Address</th><th></th></tr>
                </thead>
                <tbody>
                  {info.addresses.map((a) => (
                    <tr key={a.address}>
                      <td className="small">
                        {a.name}
                        {a.virtual && <span className="tag" style={{ marginLeft: 7 }}>virtual</span>}
                      </td>
                      <td className="mono small">{a.url}</td>
                      <td className="num"><CopyButton text={a.url} label="Copy" className="btn btn-sm btn-ghost" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot tiny mute">
              If the QR code does not load on your phone, try one of these. Adapters marked
              <span className="tag" style={{ margin: '0 5px' }}>virtual</span>
              belong to WSL, Docker or a VM and are usually not reachable from a phone.
            </div>
          </div>
        )}

        <div className="tiny faint" style={{ marginTop: 20 }}>
          Port {info.port} was picked at random on first run and saved to <span className="mono">proto.config.json</span>.
          Run <span className="mono">npm run port</span> to pick a new one.
          If the phone cannot connect, your firewall is probably blocking Node on the private network.
        </div>
      </div>
    </div>
  );
}
