import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { Auth, IncidentQuery } from '@incidentbrief/contracts';
import { ApiClient, ApiFailure, errorMessage } from './api.js';
import { IncidentList } from './components/IncidentList.js';
import { IncidentDetail } from './components/IncidentDetail.js';
import { IncidentForm } from './components/IncidentForm.js';
import { Alert, Icon, Loading } from './components/ui.js';

type Session =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'ready'; auth: Auth }
  | { status: 'error'; message: string };
const subscribeRoute = (change: () => void) => {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
};
const currentRoute = () => window.location.hash;

function Login({ api, onLogin }: { api: ApiClient; onLogin: (auth: Auth) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await api.login({ email: email.trim(), password }));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <a className="brand" href="#/">
          <span className="brand-mark">
            <Icon name="book" size={25} />
          </span>
          IncidentBrief<span className="brand-dot">.</span>
        </a>
        <div>
          <p className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</p>
          <h1>
            Find the facts.
            <br />
            Keep the story.
          </h1>
          <p>
            One place for your incidents, investigation notes, and the brief that brings them
            together.
          </p>
          <div className="story-rule" />
          <span className="story-caption">Document thoughtfully. Resolve confidently.</span>
        </div>
        <p className="login-footer">A quieter workspace for the unexpected.</p>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="welcome-mark">
            <Icon name="book" size={28} />
          </span>
          <p className="eyebrow">YOUR INVESTIGATION STARTS HERE</p>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to your incident journal.</p>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Email
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  maxLength={72}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                />
              </label>
            </fieldset>
            {error ? <Alert>{error}</Alert> : null}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <Icon name="arrow" />
            </button>
          </form>
          <p className="fine-print login-help">Need access? Ask your workspace administrator.</p>
        </div>
      </section>
    </main>
  );
}

function Workspace({ api, auth, onLogout }: { api: ApiClient; auth: Auth; onLogout: () => void }) {
  const route = useSyncExternalStore(subscribeRoute, currentRoute);
  const detail = /^#\/incidents\/([0-9a-f-]{36})$/i.exec(route)?.[1];
  const isList = !route || route === '#/' || route === '#';
  const [filter, setFilter] = useState<IncidentQuery['status']>(undefined);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await api.logout();
      onLogout();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="brand-mark">
            <Icon name="book" />
          </span>
          IncidentBrief<span className="brand-dot">.</span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Workspace">
          <a className="nav-item" aria-current={isList || detail ? 'page' : undefined} href="#/">
            <Icon name="book" />
            Incident journal
            <span className="nav-active-dot" />
          </a>
        </nav>
        <div className="sidebar-footer">
          <span className="footer-line" />
          <p>
            Keep the details.
            <br />
            <strong>Find the clarity.</strong>
          </p>
          <span className="fine-print">Your personal incident journal</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span className="topbar-label">
            YOUR WORKSPACE <span>/</span> INCIDENT JOURNAL
          </span>
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {auth.user.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-email">{auth.user.email}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                void logout();
              }}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {error ? <Alert>{error}</Alert> : null}
          {detail ? (
            <IncidentDetail key={detail} api={api} id={detail} />
          ) : isList ? (
            <>
              <header className="page-heading">
                <div>
                  <p className="eyebrow">THE INCIDENT JOURNAL</p>
                  <h1>
                    Every incident,
                    <br />
                    <em>a clearer story.</em>
                  </h1>
                  <p className="muted">
                    Capture the facts. Follow the investigation. Bring it all together.
                  </p>
                </div>
                <button className="button primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" />
                  New incident
                </button>
              </header>
              <div className="list-toolbar">
                <div className="filters" role="group" aria-label="Filter incidents">
                  {(['all', 'open', 'resolved'] as const).map((status) => (
                    <button
                      key={status}
                      aria-pressed={(filter ?? 'all') === status}
                      onClick={() => setFilter(status === 'all' ? undefined : status)}
                    >
                      {status === 'all' ? 'All incidents' : status === 'open' ? 'Open' : 'Resolved'}
                    </button>
                  ))}
                </div>
                <span className="sort-label">
                  Newest first <span>↓</span>
                </span>
              </div>
              <IncidentList
                key={filter ?? 'all'}
                api={api}
                status={filter}
                onNew={() => setCreating(true)}
              />
            </>
          ) : (
            <section className="empty-state">
              <h1>Page not found.</h1>
              <a className="button secondary" href="#/">
                Back to incidents
              </a>
            </section>
          )}
        </main>
      </div>
      {creating ? (
        <IncidentForm
          onClose={() => setCreating(false)}
          onSave={async ({ title, description, severity }) => {
            const incident = await api.create({ title, description, severity });
            setCreating(false);
            window.location.hash = `/incidents/${incident.id}`;
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [api] = useState(() => new ApiClient(() => setSession({ status: 'guest' })));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void api
      .session(abort.signal)
      .then((auth) => {
        if (!abort.signal.aborted) setSession({ status: 'ready', auth });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setSession(
            error instanceof ApiFailure && error.status === 401
              ? { status: 'guest' }
              : { status: 'error', message: errorMessage(error) },
          );
      });
    return () => abort.abort();
  }, [api, attempt]);
  if (session.status === 'loading')
    return (
      <div className="startup">
        <Loading />
      </div>
    );
  if (session.status === 'error')
    return (
      <main className="startup">
        <div>
          <h1>We couldn’t open your workspace.</h1>
          <Alert>{session.message}</Alert>
          <button
            className="button primary"
            onClick={() => {
              setSession({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  return session.status === 'guest' ? (
    <Login api={api} onLogin={(auth) => setSession({ status: 'ready', auth })} />
  ) : (
    <Workspace api={api} auth={session.auth} onLogout={() => setSession({ status: 'guest' })} />
  );
}
