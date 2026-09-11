import { useEffect, useState } from 'react';

import type { MonitoringEvent } from '../devices/event-api';
import {
  getEvent,
  updateEventAssignment,
} from '../devices/event-api';
import type { ResponderSummary } from '../responders/responder-api';

export function EventAssignmentEditor({
  event,
  responders,
  onUpdated,
}: {
  event: MonitoringEvent;
  responders: ResponderSummary[];
  onUpdated: (event: MonitoringEvent) => void;
}) {
  const savedResponder = event.assigned_to_id ?? '';
  const savedInstructions = event.instructions ?? '';

  const [responderId, setResponderId] = useState(
    savedResponder,
  );

  const [instructions, setInstructions] = useState(
    savedInstructions,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setResponderId(savedResponder);
    setInstructions(savedInstructions);
  }, [savedResponder, savedInstructions]);

  const dirty =
    responderId !== savedResponder ||
    instructions !== savedInstructions;

  const save = async (remove = false) => {
    if (saving) return;

    const nextResponder = remove
      ? ''
      : responderId;

    if (
      nextResponder &&
      !instructions.trim()
    ) {
      setError(
        'Enter instructions for the responder.',
      );
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateEventAssignment(
        event.id,
        nextResponder
          ? {
              responderId: nextResponder,
              instructions:
                instructions.trim(),
            }
          : {
              responderId: null,
              instructions: null,
            },
      );

      onUpdated(
        (await getEvent(event.id)).event,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to update assignment.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (event.status === 'RESOLVED') {
    return (
      <p className="assignment-readonly">
        Assignment is read-only because this
        event is resolved.
      </p>
    );
  }

  return (
    <section
      className="inline-assignment"
      aria-label="Responder assignment"
    >
      <h4>
        {savedResponder
          ? 'Update assignment'
          : 'Assign responder'}
      </h4>

      <label>
        Responder

        <select
          value={responderId}
          disabled={saving}
          onChange={(e) =>
            setResponderId(e.target.value)
          }
        >
          <option value="">
            Unassigned
          </option>

          {responders.map((r) => (
            <option
              key={r.id}
              value={r.id}
            >
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Instructions

        <textarea
          rows={5}
          maxLength={1000}
          disabled={
            !responderId || saving
          }
          value={instructions}
          onChange={(e) =>
            setInstructions(e.target.value)
          }
          placeholder="Describe what the responder should check or do."
        />
      </label>

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      <div className="assignment-actions">
        <button
          type="button"
          disabled={
            saving ||
            !responderId ||
            !dirty
          }
          onClick={() => void save()}
        >
          {saving
            ? 'Saving…'
            : 'Save assignment'}
        </button>

        {savedResponder && (
          <button
            type="button"
            className="button-secondary"
            disabled={saving}
            onClick={() =>
              void save(true)
            }
          >
            Remove assignment
          </button>
        )}

        <button
          type="button"
          className="button-quiet"
          disabled={
            saving || !dirty
          }
          onClick={() => {
            setResponderId(savedResponder);
            setInstructions(
              savedInstructions,
            );
            setError('');
          }}
        >
          Cancel changes
        </button>
      </div>
    </section>
  );
}