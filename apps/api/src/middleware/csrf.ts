import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const header = req.header('X-CSRF-Token');
  const record = req.sessionRecord;

  if (!record || !header || header !== record.csrfToken) {
    next(new AppError(403, 'INVALID_CSRF', 'The CSRF token is invalid'));
    return;
  }

  next();
}
