import type { Page } from '@incidentbrief/contracts';
import { encodeCursor, type Cursor } from './cursor.js';

export function page<T extends Cursor>(rows: T[], limit: number): Page<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ id: last.id, created_at: last.created_at })
        : null,
  };
}
