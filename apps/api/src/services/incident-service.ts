import type { IncidentInput, IncidentPatch, IncidentQuery } from '@incidentbrief/contracts';
import type { IncidentRepository } from '../domain/ports.js';
import { invalid, notFound } from '../domain/errors.js';

export class IncidentService {
  constructor(private readonly repository: IncidentRepository) {}

  list(ownerId: string, query: IncidentQuery) {
    return this.repository.list(ownerId, query);
  }

  async get(ownerId: string, id: string) {
    const incident = await this.repository.get(ownerId, id);
    if (!incident) throw notFound();
    return incident;
  }

  create(ownerId: string, input: IncidentInput) {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) throw invalid('Title and description cannot be blank.');
    return this.repository.create(ownerId, { ...input, title, description });
  }

  async update(ownerId: string, id: string, input: IncidentPatch) {
    const patch = { ...input };
    if (patch.title !== undefined) patch.title = patch.title.trim();
    if (patch.description !== undefined) patch.description = patch.description.trim();
    if (patch.title === '' || patch.description === '')
      throw invalid('Title and description cannot be blank.');
    if (!Object.keys(patch).length) throw invalid();
    const incident = await this.repository.update(ownerId, id, patch);
    if (!incident) throw notFound();
    return incident;
  }

  async delete(ownerId: string, id: string) {
    if (!(await this.repository.delete(ownerId, id))) throw notFound();
  }
}
