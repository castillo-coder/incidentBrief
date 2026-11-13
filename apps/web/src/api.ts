import { FormatRegistry, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  AuthSchema,
  ErrorSchema,
  IncidentSchema,
  IncidentPageSchema,
  NotePageSchema,
  NoteSchema,
  type ErrorCode,
  type IncidentInput,
  type IncidentPatch,
  type Login,
  type IncidentQuery,
  type PageQuery,
} from '@incidentbrief/contracts';
import { readSummaryStream } from '@incidentbrief/contracts/stream';

FormatRegistry.Set('uuid', (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
);
FormatRegistry.Set(
  'date-time',
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)),
);

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | 'invalid_response',
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}
export function errorMessage(error: unknown) {
  if (
    error instanceof ApiFailure ||
    (error instanceof Error && error.name === 'StreamProtocolError')
  )
    return error.message;
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'The request timed out. Refresh to check its result before retrying.';
  return 'The request could not be completed. Check your connection and try again.';
}
function queryString(query: IncidentQuery | PageQuery) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) values.set(key, String(value));
  return values.size ? `?${values}` : '';
}

export class ApiClient {
  private csrf = '';
  constructor(private readonly onExpired: () => void = () => {}) {}
  private async response(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (init.method && init.method !== 'GET' && this.csrf) headers.set('X-CSRF-Token', this.csrf);
    const response = await fetch(`/api${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login') {
        this.csrf = '';
        this.onExpired();
      }
      const body: unknown = await response.json().catch(() => null);
      if (Value.Check(ErrorSchema, body))
        throw new ApiFailure(body.error, body.code, response.status);
      throw new ApiFailure(
        'The server returned an unexpected response.',
        'invalid_response',
        response.status,
      );
    }
    return response;
  }
  private async json<S extends TSchema>(
    path: string,
    schema: S,
    init?: RequestInit,
  ): Promise<Static<S>> {
    const response = await this.response(path, init);
    const body: unknown = await response.json().catch(() => null);
    if (!Value.Check(schema, body))
      throw new ApiFailure(
        'The server returned an unexpected response.',
        'invalid_response',
        response.status,
      );
    return body;
  }
  async session(signal?: AbortSignal) {
    const auth = await this.json('/auth/session', AuthSchema, signal ? { signal } : {});
    this.csrf = auth.csrf_token;
    return auth;
  }
  async login(input: Login) {
    const auth = await this.json('/auth/login', AuthSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    this.csrf = auth.csrf_token;
    return auth;
  }
  async logout() {
    await this.response('/auth/logout', { method: 'POST' });
    this.csrf = '';
  }
  list(query: IncidentQuery, signal?: AbortSignal) {
    return this.json(
      `/incidents${queryString(query)}`,
      IncidentPageSchema,
      signal ? { signal } : {},
    );
  }
  get(id: string, signal?: AbortSignal) {
    return this.json(`/incidents/${id}`, IncidentSchema, signal ? { signal } : {});
  }
  create(input: IncidentInput) {
    return this.json('/incidents', IncidentSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  update(id: string, input: IncidentPatch) {
    return this.json(`/incidents/${id}`, IncidentSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  async delete(id: string) {
    await this.response(`/incidents/${id}`, { method: 'DELETE' });
  }
  notes(id: string, query: PageQuery = {}, signal?: AbortSignal) {
    return this.json(
      `/incidents/${id}/notes${queryString(query)}`,
      NotePageSchema,
      signal ? { signal } : {},
    );
  }
  addNote(id: string, body: string) {
    return this.json(`/incidents/${id}/notes`, NoteSchema, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
  async deleteNote(id: string, noteId: string) {
    await this.response(`/incidents/${id}/notes/${noteId}`, {
      method: 'DELETE',
    });
  }
  async *summary(id: string, signal: AbortSignal) {
    const response = await this.response(`/incidents/${id}/summary`, {
      method: 'POST',
      signal,
    });
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new ApiFailure(
        'The server did not return a summary stream.',
        'invalid_response',
        response.status,
      );
    }
    yield* readSummaryStream(response.body, signal);
  }
}
