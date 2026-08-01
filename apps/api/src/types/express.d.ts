import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    sessionRecord?: {
      id: string;
      userId: string;
      csrfToken: string;
      expiresAt: Date;
    };
  }
}
