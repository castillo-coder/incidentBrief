import type { Incident, IncidentInput, IncidentPatch, Note } from '@incidentbrief/contracts';
import type { IncidentRow, NoteRow } from '../db/schema.js';
import type { FieldCipher } from '../domain/ports.js';

import { incidentContext, noteContext } from '../security/field-context.js';

/** Keep persistence encryption and HTTP/domain representation in one boundary. */
export class StorageMapper {
  constructor(private readonly cipher: FieldCipher) {}
  incident(row: IncidentRow): Incident {
    return {
      id: row.id,
      title: row.title,
      description: this.cipher.decrypt(
        row.descriptionCiphertext,
        incidentContext(row.ownerId, row.id),
      ),
      severity: row.severity,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
  note(row: NoteRow, ownerId: string): Note {
    return {
      id: row.id,
      incident_id: row.incidentId,
      body: this.cipher.decrypt(row.bodyCiphertext, noteContext(ownerId, row.incidentId, row.id)),
      created_at: row.createdAt.toISOString(),
    };
  }
  incidentValues(ownerId: string, id: string, input: IncidentInput) {
    return {
      id,
      ownerId,
      title: input.title,
      severity: input.severity,
      descriptionCiphertext: this.cipher.encrypt(input.description, incidentContext(ownerId, id)),
    };
  }
  incidentPatch(ownerId: string, id: string, input: IncidentPatch) {
    return {
      title: input.title,
      severity: input.severity,
      status: input.status,
      updatedAt: new Date(),
      ...(input.description !== undefined
        ? {
            descriptionCiphertext: this.cipher.encrypt(
              input.description,
              incidentContext(ownerId, id),
            ),
          }
        : {}),
    };
  }
  noteValues(ownerId: string, incidentId: string, id: string, body: string) {
    return {
      id,
      incidentId,
      bodyCiphertext: this.cipher.encrypt(body, noteContext(ownerId, incidentId, id)),
    };
  }
}
