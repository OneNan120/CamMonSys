import { useState, type FormEvent } from 'react';
import { createDevice } from './device-api';

export function RegisterDevicePage() {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { device } = await createDevice(name, location);

      setSuccess(`Registered ${device.name}.`);
      setName('');
      setLocation('');
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to register the device.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1>Register device</h1>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting}>
          <legend>Device details</legend>

          <label htmlFor="device-name">Name</label>
          <input
            id="device-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />

          <label htmlFor="device-location">Location</label>
          <input
            id="device-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={200}
            required
          />

          <button type="submit">
            {submitting ? 'Registering…' : 'Register device'}
          </button>
        </fieldset>

        {error && <p role="alert">{error}</p>}
        {success && <p role="status">{success}</p>}
      </form>
    </section>
  );
}