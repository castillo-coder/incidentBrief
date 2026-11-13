import { useEffect, useState } from 'react';
import type { Incident, IncidentQuery, Page } from '@incidentbrief/contracts';
import { type ApiClient, errorMessage } from '../api.js';
import { Alert, Badge, dateLabel, Icon, Loading } from './ui.js';

export function IncidentList({
  api,
  status,
  onNew,
}: {
  api: ApiClient;
  status: IncidentQuery['status'];
  onNew: () => void;
}) {
  const [page, setPage] = useState<Page<Incident> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void api
      .list(status ? { status } : {}, abort.signal)
      .then(setPage)
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(errorMessage(failure));
      });
    return () => abort.abort();
  }, [api, status, attempt]);
  async function loadMore() {
    if (!page?.next_cursor || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.list({
        cursor: page.next_cursor,
        ...(status ? { status } : {}),
      });
      setPage((current) =>
        current
          ? {
              next_cursor: next.next_cursor,
              data: [
                ...current.data,
                ...next.data.filter(
                  (item) => !current.data.some((existing) => existing.id === item.id),
                ),
              ],
            }
          : next,
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  if (!page && !error) return <Loading label="Loading incidents…" />;
  return (
    <>
      {error ? (
        <>
          <Alert>{error}</Alert>
          {!page ? (
            <button
              className="button secondary"
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          ) : null}
        </>
      ) : null}
      {page ? (
        page.data.length ? (
          <>
            <div className="list-caption">
              <span>
                {page.data.length} {page.data.length === 1 ? 'incident' : 'incidents'} loaded
              </span>
              <span>LAST UPDATED</span>
            </div>
            <div className="incident-list">
              {page.data.map((item) => (
                <a
                  className={`incident-row severity-${item.severity}`}
                  key={item.id}
                  href={`#/incidents/${item.id}`}
                >
                  <div className="incident-row-main">
                    <div className="incident-row-title">
                      <h2>{item.title}</h2>
                      <Badge value={item.status} />
                    </div>
                    <p>{item.description}</p>
                    <div className="incident-meta">
                      <span className={`severity-label severity-${item.severity}`}>
                        <span />
                        {item.severity} severity
                      </span>
                      <span>Created {dateLabel(item.created_at)}</span>
                    </div>
                  </div>
                  <time dateTime={item.updated_at}>{dateLabel(item.updated_at)}</time>
                  <span className="row-arrow">
                    <Icon name="arrow" />
                  </span>
                </a>
              ))}
            </div>
            {page.next_cursor ? (
              <div className="load-more">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    void loadMore();
                  }}
                >
                  {busy ? 'Loading…' : 'Load more incidents'}
                </button>
              </div>
            ) : (
              <p className="list-end">You’re up to date.</p>
            )}
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="book" size={36} />
            </span>
            <h2>{status ? `No ${status} incidents.` : 'A clear place to start.'}</h2>
            <p>
              {status
                ? 'Try another filter, or start a new investigation.'
                : 'Keep the facts, follow the investigation, and turn your notes into a clear summary.'}
            </p>
            <button className="button primary" onClick={onNew}>
              <Icon name="plus" />
              New incident
            </button>
          </div>
        )
      ) : null}
    </>
  );
}
