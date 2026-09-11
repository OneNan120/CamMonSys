import { useState, type FormEvent } from 'react';
import { BrandMark } from '../BrandMark';
import { login, type User } from './auth-api';

type LoginPageProps = {
  onLogin: (user: User) => void;
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);

    try {
      const result = await login(email, password);
      setPassword('');
      onLogin(result.user);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-center">
        <div className="login-brand">
          <BrandMark />

        </div>

        <section className="login-card" aria-labelledby="login-heading">
          <div>
            <p className="eyebrow">SECURE OPERATIONS CONSOLE</p>
            <h1 id="login-heading">Sign in to Console</h1>
            <p className="login-intro">Monitor cameras, devices and active response events.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <fieldset disabled={submitting}>
              <label htmlFor="email">Email</label>
              <div className="input-shell">
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="operator@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="label-row">
                <label htmlFor="password">Password</label>
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="input-shell">
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <button className="button-primary login-submit" type="submit">
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </fieldset>

            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
          </form>
        </section>

        <p className="login-footnote">Authorized personnel only · Protected monitoring environment</p>
      </div>
    </main>
  );
}
