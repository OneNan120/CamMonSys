import { type FormEvent, useState, } from 'react';
import { ApiError } from '../api';
import { reauthenticate } from './auth-api';

export function AdminLockScreen({
  adminName,
  onUnlock,
}: {
  adminName: string;
  onUnlock: () => void;
}) {
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (unlocking || !password) return;

    setUnlocking(true);
    setError('');

    try {
      await reauthenticate(password);
      setPassword('');
      onUnlock();
    } catch (error: unknown) {
      setPassword('');

      setError(
        error instanceof ApiError && error.status === 401
          ? 'Incorrect password.'
          : error instanceof Error
            ? error.message
            : 'Unable to unlock the application.',
      );
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <main>
      <section aria-labelledby="lock-screen-heading">
        <h1 id="lock-screen-heading">
          Camera monitoring is locked
        </h1>

        <p>
          Signed in as {adminName}. Enter your password to
          restore access to administrative controls.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              disabled={unlocking}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>

          <button
            type="submit"
            disabled={
              unlocking ||
              password.length === 0
            }
          >
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>

        {error && <p role="alert">{error}</p>}

      </section>
    </main>
  );
}