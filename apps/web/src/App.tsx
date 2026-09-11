import { useEffect, useState } from 'react';
import { ApiError } from './api';
import { LoginPage } from './auth/LoginPage';
import { getCurrentUser, logout, type User, } from './auth/auth-api';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
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

const ADMIN_LOCK_STORAGE_KEY = 'cammon_admin_locked';

export function App() {

    const navigate = useNavigate();

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [signingOut, setSigningOut] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [adminLocked, setAdminLocked] = useState(() => sessionStorage.getItem(ADMIN_LOCK_STORAGE_KEY) ==='true',);
    const [contentUnlocked, setContentUnlocked] = useState(() =>
      sessionStorage.getItem(ADMIN_LOCK_STORAGE_KEY) !== 'true');

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

        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
        } else {
          setError('Unable to check your session. Please retry.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (loading || !user) return;

    if (user.role !== 'ADMIN') {
      sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
      setAdminLocked(false);
    }
  }, [loading, user]);

  function handleLock() {
    sessionStorage.setItem(
      ADMIN_LOCK_STORAGE_KEY,
      'true',
    );

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
      navigate('/', { replace: true});
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        sessionStorage.removeItem(ADMIN_LOCK_STORAGE_KEY);
        setAdminLocked(false);
        setUser(null);
        setContentUnlocked(true);
        navigate('/', { replace: true});
      } else {
        setError('Sign-out failed. Please try again.');
      }
    } finally {
      setSigningOut(false);
    }
  }

  if (loading) {
    return <main><p role="status">Checking your session…</p></main>;
  }

  if (!user && error) {
    return (
      <main>
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
      </main>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const locked = user.role === 'ADMIN' && adminLocked;

  return (
    <>
      {locked && (
      <AdminLockScreen
        adminName={user.name}
        signingOut={signingOut}
        onUnlock={handleUnlock}
        onSignOut={() => void handleLogout()}
      />
      )}
    <main hidden={locked} inert={locked} aria-hidden={locked}>
        <header>
        <p>
            {user.name} · {user.role}
        </p>

        <nav aria-label="Main navigation">
            <Link to="/">Home</Link>{' '}

            {user.role === 'ADMIN' && (
              <>
                <Link to="/devices/new">Register device</Link>{' '}
                <Link to="/device-groups">Manage groups</Link>{' '}
                <Link to="/audit-log">Audit log</Link>
              </>
            )}
        </nav>

        {user.role === 'ADMIN' && (
          <button type="button" onClick={handleLock}>
            Lock controls
          </button>
        )}

        <button onClick={handleLogout} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
        </button>

        {error && <p role="alert">{error}</p>}
        </header>

        {(contentUnlocked || user.role !== 'ADMIN') && <Routes>
          <Route
            path="/"
            element={
              user.role === 'RESPONDER' ? (
                <section>
                  <ResponderAssignmentsPage />
                </section>
              ) : (
                <RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR']}>
                  <DeviceListPage />
                </RequireRole>
              )
            }
          />

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
              <RequireRole user={user} allowedRoles={['ADMIN']}>
                <AuditLogPage />
              </RequireRole>
            }
          />

          <Route
              path="*"
              element={
              <section>
                  <h1>Page not found</h1>
                  <Link to="/">Return home</Link>
              </section>
              }
          />
          

          <Route
            path="/devices/:deviceId"
            element={
              <RequireRole
                user={user}
                allowedRoles={['ADMIN', 'MONITOR', 'RESPONDER']}
              >
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
                <CameraDevicePage  />
              </RequireRole>
            }
          />
        </Routes>}
    </main>
    </>
    );
}
