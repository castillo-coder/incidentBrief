import type { PageQuery } from '@incidentbrief/contracts';
import type { IncidentRepository, NoteRepository } from '../domain/ports.js';
import { invalid, notFound } from '../domain/errors.js';

export class NoteService {
  constructor(
    private readonly incidents: IncidentRepository,
    private readonly notes: NoteRepository,
  ) {}
  async list(ownerId: string, incidentId: string, query: PageQuery) {
    if (!(await this.incidents.get(ownerId, incidentId))) throw notFound();
    return this.notes.list(ownerId, incidentId, query);
  }
  async add(ownerId: string, incidentId: string, body: string) {
    if (!body.trim()) throw invalid('A note cannot be blank.');
    const note = await this.notes.add(ownerId, incidentId, body.trim());
    if (!note) throw notFound();
    return note;
  }
  async delete(ownerId: string, incidentId: string, noteId: string) {
    if (!(await this.notes.delete(ownerId, incidentId, noteId))) throw notFound();
  }
}
