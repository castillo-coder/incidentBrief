import Fastify, {
  LogController,
  type FastifyRequest,
  type FastifyServerOptions,
  type FastifyError,
} from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  AuthSchema,
  ErrorSchema,
  IncidentInputSchema,
  IncidentPatchSchema,
  IncidentSchema,
  IncidentPageSchema,
  IncidentParamsSchema,
  IncidentQuerySchema,
  LoginSchema,
  NoteInputSchema,
  NotePageSchema,
  NoteSchema,
  NoteParamsSchema,
  PageQuerySchema,
  type IncidentInput,
  type IncidentPatch,
  type IncidentParams,
  type IncidentQuery,
  type Login,
  type NoteInput,
  type NoteParams,
  type PageQuery,
  type User,
} from '@incidentbrief/contracts';
import { AppError, unauthenticated } from '../domain/errors.js';
import { csrfToken, type AuthService } from '../services/auth-service.js';
import type { IncidentService } from '../services/incident-service.js';
import type { NoteService } from '../services/note-service.js';
import type { SummaryService } from '../services/summary-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: User | null;
    sessionToken: string | null;
  }
}
export interface AppOptions {
  auth: AuthService;
  incidents: IncidentService;
  notes: NoteService;
  summaries: SummaryService;
  origin: string;
  production: boolean;
  staticRoot?: string;
  logger?: FastifyServerOptions['logger'];
}

