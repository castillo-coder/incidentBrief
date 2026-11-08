import type { SummaryEvent } from '@incidentbrief/contracts';
import type { IncidentRepository, NoteRepository, SummaryProvider } from '../domain/ports.js';
import { AppError, notFound } from '../domain/errors.js';

export class SummaryService {
  private readonly activeUsers = new Set<string>();
  constructor(
    private readonly repository: IncidentRepository,
    private readonly notes: NoteRepository,
    private readonly provider: SummaryProvider,
    private readonly timeoutMs = 30000,
  ) {}

  async prepare(ownerId: string, incidentId: string) {
    const incident = await this.repository.get(ownerId, incidentId);
    if (!incident) throw notFound();
    if (!this.provider.available())
      throw new AppError('provider_unavailable', 'AI summaries are not configured.', 503);
    if (this.activeUsers.has(ownerId))
      throw new AppError('conflict', 'A summary is already being generated.', 409);
    // Reserve before the next await so overlapping preparations cannot both enter.
    this.activeUsers.add(ownerId);
    let released = false;
    const release = () => {
      if (!released) {
        this.activeUsers.delete(ownerId);
        released = true;
      }
    };
    try {
      const notes = await this.notes.latest(ownerId, incidentId);
      const context = JSON.stringify({
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        notes: notes.map((note) => ({ body: note.body, at: note.created_at })),
      });
      if (context.length > 20000)
        throw new AppError(
          'invalid_request',
          'The incident context exceeds 20,000 characters.',
          400,
        );
      return {
        release,
        events: (signal: AbortSignal) => this.generate(context, signal, release),
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private async *generate(
    context: string,
    signal: AbortSignal,
    release: () => void,
  ): AsyncGenerator<SummaryEvent> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      for await (const text of this.provider.stream(context, combined)) {
        if (combined.aborted) throw combined.reason;
        yield { type: 'delta', text };
      }
      if (combined.aborted) throw combined.reason;
      yield { type: 'done' };
    } catch {
      if (!signal.aborted)
        yield timeout.aborted
          ? {
              type: 'error',
              code: 'generation_timeout',
              error: 'Summary generation timed out. Please try again.',
            }
          : {
              type: 'error',
              code: 'generation_failed',
              error: 'The summary could not be completed. Please try again.',
            };
    } finally {
      release();
    }
  }
}
