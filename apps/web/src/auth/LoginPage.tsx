import { useState, type FormEvent } from 'react';
import { login, type User } from './auth-api';

type LoginPageProps = {
  onLogin: (user: User) => void;
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setError(
        error instanceof Error ? error.message : 'Sign-in failed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting}>
          <legend>Account details</legend>

          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </fieldset>

        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}