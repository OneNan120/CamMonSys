import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  createUser,
  listUsers,
  type ManagedUser,
} from './user-api';

export function UsersPage() {
  const [params, setParams] = useSearchParams();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [role, setRole] =
    useState<ManagedUser['role']>('MONITOR');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const search = params.get('search') ?? '';
  const roleFilter = params.get('role') ?? '';
  const highlight = params.get('userId') ?? '';

  const update = (
    k: string,
    v: string,
  ) => {
    const n = new URLSearchParams(params);

    v
      ? n.set(k, v)
      : n.delete(k);

    setParams(n, {
      replace: true,
    });
  };

  useEffect(() => {
    let active = true;

    listUsers()
      .then(
        (r) =>
          active &&
          setUsers(r.users),
      )
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to load users.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const shown = useMemo(
    () =>
      users.filter(
        (u) =>
          (!search ||
            `${u.name} ${u.email}`
              .toLowerCase()
              .includes(
                search.toLowerCase(),
              )) &&
          (!roleFilter ||
            u.role === roleFilter),
      ),
    [
      users,
      search,
      roleFilter,
    ],
  );

  const submit = async (
    e: FormEvent,
  ) => {
    e.preventDefault();

    if (saving) return;

    if (password !== confirm) {
      setError(
        'Passwords do not match.',
      );
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });

      setUsers((current) =>
        [...current, result.user].sort(
          (a, b) =>
            a.name.localeCompare(
              b.name,
            ),
        ),
      );

      setName('');
      setEmail('');
      setPassword('');
      setConfirm('');
      setRole('MONITOR');
      setShowForm(false);

      setMessage(
        `Created ${result.user.name}. Share the initial password privately.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to create user.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="users-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            ACCESS MANAGEMENT
          </p>

          <h2>Users</h2>

          <p>
            Create and review accounts for
            the monitoring system.
          </p>
        </div>

        <button
          onClick={() =>
            setShowForm(
              (v) => !v,
            )
          }
        >
          {showForm
            ? 'Close form'
            : '＋ Create User'}
        </button>
      </div>

      {showForm && (
        <form
          className="form-panel user-create-form"
          onSubmit={submit}
        >
          <div className="form-grid">
            <label>
              Name

              <input
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value,
                  )
                }
                maxLength={100}
                required
              />
            </label>

            <label>
              Email

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value,
                  )
                }
                maxLength={320}
                required
              />
            </label>

            <label>
              Role

              <select
                value={role}
                onChange={(e) =>
                  setRole(
                    e.target
                      .value as ManagedUser['role'],
                  )
                }
              >
                <option value="ADMIN">
                  Admin
                </option>

                <option value="MONITOR">
                  Monitor
                </option>

                <option value="RESPONDER">
                  Responder
                </option>
              </select>
            </label>

            <label>
              Initial password

              <input
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value,
                  )
                }
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                required
              />
            </label>

            <label>
              Confirm password

              <input
                type="password"
                value={confirm}
                onChange={(e) =>
                  setConfirm(
                    e.target.value,
                  )
                }
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                required
              />
            </label>
          </div>

          <p className="form-help">
            Share the initial password
            privately. It will not be
            displayed after creation.
          </p>

          <div className="form-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() =>
                setShowForm(false)
              }
            >
              Cancel
            </button>

            <button
              disabled={saving}
            >
              {saving
                ? 'Creating…'
                : 'Create user'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      {message && (
        <p role="status">
          {message}
        </p>
      )}

      <div className="device-filter-bar">
        <label className="device-search">
          <span aria-hidden="true">
            ⌕
          </span>

          <span className="sr-only">
            Search users
          </span>

          <input
            type="search"
            value={search}
            onChange={(e) =>
              update(
                'search',
                e.target.value,
              )
            }
            placeholder="Search by name or email"
          />

          {search && (
            <button
              type="button"
              aria-label="Clear user search"
              onClick={() =>
                update(
                  'search',
                  '',
                )
              }
            >
              ×
            </button>
          )}
        </label>

        <label>
          <span>Role</span>

          <select
            value={roleFilter}
            onChange={(e) =>
              update(
                'role',
                e.target.value,
              )
            }
          >
            <option value="">
              All roles
            </option>

            <option value="ADMIN">
              Admin
            </option>

            <option value="MONITOR">
              Monitor
            </option>

            <option value="RESPONDER">
              Responder
            </option>
          </select>
        </label>

        <button
          type="button"
          className="button-quiet"
          onClick={() =>
            setParams(
              new URLSearchParams(),
              {
                replace: true,
              },
            )
          }
        >
          Clear all filters
        </button>
      </div>

      {loading ? (
        <p role="status">
          Loading users…
        </p>
      ) : shown.length === 0 ? (
        <p className="empty-panel">
          No users match these filters.
        </p>
      ) : (
        <div className="user-list">
          {shown.map((user) => (
            <article
              id={`user-${user.id}`}
              key={user.id}
              className={`user-row ${
                highlight === user.id
                  ? 'highlighted'
                  : ''
              }`}
            >
              <span className="profile-avatar">
                {user.name
                  .charAt(0)
                  .toUpperCase()}
              </span>

              <div>
                <strong>
                  {user.name}
                </strong>

                <small>
                  {user.email}
                </small>
              </div>

              <span className="role-pill">
                {user.role}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}