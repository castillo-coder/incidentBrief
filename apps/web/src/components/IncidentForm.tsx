import { useState, type FormEvent } from 'react';
import type { Incident, IncidentInput, IncidentPatch } from '@incidentbrief/contracts';
import { errorMessage } from '../api.js';
import { Alert, Modal } from './ui.js';

interface Props {
  initial?: Incident;
  onSave: (input: IncidentInput & Pick<IncidentPatch, 'status'>) => Promise<void>;
  onClose: () => void;
}
export function IncidentForm({ initial, onSave, onClose }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [severity, setSeverity] = useState<IncidentInput['severity']>(
    initial?.severity ?? 'medium',
  );
  const [status, setStatus] = useState<Incident['status']>(initial?.status ?? 'open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim() || !description.trim()) {
      setError('Add a title and description before saving.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        severity,
        ...(initial ? { status } : {}),
      });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  return (
    <Modal title={initial ? 'Edit incident' : 'New incident'} onClose={onClose} busy={busy}>
      <p className="muted form-intro">
        Start with what you know. Add investigation notes as you go.
      </p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What happened?"
            />
          </label>
          <label>
            Description
            <textarea
              required
              maxLength={12000}
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the symptoms and known impact."
            />
          </label>
          <div className="form-row">
            <label>
              Severity
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IncidentInput['severity'])}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            {initial ? (
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as Incident['status'])}
                >
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
            ) : null}
          </div>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Create incident'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