export async function createApp(options: AppOptions) {
  const app = Fastify({
    bodyLimit: 20000,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: options.production ? (_address, hop) => hop < 1 : false,
    logger: options.logger ?? { level: 'info' },
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionToken', null);
  await app.register(cookie);
  await app.register(helmet, {
    strictTransportSecurity: options.production
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  });
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (
      ['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method) &&
      request.headers.origin !== options.origin
    ) {
      throw new AppError('csrf_failed', 'The request origin is not allowed.', 403);
    }
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        request_id: request.id,
        method: request.method,
        route: request.routeOptions.url,
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    let failure: AppError;
    if (error instanceof AppError) failure = error;
    else if (
      error.validation ||
      (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
    ) {
      failure =
        error.statusCode === 429
          ? new AppError('rate_limited', 'Too many requests. Please try again later.', 429)
          : new AppError(
              'invalid_request',
              'The request does not match the API contract.',
              error.statusCode ?? 400,
            );
    } else {
      failure = new AppError('internal_error', 'The request could not be completed.', 500);
      request.log.error({ request_id: request.id, code: failure.code }, 'request failed');
    }
    reply.code(failure.status).send({
      error: failure.message,
      code: failure.code,
      request_id: request.id,
    });
  });

  const cookieOptions = {
    path: '/api',
    httpOnly: true,
    secure: options.production,
    sameSite: 'lax' as const,
    maxAge: 8 * 60 * 60,
  };
  const authenticate = async (request: FastifyRequest) => {
    request.actor = await options.auth.authenticate(request.cookies.session);
    request.sessionToken = request.cookies.session ?? null;
    if (['POST', 'PATCH', 'DELETE'].includes(request.method))
      options.auth.checkCsrf(
        request.sessionToken!,
        typeof request.headers['x-csrf-token'] === 'string'
          ? request.headers['x-csrf-token']
          : undefined,
      );
  };
  const actorId = (request: FastifyRequest) => {
    if (!request.actor) throw unauthenticated();
    return request.actor.id;
  };
  const failures = { '4xx': ErrorSchema, '5xx': ErrorSchema };

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/version', async () => ({
    version: process.env.APP_COMMIT ?? 'development',
  }));

  app.post<{ Body: Login }>(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: LoginSchema, response: { 200: AuthSchema, ...failures } },
    },
    async (request, reply) => {
      const result = await options.auth.login(request.body);
      reply.setCookie('session', result.token, cookieOptions);
      return { user: result.user, csrf_token: result.csrf_token };
    },
  );
  app.get(
    '/api/auth/session',
    {
      preHandler: authenticate,
      schema: { response: { 200: AuthSchema, ...failures } },
    },
    async (request) => ({
      user: request.actor!,
      csrf_token: csrfToken(request.sessionToken!),
    }),
  );
  app.post('/api/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    await options.auth.logout(request.sessionToken!);
    reply.clearCookie('session', {
      path: '/api',
      httpOnly: true,
      secure: options.production,
      sameSite: 'lax',
    });
    return reply.code(204).send();
  });

  app.get<{ Querystring: IncidentQuery }>(
    '/api/incidents',
    {
      preHandler: authenticate,
      schema: {
        querystring: IncidentQuerySchema,
        response: { 200: IncidentPageSchema, ...failures },
      },
    },
    (request) => options.incidents.list(actorId(request), request.query),
  );
  app.post<{ Body: IncidentInput }>(
    '/api/incidents',
    {
      preHandler: authenticate,
      schema: {
        body: IncidentInputSchema,
        response: { 201: IncidentSchema, ...failures },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await options.incidents.create(actorId(request), request.body)),
  );
  app.get<{ Params: IncidentParams }>(
    '/api/incidents/:id',
    {
      preHandler: authenticate,
      schema: {
        params: IncidentParamsSchema,
        response: { 200: IncidentSchema, ...failures },
      },
    },
    (request) => options.incidents.get(actorId(request), request.params.id),
  );
  app.patch<{ Params: IncidentParams; Body: IncidentPatch }>(
    '/api/incidents/:id',
    {
      preHandler: authenticate,
      schema: {
        params: IncidentParamsSchema,
        body: IncidentPatchSchema,
        response: { 200: IncidentSchema, ...failures },
      },
    },
    (request) => options.incidents.update(actorId(request), request.params.id, request.body),
  );
  app.delete<{ Params: IncidentParams }>(
    '/api/incidents/:id',
    {
      preHandler: authenticate,
      schema: { params: IncidentParamsSchema },
    },
    async (request, reply) => {
      await options.incidents.delete(actorId(request), request.params.id);
      return reply.code(204).send();
    },
  );
  app.get<{ Params: IncidentParams; Querystring: PageQuery }>(
    '/api/incidents/:id/notes',
    {
      preHandler: authenticate,
      schema: {
        params: IncidentParamsSchema,
        querystring: PageQuerySchema,
        response: { 200: NotePageSchema, ...failures },
      },
    },
    (request) => options.notes.list(actorId(request), request.params.id, request.query),
  );
  app.post<{ Params: IncidentParams; Body: NoteInput }>(
    '/api/incidents/:id/notes',
    {
      preHandler: authenticate,
      schema: {
        params: IncidentParamsSchema,
        body: NoteInputSchema,
        response: { 201: NoteSchema, ...failures },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await options.notes.add(actorId(request), request.params.id, request.body.body)),
  );
  app.delete<{ Params: NoteParams }>(
    '/api/incidents/:id/notes/:noteId',
    {
      preHandler: authenticate,
      schema: { params: NoteParamsSchema },
    },
    async (request, reply) => {
      await options.notes.delete(actorId(request), request.params.id, request.params.noteId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: IncidentParams }>(
    '/api/incidents/:id/summary',
    {
      preHandler: authenticate,
      schema: { params: IncidentParamsSchema },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const generation = await options.summaries.prepare(actorId(request), request.params.id);
      const abort = new AbortController();
      const close = () => abort.abort();
      reply.raw.on('close', close);
      reply.hijack();
      try {
        if (reply.raw.destroyed) return;
        for (const [name, value] of Object.entries(reply.getHeaders())) {
          if (value !== undefined) reply.raw.setHeader(name, value);
        }
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.writeHead(200);
        reply.raw.flushHeaders();
        for await (const event of generation.events(abort.signal)) {
          if (abort.signal.aborted) break;
          if (!reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
            await once(reply.raw, 'drain', { signal: abort.signal });
        }
      } catch {
        if (!reply.raw.destroyed)
          reply.raw.write(
            `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'generation_failed', error: 'The summary could not be completed.' })}\n\n`,
          );
      } finally {
        generation.release();
        reply.raw.off('close', close);
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );

  if (options.staticRoot && existsSync(options.staticRoot)) {
    await app.register(serveStatic, { root: options.staticRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET')
        return reply.code(404).send({
          error: 'The endpoint was not found.',
          code: 'not_found',
          request_id: request.id,
        });
      return reply.sendFile('index.html');
    });
  } else
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        error: 'The endpoint was not found.',
        code: 'not_found',
        request_id: request.id,
      }),
    );
  return app;
}
