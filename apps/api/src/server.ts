import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { cleanupExpiredAuthState } from './lib/session';

if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key || Buffer.from(key, 'base64').length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must contain exactly 32 base64-encoded bytes');
  }
}

const prisma = new PrismaClient();
const app = createApp(prisma);
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'API listening', port }));
});

const cleanup = setInterval(
  () => {
    cleanupExpiredAuthState(prisma).catch((error) => {
      console.error(
        JSON.stringify({ level: 'error', message: 'Auth cleanup failed', error: String(error) })
      );
    });
  },
  60 * 60 * 1000
);
cleanup.unref();

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'info', message: 'Shutting down', signal }));
  clearInterval(cleanup);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
