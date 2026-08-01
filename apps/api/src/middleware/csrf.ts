import { Request, Response, NextFunction } from 'express';

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const header = req.header('X-CSRF-Token');
  const record = req.sessionRecord;

  if (!record || !header || header !== record.csrfToken) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
}
