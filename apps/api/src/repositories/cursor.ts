import { invalid } from '../domain/errors.js';

export interface Cursor {
  created_at: string;
  id: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function decodeCursor(value?: string): Cursor | undefined {
  if (!value) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 512) throw invalid();
    const data: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      !('id' in data) ||
      !('created_at' in data) ||
      typeof data.id !== 'string' ||
      typeof data.created_at !== 'string' ||
      !uuid.test(data.id)
    )
      throw invalid();
    if (new Date(data.created_at).toISOString() !== data.created_at) throw invalid();
    return { id: data.id, created_at: data.created_at };
  } catch {
    throw invalid('The pagination cursor is invalid.');
  }
}
export const encodeCursor = (value: Cursor) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
