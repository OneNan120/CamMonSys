import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from './api';
import { LoginPage } from './auth/LoginPage';
import { getCurrentUser, logout, type User } from './auth/auth-api';
import { RegisterDevicePage } from './devices/RegisterDevicePage';
import { DeviceListPage } from './devices/DeviceListPage';
import { DeviceDetailPage } from './devices/DeviceDetailPage';
import { RequireRole } from './auth/RequireRole';
import { CameraDevicePage } from './devices/CameraDevicePage';
import { ManageDeviceGroupsPage } from './device-groups/ManageDeviceGroupsPage';
import { ResponderAssignmentsPage } from './responders/ResponderAssignmentsPage';
import { ResponderDevicePage } from './responders/ResponderDevicePage';
import { AuditLogPage } from './audit/AuditLogPage';
import { AdminLockScreen } from './auth/AdminLockScreen';
import { BrandMark } from './BrandMark';
import { DeviceDirectoryPage } from './devices/DeviceDirectoryPage';
import { EventsPage } from './events/EventsPage';
import { EventDetailPage } from './events/EventDetailPage';
import { MonitoringStreamProvider } from './monitoring/MonitoringStreamContext';
import { UsersPage } from './users/UsersPage';

const ADMIN_LOCK_STORAGE_KEY = 'cammon_admin_locked';

function pageTitle(pathname: string, role: User['role']) {
  if (role === 'RESPONDER') {
    return pathname.startsWith('/devices/') ? 'Assigned Camera' : 'My Active Assignments';
  }
  if (pathname === '/devices/new') return 'Register Device';
  if (pathname === '/devices') return 'Devices';
  if (pathname.startsWith('/events/')) return 'Event Detail';
  if (pathname === '/events') return 'Events';
  if (pathname === '/users') return 'Users';
  if (pathname.includes('/camera')) return 'Camera Publisher';
  if (pathname.startsWith('/devices/')) return 'Device Control Room';
  if (pathname === '/device-groups') return 'Device Groups';
  if (pathname === '/audit-log') return 'Audit Log';
  return 'Monitoring Console';
}

