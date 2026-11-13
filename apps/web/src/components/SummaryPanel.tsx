import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type ApiClient, errorMessage } from '../api.js';
import { Alert, Icon } from './ui.js';

type Phase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';
export function SummaryPanel({ api, id }: { api: ApiClient; id: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function generate() {
    if (active.current) return;
    const abort = new AbortController();
    active.current = abort;
    setText('');
    setError('');
    setPhase('running');
    setCopied(false);
    let length = 0;
    try {
      for await (const event of api.summary(id, abort.signal)) {
        if (abort.signal.aborted) return;
        if (event.type === 'delta') {
          length += event.text.length;
          if (length > 32000) throw new Error('Summary output exceeded its limit.');
          setText((current) => current + event.text);
        } else if (event.type === 'done') setPhase('done');
        else throw new ApiFailure(event.error, event.code, 502);
      }
    } catch (failure) {
      if (!abort.signal.aborted) {
        setError(errorMessage(failure));
        setPhase('error');
      }
    } finally {
      if (active.current === abort) active.current = null;
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    setPhase('cancelled');
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Copy is unavailable. Select and copy the draft text instead.');
    }
  }
  const message = {
    idle: 'Ready when your notes are.',
    running: 'Drafting your summary…',
    done: 'Draft complete. Review the facts before sharing.',
    cancelled: 'Generation stopped. This draft is incomplete.',
    error: 'Generation did not finish. This draft is incomplete.',
  }[phase];
  return (
    <section className="summary-panel" aria-labelledby="summary-heading">
      <div className="summary-title">
        <span className="spark-icon">
          <Icon name="spark" />
        </span>
        <div>
          <p className="eyebrow">FROM NOTES TO NARRATIVE</p>
          <h2 id="summary-heading">A clearer incident brief</h2>
        </div>
      </div>
      <p className="muted">
        Draft a summary from your incident and latest 30 notes. Your content is sent to the AI
        provider when you generate.
      </p>
      <div className="summary-status" role="status">
        {phase === 'running' ? <span className="spinner" /> : null}
        {message}
      </div>
      {text ? (
        <pre className="summary-output" aria-label="Summary draft">
          {text}
        </pre>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="summary-actions">
        {phase === 'running' ? (
          <button className="button secondary" onClick={cancel}>
            Stop generation
          </button>
        ) : (
          <button
            className="button primary"
            onClick={() => {
              void generate();
            }}
          >
            <Icon name="spark" />
            {phase === 'idle' ? 'Generate summary' : 'Generate again'}
          </button>
        )}
        {phase === 'done' ? (
          <button
            className="button secondary"
            onClick={() => {
              void copy();
            }}
          >
            {copied ? 'Copied' : 'Copy draft'}
          </button>
        ) : null}
      </div>
      <p className="fine-print">AI-generated draft · Not saved automatically</p>
    </section>
  );
}
