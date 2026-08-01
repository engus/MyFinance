import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app';

const prisma = new PrismaClient();
const app = createApp(prisma);
const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