function Navigation({
  user,
}: {
  user: User;
}) {
  if (user.role === 'RESPONDER') {
    return (
      <nav
        className="sidebar-nav"
        aria-label="Main navigation"
      >
        <NavLink
          to="/"
          end
        >
          <span aria-hidden="true">
            ▦
          </span>
          My Assignments
        </NavLink>

        <NavLink to="/audit-log">
          <span aria-hidden="true">
            ◇
          </span>
          My Audit Log
        </NavLink>
      </nav>
    );
  }

  return (
    <nav
      className="sidebar-nav"
      aria-label="Main navigation"
    >
      <NavLink
        to="/"
        end
      >
        <span aria-hidden="true">
          ▦
        </span>
        Dashboard
      </NavLink>

      <NavLink to="/devices">
        <span aria-hidden="true">
          ◉
        </span>
        Devices
      </NavLink>

      <NavLink to="/events">
        <span aria-hidden="true">
          ⌁
        </span>
        Events
      </NavLink>

      {user.role === 'ADMIN' && (
        <NavLink to="/users">
          <span aria-hidden="true">
            ♙
          </span>
          Users
        </NavLink>
      )}

      <NavLink to="/audit-log">
        <span aria-hidden="true">
          ◇
        </span>

        {user.role === 'ADMIN'
          ? 'Audit Log'
          : 'My Audit Log'}
      </NavLink>
    </nav>
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adminLocked, setAdminLocked] = useState(
    () => sessionStorage.getItem(ADMIN_LOCK_STORAGE_KEY) === 'true',
  );
  const [contentUnlocked, setContentUnlocked] = useState(
    () => sessionStorage.getItem(ADMIN_LOCK_STORAGE_KEY) !== 'true',
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getCurrentUser()
      .then(({ user }) => {
        if (active) setUser(user);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) setUser(null);
        else setError('Unable to check your session. Please retry.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (loading || !user) return;
    if (user.role !== 'ADMIN') {
      sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
      setAdminLocked(false);
    }
  }, [loading, user]);

  function handleLock() {
    sessionStorage.setItem(ADMIN_LOCK_STORAGE_KEY, 'true');
    setAdminLocked(true);
  }

  function handleUnlock() {
    setContentUnlocked(true);
    sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
    setAdminLocked(false);
  }

  async function handleLogout() {
    setSigningOut(true);
    setError('');
    try {
      await logout();
      sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
      setAdminLocked(false);
      setUser(null);
      setContentUnlocked(true);
      navigate('/', { replace: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
        setAdminLocked(false);
        setUser(null);
        setContentUnlocked(true);
        navigate('/', { replace: true });
      } else {
        setError('Sign-out failed. Please try again.');
      }
    } finally {
      setSigningOut(false);
    }
  }

  const handleAccessEnded = useCallback(() => {
    sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
    setAdminLocked(false);
    setContentUnlocked(true);
    setUser(null);
    navigate('/', { replace: true });
  }, [navigate]);

  if (loading) {
    return <main className="center-state"><BrandMark /><p role="status">Checking your session…</p></main>;
  }

  if (!user && error) {
    return (
      <main className="center-state">
        <BrandMark />
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </main>
    );
  }

  if (!user) return <LoginPage onLogin={setUser} />;

  const locked = user.role === 'ADMIN' && adminLocked;

  return (
    <>
      {locked && (
        <AdminLockScreen
          adminName={user.name}
          onUnlock={handleUnlock}
        />
      )}

      <div className="app-shell" hidden={locked} inert={locked} aria-hidden={locked}>
        <aside className="sidebar">
          <BrandMark />
          <Navigation user={user} />
          <Link className="sidebar-profile" to={`/audit-log?actorId=${user.id}`} aria-label={`View audit history for ${user.name}`}>
            <span className="profile-avatar" aria-hidden="true">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === 'RESPONDER' ? 'On-Duty Responder' : user.role === 'MONITOR' ? 'Clinical Monitor' : 'System Administrator'}</small>
            </span>
          </Link>
        </aside>

        <main className="app-main">
          <header className="topbar">
            <div>
              <p className="topbar-eyebrow">CAMERA MONITOR SYSTEM</p>
              <h1>{pageTitle(location.pathname, user.role)}</h1>
            </div>
            <div className="topbar-actions">
              <span className="environment-pill"><i /> {user.role} CONSOLE</span>
              {user.role === 'ADMIN' && (
                <button type="button" className="button-secondary topbar-lock" onClick={handleLock}>
                  Lock controls
                </button>
              )}
              <button type="button" className="button-quiet" onClick={() => void handleLogout()} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </header>

          {error && <p className="global-alert" role="alert">{error}</p>}

          <div className="page-content">
            {(contentUnlocked || user.role !== 'ADMIN') && (
              <MonitoringStreamProvider onAccessEnded={handleAccessEnded}>
              <Routes>
                <Route
                  path="/"
                  element={
                    user.role === 'RESPONDER' ? (
                      <ResponderAssignmentsPage />
                    ) : (
                      <RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR']}>
                        <DeviceListPage canRegister={user.role === "ADMIN"} />
                      </RequireRole>
                    )
                  }
                />
                <Route path="/devices" element={<RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR']}><DeviceDirectoryPage canRegister={user.role === 'ADMIN'} /></RequireRole>} />
                <Route path="/events" element={<RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR']}><EventsPage /></RequireRole>} />
                <Route path="/users" element={<RequireRole user={user} allowedRoles={['ADMIN']}><UsersPage /></RequireRole>} />
                <Route path="/events/:eventId" element={<RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR', 'RESPONDER']}><EventDetailPage userRole={user.role} /></RequireRole>} />
                <Route
                  path="/devices/new"
                  element={
                    <RequireRole user={user} allowedRoles={['ADMIN']}>
                      <RegisterDevicePage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/device-groups"
                  element={
                    <RequireRole user={user} allowedRoles={['ADMIN']}>
                      <ManageDeviceGroupsPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/audit-log"
                  element={
                    <RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR', 'RESPONDER']}>
                      <AuditLogPage currentUser={user} />
                    </RequireRole>
                  }
                />
                <Route
                  path="/devices/:deviceId"
                  element={
                    <RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR', 'RESPONDER']}>
                      {user.role === 'RESPONDER' ? (
                        <ResponderDevicePage />
                      ) : (
                        <DeviceDetailPage
                          canPublish={user.role === 'ADMIN'}
                          canDelete={user.role === 'ADMIN'}
                          canManageGroups={user.role === 'ADMIN'}
                        />
                      )}
                    </RequireRole>
                  }
                />
                <Route
                  path="/devices/:deviceId/camera"
                  element={
                    <RequireRole user={user} allowedRoles={['ADMIN']}>
                      <CameraDevicePage />
                    </RequireRole>
                  }
                />
                <Route
                  path="*"
                  element={
                    <section className="empty-state">
                      <h2>Page not found</h2>
                      <Link to="/">Return to dashboard</Link>
                    </section>
                  }
                />
              </Routes>
              </MonitoringStreamProvider>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
