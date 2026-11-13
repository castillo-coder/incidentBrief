import { useEffect, useState, type FormEvent } from 'react';
import type { Incident, Note, Page } from '@incidentbrief/contracts';
import { type ApiClient, errorMessage } from '../api.js';
import { IncidentForm } from './IncidentForm.js';
import { SummaryPanel } from './SummaryPanel.js';
import { Alert, Badge, dateLabel, Icon, Loading, Modal } from './ui.js';

export function IncidentDetail({ api, id }: { api: ApiClient; id: string }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [notes, setNotes] = useState<Page<Note>>({
    data: [],
    next_cursor: null,
  });
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([api.get(id, abort.signal), api.notes(id, {}, abort.signal)])
      .then(([item, page]) => {
        if (!abort.signal.aborted) {
          setIncident(item);
          setNotes(page);
        }
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(errorMessage(failure));
      });
    return () => abort.abort();
  }, [api, id, attempt]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function addNote(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setError('Write a note before adding it.');
      return;
    }
    void action(async () => {
      const note = await api.addNote(id, body.trim());
      setNotes((current) => ({ ...current, data: [note, ...current.data] }));
      setBody('');
      setRevision((value) => value + 1);
    });
  }
  if (!incident)
    return (
      <>
        <a href="#/" className="back-link">
          <Icon name="back" />
          All incidents
        </a>
        {error ? (
          <>
            <Alert>{error}</Alert>
            <button
              className="button secondary"
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <Loading label="Opening incident…" />
        )}
      </>
    );
  return (
    <>
      <a href="#/" className="back-link">
        <Icon name="back" />
        All incidents
      </a>
      <header className="detail-heading">
        <div>
          <div className="detail-badges">
            <Badge value={incident.status} />
            <span className={`severity-label severity-${incident.severity}`}>
              <span />
              {incident.severity} severity
            </span>
          </div>
          <h1>{incident.title}</h1>
          <p className="muted">
            Opened {dateLabel(incident.created_at)} · Updated {dateLabel(incident.updated_at)}
          </p>
        </div>
        <button className="button secondary" onClick={() => setEditing(true)} disabled={busy}>
          Edit incident
        </button>
      </header>
      {error ? <Alert>{error}</Alert> : null}
      <div className="detail-grid">
        <div className="investigation-column">
          <section className="paper-section" aria-labelledby="description-heading">
            <p className="eyebrow">THE STARTING POINT</p>
            <h2 id="description-heading">What happened</h2>
            <p className="incident-description">{incident.description}</p>
          </section>
          <section className="paper-section" aria-labelledby="notes-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BUILD THE PICTURE</p>
                <h2 id="notes-heading">Investigation notes</h2>
              </div>
              <span className="note-count">{notes.data.length} loaded</span>
            </div>
            <form className="note-form" onSubmit={addNote}>
              <label htmlFor="new-note" className="sr-only">
                New investigation note
              </label>
              <textarea
                id="new-note"
                placeholder="A finding, a question, a next step…"
                required
                maxLength={8000}
                rows={3}
                value={body}
                disabled={busy}
                onChange={(event) => setBody(event.target.value)}
              />
              <div>
                <span className="fine-print">Newest notes first</span>
                <button className="button primary small" disabled={busy || !body.trim()}>
                  {busy ? 'Working…' : 'Add note'}
                </button>
              </div>
            </form>
            {notes.data.length ? (
              <ol className="notes-list">
                {notes.data.map((note) => (
                  <li key={note.id}>
                    <div className="note-heading">
                      <time dateTime={note.created_at}>{dateLabel(note.created_at)}</time>
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        aria-label={`Delete note: ${note.body.slice(0, 40)}`}
                        onClick={() => {
                          void action(async () => {
                            await api.deleteNote(id, note.id);
                            setNotes((current) => ({
                              ...current,
                              data: current.data.filter((item) => item.id !== note.id),
                            }));
                            setRevision((value) => value + 1);
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    <p>{note.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="notes-empty">No notes yet. Your next finding belongs here.</p>
            )}
            {notes.next_cursor ? (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => {
                  void action(async () => {
                    const next = await api.notes(id, {
                      cursor: notes.next_cursor!,
                    });
                    setNotes((current) => ({
                      next_cursor: next.next_cursor,
                      data: [
                        ...current.data,
                        ...next.data.filter(
                          (item) => !current.data.some((existing) => existing.id === item.id),
                        ),
                      ],
                    }));
                  });
                }}
              >
                Load more notes
              </button>
            ) : null}
          </section>
          <div className="delete-section">
            <p>Finished with this record?</p>
            <button
              className="text-button danger-text"
              onClick={() => setDeleting(true)}
              disabled={busy}
            >
              Delete incident
            </button>
          </div>
        </div>
        <SummaryPanel key={`${incident.updated_at}:${revision}`} api={api} id={id} />
      </div>
      {editing ? (
        <IncidentForm
          initial={incident}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            setIncident(await api.update(id, input));
            setEditing(false);
          }}
        />
      ) : null}
      {deleting ? (
        <Modal title="Delete this incident?" busy={busy} onClose={() => setDeleting(false)}>
          <p className="muted">The incident and all its notes will be permanently deleted.</p>
          {error ? <Alert>{error}</Alert> : null}
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setDeleting(false)}>
              Keep incident
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={() => {
                void action(async () => {
                  await api.delete(id);
                  window.location.hash = '/';
                });
              }}
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
