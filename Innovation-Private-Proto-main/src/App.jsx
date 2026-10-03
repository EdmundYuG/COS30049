import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './lib/store.jsx';
import { homeFor } from './lib/format.js';
import { shouldShowIntro } from './lib/intro.js';
import { WebShell, MobileShell } from './components/Shell.jsx';
import RoleSwitcher from './components/RoleSwitcher.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import { PageTransition } from './components/motion.jsx';
import { Toasts, LoadingBlock, Empty } from './components/ui.jsx';
import * as I from './lib/icons.jsx';

import Home from './screens/Home.jsx';
import Browse from './screens/Browse.jsx';
import PlantInfo from './screens/PlantInfo.jsx';
import SpeciesList from './screens/SpeciesList.jsx';
import SpeciesDetail from './screens/SpeciesDetail.jsx';
import Login from './screens/Login.jsx';
import Connect from './screens/Connect.jsx';
import Scan from './screens/Scan.jsx';
import Welcome from './screens/Welcome.jsx';

import PlantRegister from './screens/staff/PlantRegister.jsx';
import RegisterPlant from './screens/staff/RegisterPlant.jsx';
import ReviewQueue from './screens/staff/ReviewQueue.jsx';
import MySubmissions from './screens/staff/MySubmissions.jsx';
import PlantDetail from './screens/staff/PlantDetail.jsx';
import SpeciesManage from './screens/staff/SpeciesManage.jsx';
import Reports from './screens/staff/Reports.jsx';
import TagSheet from './screens/staff/TagSheet.jsx';
import IoT from './screens/staff/IoT.jsx';
import Users from './screens/staff/Users.jsx';
import ActivityLog from './screens/staff/ActivityLog.jsx';
import Audit from './screens/staff/Audit.jsx';
import SettingsScreen from './screens/staff/Settings.jsx';
import Notifications from './screens/staff/Notifications.jsx';
import Me from './screens/staff/Me.jsx';

/* ------------------------------------------------------------------ */

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/** Staff route guard. Shows a clear reason rather than a blank redirect. */
function Guard({ need, needAny, children }) {
  const { user, can, ready } = useApp();
  const loc = useLocation();
  if (!ready) return <LoadingBlock />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const missing = (need && !can(need)) || (needAny && !needAny.some((c) => can(c)));
  if (missing) {
    return (
      <div className="page"><div className="wrap wrap-narrow">
        <Empty icon={I.Shield} title="Your role cannot open this page">
          This screen needs the <span className="mono">{need || needAny.join(' or ')}</span> permission,
          which the {user.role_label} role does not hold. The API enforces the same rule, so hiding the link is convenience, not the control itself.
        </Empty>
      </div></div>
    );
  }
  return children;
}

/** /staff has no screen of its own - land each role where its work is. */
function StaffHome() {
  const { user, ready } = useApp();
  if (!ready) return <LoadingBlock />;
  return <Navigate to={homeFor(user)} replace />;
}

/* ------------------------------------------------------------------ */

export default function App() {
  const { ready, mobile } = useApp();
  const loc = useLocation();

  const isStaff = loc.pathname.startsWith('/staff');
  const Shell = mobile ? MobileShell : WebShell;

  if (!ready) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <div className="row" style={{ gap: 10 }}><span className="spinner" /><span className="mute">Starting FloraScan...</span></div>
      </div>
    );
  }

  // First visit: introduce the thing before dropping someone into a register.
  // Deliberately outside the shell, and never over a scanned tag.
  if (shouldShowIntro(loc.pathname)) {
    return (
      <>
        <Welcome />
        <RoleSwitcher />
        <Toasts />
      </>
    );
  }

  return (
    <>
      <ScrollToTop />
      <Shell sidebar={!mobile && isStaff}>
        <Suspense fallback={<LoadingBlock />}>
          <PageTransition k={loc.pathname}>
          <Routes location={loc}>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/species" element={<SpeciesList />} />
            <Route path="/species/:id" element={<SpeciesDetail />} />
            <Route path="/plant/:id" element={<PlantInfo />} />
            {/* The QR target. Opaque token, permanent URL. */}
            <Route path="/p/:token" element={<PlantInfo byToken />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/connect" element={<Connect />} />
            <Route path="/login" element={<Login />} />

            {/* Staff */}
            <Route path="/staff" element={<StaffHome />} />
            <Route path="/staff/plants" element={<Guard needAny={['plant.view_all', 'plant.create']}><PlantRegister /></Guard>} />
            <Route path="/staff/plants/:id" element={<Guard needAny={['plant.view_all', 'plant.create']}><PlantDetail /></Guard>} />
            <Route path="/staff/register" element={<Guard need="plant.create"><RegisterPlant /></Guard>} />
            <Route path="/staff/review" element={<Guard need="plant.approve"><ReviewQueue /></Guard>} />
            <Route path="/staff/submissions" element={<Guard need="plant.create"><MySubmissions /></Guard>} />
            <Route path="/staff/species" element={<Guard need="species.manage"><SpeciesManage /></Guard>} />
            <Route path="/staff/tags" element={<Guard need="qr.print"><TagSheet /></Guard>} />
            <Route path="/staff/reports" element={<Guard need="report.view"><Reports /></Guard>} />
            <Route path="/staff/iot" element={<Guard need="sensor.view"><IoT /></Guard>} />
            <Route path="/staff/users" element={<Guard need="user.view"><Users /></Guard>} />
            <Route path="/staff/activity" element={<Guard need="system.audit"><ActivityLog /></Guard>} />
            <Route path="/staff/audit" element={<Guard need="system.audit"><Audit /></Guard>} />
            <Route path="/staff/settings" element={<Guard need="system.settings"><SettingsScreen /></Guard>} />
            <Route path="/staff/notifications" element={<Guard><Notifications /></Guard>} />
            <Route path="/staff/me" element={<Guard><Me /></Guard>} />

            <Route
              path="*"
              element={
                <div className="page"><div className="wrap wrap-narrow">
                  <Empty icon={I.Compass} title="Page not found">
                    That address does not match any screen in the prototype.
                  </Empty>
                </div></div>
              }
            />
          </Routes>
          </PageTransition>
        </Suspense>
      </Shell>
      <RoleSwitcher />
      <InstallPrompt />
      <Toasts />
    </>
  );
}
