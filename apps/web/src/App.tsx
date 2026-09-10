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

export function App() {

    const navigate = useNavigate();

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [signingOut, setSigningOut] = useState(false);
    const [attempt, setAttempt] = useState(0);

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

  async function handleLogout() {
    setSigningOut(true);
    setError('');

    try {
      await logout();
      setUser(null);
      navigate('/', { replace: true});
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
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

  return (
    <main>
        <header>
        <p>
            {user.name} · {user.role}
        </p>

        <nav aria-label="Main navigation">
            <Link to="/">Home</Link>{' '}

            {user.role === 'ADMIN' && (
            <Link to="/devices/new">Register device</Link>
            )}
        </nav>

        <button onClick={handleLogout} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
        </button>

        {error && <p role="alert">{error}</p>}
        </header>

        <Routes>
          <Route
            path="/"
            element={
              user.role === 'RESPONDER' ? (
                <section>
                  <h1>My assignments</h1>
                  <p>The assignment view will be added later.</p>
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
              <RequireRole user={user} allowedRoles={['ADMIN', 'MONITOR']}>
                <DeviceDetailPage canPublish={user.role === 'ADMIN'} />
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
        </Routes>
    </main>
    );
}