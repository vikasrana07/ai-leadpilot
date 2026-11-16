import { appointmentCreateSchema, createLeadSchema, noteSchema, stageChangeSchema, updateLeadSchema } from '@leadpilot/validation';
import { z } from 'zod';

interface RouteDoc { method: 'get' | 'post' | 'patch' | 'delete'; path: string; scope: string | null; summary: string; body?: z.ZodType; query?: { name: string; description: string }[]; status: number; idempotent?: boolean }

/** Single source of truth for the documented surface; a test checks it against the routes the controller really registers. */
export const V1_ROUTES: RouteDoc[] = [
  { method: 'get', path: '/v1/me', scope: null, summary: 'Describe the API key making the request', status: 200 },
  { method: 'get', path: '/v1/meta', scope: 'leads:read', summary: 'Lead sources, tags and custom field definitions', status: 200 },
  { method: 'get', path: '/v1/leads', scope: 'leads:read', summary: 'List and search leads (paginated)', status: 200, query: [
    { name: 'q', description: 'Search name, phone or email' }, { name: 'stageId', description: 'Pipeline stage id' }, { name: 'temperature', description: 'HOT | WARM | COLD | UNKNOWN' },
    { name: 'assigned', description: '"unassigned" or a membership id' }, { name: 'sourceId', description: 'Lead source id' }, { name: 'createdFrom', description: 'ISO date-time' }, { name: 'createdTo', description: 'ISO date-time' },
    { name: 'sort', description: 'createdAt | updatedAt | name | score' }, { name: 'dir', description: 'asc | desc' }, { name: 'page', description: '1-based page' }, { name: 'limit', description: '1-100, default 25' }] },
  { method: 'post', path: '/v1/leads', scope: 'leads:write', summary: 'Create a lead', body: createLeadSchema, status: 201, idempotent: true },
  { method: 'get', path: '/v1/leads/{id}', scope: 'leads:read', summary: 'Get a lead', status: 200 },
  { method: 'patch', path: '/v1/leads/{id}', scope: 'leads:write', summary: 'Update a lead', body: updateLeadSchema, status: 200 },
  { method: 'delete', path: '/v1/leads/{id}', scope: 'leads:delete', summary: 'Delete a lead (soft delete)', status: 204 },
  { method: 'post', path: '/v1/leads/{id}/stage', scope: 'leads:write', summary: 'Move a lead to another pipeline stage', body: stageChangeSchema, status: 200 },
  { method: 'get', path: '/v1/leads/{id}/notes', scope: 'leads:read', summary: 'List a lead\'s notes', status: 200 },
  { method: 'post', path: '/v1/leads/{id}/notes', scope: 'leads:write', summary: 'Add a note to a lead', body: noteSchema, status: 201, idempotent: true },
  { method: 'get', path: '/v1/conversations', scope: 'conversations:read', summary: 'List conversations (paginated)', status: 200 },
  { method: 'get', path: '/v1/conversations/{id}', scope: 'conversations:read', summary: 'Get a conversation', status: 200 },
  { method: 'get', path: '/v1/conversations/{id}/messages', scope: 'conversations:read', summary: 'List a conversation\'s messages (newest page; use before=<messageId>)', status: 200 },
  { method: 'get', path: '/v1/appointments', scope: 'appointments:read', summary: 'List appointments (from, to, status, leadId, membershipId)', status: 200 },
  { method: 'get', path: '/v1/appointments/{id}', scope: 'appointments:read', summary: 'Get an appointment', status: 200 },
  { method: 'post', path: '/v1/appointments', scope: 'appointments:write', summary: 'Book an appointment (409 when the slot is taken)', body: appointmentCreateSchema, status: 201, idempotent: true },
];

const errorSchema = { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, details: {} }, required: ['code', 'message'] } }, required: ['error'] };

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of V1_ROUTES) {
    const params = [...(r.path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : []), ...(r.query ?? []).map((q) => ({ name: q.name, in: 'query', required: false, description: q.description, schema: { type: 'string' } }))];
    (paths[r.path] ??= {})[r.method] = {
      summary: r.summary, ...(r.scope ? { description: `Required scope: \`${r.scope}\`` } : {}), operationId: `${r.method}${r.path.replace(/[/{}]/g, '_')}`, tags: [r.path.split('/')[2] ?? 'v1'],
      security: [{ bearerKey: [] }],
      parameters: [...params, ...(r.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: false, description: 'Makes retries safe: the same key and body replays the first response', schema: { type: 'string', minLength: 8, maxLength: 128 } }] : [])],
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(r.body, { unrepresentable: 'any' }) } } } } : {}),
      responses: {
        [String(r.status)]: { description: 'Success', ...(r.status === 204 ? {} : { content: { 'application/json': { schema: { type: 'object' } } } }) },
        '401': { description: 'Missing, invalid, revoked or expired API key', content: { 'application/json': { schema: errorSchema } } },
        '402': { description: 'Plan does not include the API, or the workspace is read-only', content: { 'application/json': { schema: errorSchema } } },
        '403': { description: 'The key lacks the required scope', content: { 'application/json': { schema: errorSchema } } },
        '429': { description: 'Rate limit exceeded (see Retry-After)', content: { 'application/json': { schema: errorSchema } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'LeadPilot public API', version: '1.0.0', description: 'Authenticate with `Authorization: Bearer lp_live_...` (create keys under Settings > API keys). Keys carry scopes; each key is rate limited per minute. Responses use `{ data }` envelopes; errors use `{ error: { code, message, requestId } }`.' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearerKey: { type: 'http', scheme: 'bearer', description: 'API key starting with lp_live_' } } },
    paths,
  };
}
