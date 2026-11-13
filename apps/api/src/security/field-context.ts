/** Bind ciphertext to its owner, parent, record and field; IDs are immutable. */
export const incidentContext = (ownerId: string, id: string) =>
  JSON.stringify([
    'incidentbrief',
    1,
    'incidents',
    'description',
    ownerId.toLowerCase(),
    id.toLowerCase(),
  ]);
export const noteContext = (ownerId: string, incidentId: string, id: string) =>
  JSON.stringify([
    'incidentbrief',
    1,
    'notes',
    'body',
    ownerId.toLowerCase(),
    incidentId.toLowerCase(),
    id.toLowerCase(),
  ]);
