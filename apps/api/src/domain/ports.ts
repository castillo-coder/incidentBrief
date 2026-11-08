import type {
  Incident,
  IncidentInput,
  IncidentPatch,
  IncidentQuery,
  Note,
  Page,
  PageQuery,
  User,
} from '@incidentbrief/contracts';

export interface AuthUser extends User {
  passwordHash: string;
}
export interface Session {
  user: User;
  expiresAt: Date;
}
export interface AuthRepository {
  findUser(email: string): Promise<AuthUser | undefined>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSession(tokenHash: string): Promise<Session | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
}
export interface IncidentRepository {
  list(ownerId: string, query: IncidentQuery): Promise<Page<Incident>>;
  get(ownerId: string, id: string): Promise<Incident | undefined>;
  create(ownerId: string, input: IncidentInput): Promise<Incident>;
  update(ownerId: string, id: string, input: IncidentPatch): Promise<Incident | undefined>;
  delete(ownerId: string, id: string): Promise<boolean>;
  listNotes(ownerId: string, incidentId: string, query: PageQuery): Promise<Page<Note>>;
  addNote(ownerId: string, incidentId: string, body: string): Promise<Note | undefined>;
  deleteNote(ownerId: string, incidentId: string, noteId: string): Promise<boolean>;
  summaryNotes(ownerId: string, incidentId: string): Promise<Note[]>;
}
export interface SummaryProvider {
  available(): boolean;
  stream(context: string, signal: AbortSignal): AsyncIterable<string>;
}
export interface FieldCipher {
  encrypt(text: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}
