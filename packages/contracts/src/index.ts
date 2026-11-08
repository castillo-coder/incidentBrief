import { Type, type Static } from '@sinclair/typebox';

const options = { additionalProperties: false } as const;
export const IdSchema = Type.String({ format: 'uuid' });
export const StatusSchema = Type.Union([Type.Literal('open'), Type.Literal('resolved')]);
export const SeveritySchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);
export const ErrorCodeSchema = Type.Union([
  Type.Literal('invalid_request'),
  Type.Literal('invalid_credentials'),
  Type.Literal('unauthenticated'),
  Type.Literal('csrf_failed'),
  Type.Literal('not_found'),
  Type.Literal('conflict'),
  Type.Literal('rate_limited'),
  Type.Literal('provider_unavailable'),
  Type.Literal('generation_failed'),
  Type.Literal('generation_timeout'),
  Type.Literal('internal_error'),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;
export const ErrorSchema = Type.Object(
  { error: Type.String(), code: ErrorCodeSchema, request_id: Type.String() },
  options,
);
export type ApiError = Static<typeof ErrorSchema>;
export const UserSchema = Type.Object({ id: IdSchema, email: Type.String() }, options);
export type User = Static<typeof UserSchema>;
export const LoginSchema = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 72 }),
  },
  options,
);
export type Login = Static<typeof LoginSchema>;
export const AuthSchema = Type.Object({ user: UserSchema, csrf_token: Type.String() }, options);
export type Auth = Static<typeof AuthSchema>;
export const IncidentInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.String({ minLength: 1, maxLength: 12000 }),
    severity: SeveritySchema,
  },
  options,
);
export type IncidentInput = Static<typeof IncidentInputSchema>;
export const IncidentPatchSchema = Type.Partial(
  Type.Object(
    {
      ...IncidentInputSchema.properties,
      status: StatusSchema,
    },
    { ...options, minProperties: 1 },
  ),
);
export type IncidentPatch = Static<typeof IncidentPatchSchema>;
export const IncidentSchema = Type.Object(
  {
    id: IdSchema,
    title: Type.String(),
    description: Type.String(),
    severity: SeveritySchema,
    status: StatusSchema,
    created_at: Type.String({ format: 'date-time' }),
    updated_at: Type.String({ format: 'date-time' }),
  },
  options,
);
export type Incident = Static<typeof IncidentSchema>;
export const NoteInputSchema = Type.Object(
  { body: Type.String({ minLength: 1, maxLength: 8000 }) },
  options,
);
export type NoteInput = Static<typeof NoteInputSchema>;
export const NoteSchema = Type.Object(
  {
    id: IdSchema,
    incident_id: IdSchema,
    body: Type.String(),
    created_at: Type.String({ format: 'date-time' }),
  },
  options,
);
export type Note = Static<typeof NoteSchema>;
const pageProperties = {
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
};
export const PageQuerySchema = Type.Object(pageProperties, options);
export type PageQuery = Static<typeof PageQuerySchema>;
export const IncidentQuerySchema = Type.Object(
  { ...pageProperties, status: Type.Optional(StatusSchema) },
  options,
);
export type IncidentQuery = Static<typeof IncidentQuerySchema>;
export const IncidentParamsSchema = Type.Object({ id: IdSchema }, options);
export type IncidentParams = Static<typeof IncidentParamsSchema>;
export const NoteParamsSchema = Type.Object({ id: IdSchema, noteId: IdSchema }, options);
export type NoteParams = Static<typeof NoteParamsSchema>;
export function pageSchema<T extends typeof IncidentSchema | typeof NoteSchema>(item: T) {
  return Type.Object(
    { data: Type.Array(item), next_cursor: Type.Union([Type.String(), Type.Null()]) },
    options,
  );
}
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}
export const IncidentPageSchema = pageSchema(IncidentSchema);
export const NotePageSchema = pageSchema(NoteSchema);
export const SummaryEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('delta'), text: Type.String() }, options),
  Type.Object({ type: Type.Literal('done') }, options),
  Type.Object(
    { type: Type.Literal('error'), code: ErrorCodeSchema, error: Type.String() },
    options,
  ),
]);
export type SummaryEvent = Static<typeof SummaryEventSchema>;
