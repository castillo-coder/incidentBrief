import type { ErrorCode } from '@incidentbrief/contracts';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export const notFound = () => new AppError('not_found', 'The requested record was not found.', 404);
export const invalid = (message = 'The request is invalid.') =>
  new AppError('invalid_request', message, 400);
export const unauthenticated = () => new AppError('unauthenticated', 'Please sign in.', 401);
