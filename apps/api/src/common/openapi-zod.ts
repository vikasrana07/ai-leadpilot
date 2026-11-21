import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

type Json = Record<string, unknown>;

/** Zod schema -> OpenAPI 3.0 schema object, so the generated web client is typed from the same schemas that validate requests. */
export function toOpenApi(schema: z.ZodType, io: 'input' | 'output' = 'input'): Json {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Json;
  return rest;
}

/** Documents a request body from a zod schema. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: toOpenApi(schema) as never });

/** Documents a 200 (or 201) response body from a zod schema. */
export const ApiZodOk = (schema: z.ZodType, created = false) => (created ? ApiCreatedResponse : ApiOkResponse)({ schema: toOpenApi(schema, 'output') as never });

/** Documents each field of a zod object schema as a query parameter. */
export function ApiZodQuery(schema: z.ZodObject) {
  const json = toOpenApi(schema) as { properties?: Record<string, Json>; required?: string[] };
  return applyDecorators(...Object.entries(json.properties ?? {}).map(([name, s]) => ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: s as never })));
}
