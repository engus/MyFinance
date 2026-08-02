import { Request } from 'express';
import { z } from 'zod';
import { validationError } from './errors';

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw validationError(result.error);
  return result.data as z.output<S>;
}

export function requestMetadata(req: Request) {
  return {
    userAgent: req.get('user-agent')?.slice(0, 500),
    ipAddress: req.ip?.slice(0, 64),
  };
}
