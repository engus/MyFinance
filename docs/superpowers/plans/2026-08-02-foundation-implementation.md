# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the double-entry data model, and session-based auth described in `docs/superpowers/specs/2026-08-02-foundation-design.md`, ending with a working register/login/logout flow and a fully unit-tested ledger/reconciliation/rates core.

**Architecture:** npm-workspaces monorepo (`apps/api` — Express/TypeScript/Prisma/PostgreSQL, `apps/web` — React/TypeScript/Vite). Ledger, category, reconciliation and rate logic live as plain service modules with no HTTP exposure yet (that comes in the Cashflow/Assets sub-projects); only auth is exposed over HTTP in this plan, to prove the session/CSRF/rate-limit pipeline end-to-end.

**Tech Stack:** Node.js, TypeScript, Express, Prisma, PostgreSQL, argon2, zod, express-rate-limit, Vitest, supertest, React, Vite, react-router-dom, @testing-library/react.

## Global Constraints

- Password hashing: argon2id (spec: "Аутентификация и безопасность").
- Session cookie: `httpOnly` + `secure` + `SameSite=Lax`, stored in PostgreSQL (not Redis).
- CSRF: synchronizer token tied to the session record, required on authenticated mutating requests.
- Rate limiting required on `/api/auth/login` and `/api/auth/register`.
- Currency/security price source: Yahoo Finance API, behind a `RateProvider` interface, cached in the DB.
- Double-entry invariant: the signed amounts of a Transaction's Entries must sum to zero; enforced in both the service layer and a DB check constraint.
- System categories `Other` and `Unrealized Revaluation` are created automatically per user and are not user-deletable.
- Reconciliation mode (`AUTO` default vs `CONFIRM`) is a per-user setting.
- Test runner: Vitest for both `apps/api` and `apps/web`.
- Repo structure: `apps/api`, `apps/web`, single root `package.json` with npm workspaces.
- Login/register UI: centered-card layout (mockup variant A, approved during brainstorming).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (root)
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`

**Interfaces:**
- Produces: `apps/api` and `apps/web` as npm workspaces; a running local PostgreSQL on port 5432 with databases `myfinance` and `myfinance_test`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "myfinance",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: myfinance
      POSTGRES_PASSWORD: myfinance
      POSTGRES_DB: myfinance
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 3: Create `.env.example`**

```
DATABASE_URL=postgresql://myfinance:myfinance@localhost:5432/myfinance
DATABASE_URL_TEST=postgresql://myfinance:myfinance@localhost:5432/myfinance_test
```

Copy it to `.env` (gitignored) before continuing.

- [ ] **Step 4: Create `apps/api/package.json`**

```json
{
  "name": "@myfinance/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^5.20.0",
    "argon2": "^0.41.1",
    "cookie-parser": "^1.4.6",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "dotenv": "^16.4.5",
    "prisma": "^5.20.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 5: Create `apps/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 6: Create `apps/web/package.json`**

```json
{
  "name": "@myfinance/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 7: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Install and verify**

Run: `npm install`
Expected: installs without errors, `node_modules` created at root with workspace symlinks for `apps/api` and `apps/web`.

Run: `docker compose up -d`
Expected: `postgres` container running and healthy.

Run: `docker compose exec postgres psql -U myfinance -c "CREATE DATABASE myfinance_test;"`
Expected: `CREATE DATABASE`

- [ ] **Step 9: Commit**

```bash
git add package.json docker-compose.yml .env.example apps/api/package.json apps/api/tsconfig.json apps/web/package.json apps/web/tsconfig.json
git commit -m "chore: scaffold monorepo with api and web workspaces"
```

---

### Task 2: Prisma schema and initial migration

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Modify (via `prisma migrate dev`): `apps/api/prisma/migrations/*/migration.sql`
- Test: `apps/api/tests/schema.test.ts`
- Create: `apps/api/tests/helpers/db.ts`

**Interfaces:**
- Produces: Prisma models `User`, `Session`, `Account` (`kind`: `FINANCIAL`|`ASSET`), `Category` (`kind`: `INCOME`|`EXPENSE`), `Transaction`, `Entry`, `ExchangeRate`; a generated `@prisma/client` importable from `apps/api/src` and `apps/api/tests`.

- [ ] **Step 1: Write `apps/api/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AccountKind {
  FINANCIAL
  ASSET
}

enum CategoryKind {
  INCOME
  EXPENSE
}

enum TransactionFrequency {
  ONE_OFF
  RECURRING
}

enum RecurrenceInterval {
  WEEK
  MONTH
  QUARTER
  YEAR
  CUSTOM
}

enum ReconciliationMode {
  AUTO
  CONFIRM
}

model User {
  id                 String             @id @default(uuid())
  email              String             @unique
  passwordHash       String
  reconciliationMode ReconciliationMode @default(AUTO)
  createdAt          DateTime           @default(now())
  accounts           Account[]
  categories         Category[]
  transactions       Transaction[]
  sessions           Session[]
}

model Session {
  id        String   @id
  userId    String
  csrfToken String
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id        String      @id @default(uuid())
  userId    String
  name      String
  kind      AccountKind
  currency  String
  isSystem  Boolean     @default(false)
  createdAt DateTime    @default(now())
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries   Entry[]

  @@index([userId])
}

model Category {
  id        String       @id @default(uuid())
  userId    String
  name      String
  kind      CategoryKind
  isSystem  Boolean      @default(false)
  createdAt DateTime     @default(now())
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries   Entry[]

  @@index([userId])
  @@unique([userId, name])
}

model Transaction {
  id          String                @id @default(uuid())
  userId      String
  description String
  date        DateTime
  frequency   TransactionFrequency  @default(ONE_OFF)
  interval    RecurrenceInterval?
  customDays  Int?
  createdAt   DateTime              @default(now())
  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries     Entry[]

  @@index([userId])
}

model Entry {
  id            String      @id @default(uuid())
  transactionId String
  accountId     String?
  categoryId    String?
  amount        Decimal     @db.Decimal(18, 2)
  currency      String
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  account       Account?    @relation(fields: [accountId], references: [id])
  category      Category?   @relation(fields: [categoryId], references: [id])

  @@index([accountId])
  @@index([categoryId])
}

model ExchangeRate {
  id         String   @id @default(uuid())
  fromSymbol String
  toSymbol   String
  rate       Decimal  @db.Decimal(18, 6)
  fetchedAt  DateTime @default(now())

  @@unique([fromSymbol, toSymbol])
}
```

- [ ] **Step 2: Generate the migration**

Run (from `apps/api`, with `.env` present at repo root loaded, e.g. `export $(cat ../../.env | xargs)` or run from repo root with `--schema apps/api/prisma/schema.prisma`):

```bash
cd apps/api
npx prisma migrate dev --name init
```

Expected: creates `apps/api/prisma/migrations/<timestamp>_init/migration.sql` and applies it to `myfinance`.

- [ ] **Step 3: Add the double-entry check constraint**

Append to the generated `migration.sql`:

```sql
ALTER TABLE "Entry" ADD CONSTRAINT "entry_exactly_one_target"
  CHECK (
    ("accountId" IS NOT NULL AND "categoryId" IS NULL) OR
    ("accountId" IS NULL AND "categoryId" IS NOT NULL)
  );
```

Run: `npx prisma migrate reset --force` (re-applies all migrations including the edited one against `myfinance`)
Expected: migration reapplies cleanly, no errors.

- [ ] **Step 4: Apply the same migrations to the test database**

Run:

```bash
DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy
```

Expected: `myfinance_test` now has the same schema.

- [ ] **Step 5: Create `apps/api/tests/helpers/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

export async function truncateAll() {
  await testPrisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Entry", "Transaction", "ExchangeRate", "Category", "Account", "Session", "User" RESTART IDENTITY CASCADE'
  );
}
```

- [ ] **Step 6: Write `apps/api/tests/schema.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';

describe('schema', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a user and reads it back', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'a@b.com', passwordHash: 'hash' },
    });
    const found = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(found.email).toBe('a@b.com');
    expect(found.reconciliationMode).toBe('AUTO');
  });

  it('rejects an entry with both accountId and categoryId', async () => {
    const user = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    const tx = await testPrisma.transaction.create({
      data: { userId: user.id, description: 'x', date: new Date() },
    });

    await expect(
      testPrisma.entry.create({
        data: {
          transactionId: tx.id,
          accountId: account.id,
          categoryId: category.id,
          amount: '10.00',
          currency: 'USD',
        },
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run tests**

Run: `cd apps/api && npx vitest run tests/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/tests
git commit -m "feat: add prisma schema and double-entry check constraint"
```

---

### Task 3: Ledger service — double-entry invariant

**Files:**
- Create: `apps/api/src/modules/ledger/ledger.service.ts`
- Test: `apps/api/tests/ledger.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma.Decimal` from `@prisma/client` (Task 2 schema).
- Produces:
  - `createTransaction(prisma: PrismaClient, input: CreateTransactionInput): Promise<Transaction & { entries: Entry[] }>`
  - `getAccountBalance(prisma: PrismaClient, accountId: string): Promise<Prisma.Decimal>`
  - `class UnbalancedTransactionError extends Error`
  - `class InvalidEntryError extends Error`
  - `interface EntryInput { accountId?: string; categoryId?: string; amount: string; currency: string }`
  - `interface CreateTransactionInput { userId: string; description: string; date: Date; entries: [EntryInput, EntryInput]; frequency?: 'ONE_OFF' | 'RECURRING'; interval?: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM'; customDays?: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/ledger.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  createTransaction,
  getAccountBalance,
  UnbalancedTransactionError,
  InvalidEntryError,
} from '../src/modules/ledger/ledger.service';

describe('ledger.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  async function seedUserWithAccountAndCategory() {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    return { user, account, category };
  }

  it('creates a balanced transaction and updates the account balance', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary payment',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: category.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('1000');
  });

  it('rejects a transaction whose entries do not sum to zero', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await expect(
      createTransaction(testPrisma, {
        userId: user.id,
        description: 'Broken',
        date: new Date(),
        entries: [
          { accountId: account.id, amount: '100.00', currency: 'USD' },
          { categoryId: category.id, amount: '-50.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(UnbalancedTransactionError);
  });

  it('rejects an entry that references both an account and a category', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await expect(
      createTransaction(testPrisma, {
        userId: user.id,
        description: 'Broken',
        date: new Date(),
        entries: [
          { accountId: account.id, categoryId: category.id, amount: '0.00', currency: 'USD' },
          { categoryId: category.id, amount: '0.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(InvalidEntryError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/ledger.service.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/ledger/ledger.service'`

- [ ] **Step 3: Write `apps/api/src/modules/ledger/ledger.service.ts`**

```ts
import { PrismaClient, Prisma } from '@prisma/client';

export interface EntryInput {
  accountId?: string;
  categoryId?: string;
  amount: string;
  currency: string;
}

export interface CreateTransactionInput {
  userId: string;
  description: string;
  date: Date;
  entries: [EntryInput, EntryInput];
  frequency?: 'ONE_OFF' | 'RECURRING';
  interval?: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  customDays?: number;
}

export class UnbalancedTransactionError extends Error {}
export class InvalidEntryError extends Error {}

export async function createTransaction(prisma: PrismaClient, input: CreateTransactionInput) {
  for (const entry of input.entries) {
    const hasAccount = Boolean(entry.accountId);
    const hasCategory = Boolean(entry.categoryId);
    if (hasAccount === hasCategory) {
      throw new InvalidEntryError('Entry must reference exactly one of accountId or categoryId');
    }
  }

  const sum = input.entries.reduce(
    (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
    new Prisma.Decimal(0)
  );
  if (!sum.equals(0)) {
    throw new UnbalancedTransactionError(`Entries must sum to zero, got ${sum.toString()}`);
  }

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.date,
      frequency: input.frequency ?? 'ONE_OFF',
      interval: input.interval,
      customDays: input.customDays,
      entries: {
        create: input.entries.map((e) => ({
          accountId: e.accountId,
          categoryId: e.categoryId,
          amount: e.amount,
          currency: e.currency,
        })),
      },
    },
    include: { entries: true },
  });
}

export async function getAccountBalance(
  prisma: PrismaClient,
  accountId: string
): Promise<Prisma.Decimal> {
  const result = await prisma.entry.aggregate({
    where: { accountId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/ledger.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ledger apps/api/tests/ledger.service.test.ts
git commit -m "feat: add ledger service enforcing the double-entry invariant"
```

---

### Task 4: Category service — system category seeding

**Files:**
- Create: `apps/api/src/modules/categories/categories.service.ts`
- Test: `apps/api/tests/categories.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2 schema).
- Produces:
  - `SYSTEM_CATEGORY_OTHER: string`
  - `SYSTEM_CATEGORY_UNREALIZED_REVALUATION: string`
  - `seedSystemCategories(prisma: PrismaClient, userId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/categories.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  seedSystemCategories,
  SYSTEM_CATEGORY_OTHER,
  SYSTEM_CATEGORY_UNREALIZED_REVALUATION,
} from '../src/modules/categories/categories.service';

describe('categories.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates the two system categories for a new user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    await seedSystemCategories(testPrisma, user.id);

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    const names = categories.map((c) => c.name).sort();
    expect(names).toEqual([SYSTEM_CATEGORY_OTHER, SYSTEM_CATEGORY_UNREALIZED_REVALUATION].sort());
    expect(categories.every((c) => c.isSystem)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/modules/categories/categories.service.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const SYSTEM_CATEGORY_OTHER = 'Other';
export const SYSTEM_CATEGORY_UNREALIZED_REVALUATION = 'Unrealized Revaluation';

export async function seedSystemCategories(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.category.createMany({
    data: [
      { userId, name: SYSTEM_CATEGORY_OTHER, kind: 'EXPENSE', isSystem: true },
      { userId, name: SYSTEM_CATEGORY_UNREALIZED_REVALUATION, kind: 'INCOME', isSystem: true },
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/categories apps/api/tests/categories.service.test.ts
git commit -m "feat: seed system categories (Other, Unrealized Revaluation) per user"
```

---

### Task 5: Account service

**Files:**
- Create: `apps/api/src/modules/accounts/accounts.service.ts`
- Test: `apps/api/tests/accounts.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2), `getAccountBalance` (Task 3).
- Produces:
  - `createAccount(prisma: PrismaClient, params: { userId: string; name: string; kind: 'FINANCIAL' | 'ASSET'; currency: string }): Promise<Account>`
  - `listAccountsWithBalances(prisma: PrismaClient, userId: string): Promise<Array<Account & { balance: string }>>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/accounts.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createAccount, listAccountsWithBalances } from '../src/modules/accounts/accounts.service';
import { createTransaction } from '../src/modules/ledger/ledger.service';

describe('accounts.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates an account and lists it with a computed balance', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Checking',
      kind: 'FINANCIAL',
      currency: 'USD',
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });

    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '500.00', currency: 'USD' },
        { categoryId: category.id, amount: '-500.00', currency: 'USD' },
      ],
    });

    const accounts = await listAccountsWithBalances(testPrisma, user.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Checking');
    expect(accounts[0].balance).toBe('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/accounts.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/modules/accounts/accounts.service.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import { getAccountBalance } from '../ledger/ledger.service';

export async function createAccount(
  prisma: PrismaClient,
  params: { userId: string; name: string; kind: 'FINANCIAL' | 'ASSET'; currency: string }
) {
  return prisma.account.create({
    data: {
      userId: params.userId,
      name: params.name,
      kind: params.kind,
      currency: params.currency,
    },
  });
}

export async function listAccountsWithBalances(prisma: PrismaClient, userId: string) {
  const accounts = await prisma.account.findMany({ where: { userId } });
  const withBalances = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: (await getAccountBalance(prisma, account.id)).toString(),
    }))
  );
  return withBalances;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/accounts.service.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounts apps/api/tests/accounts.service.test.ts
git commit -m "feat: add account service with computed balances"
```

---

### Task 6: Reconciliation service

**Files:**
- Create: `apps/api/src/modules/reconciliation/reconciliation.service.ts`
- Test: `apps/api/tests/reconciliation.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma.Decimal` (Task 2); `getAccountBalance`, `createTransaction` (Task 3); `SYSTEM_CATEGORY_OTHER`, `seedSystemCategories` (Task 4).
- Produces:
  - `computeReconciliationDelta(prisma: PrismaClient, accountId: string, newBalance: string): Promise<Prisma.Decimal>`
  - `applyReconciliation(prisma: PrismaClient, params: { userId: string; accountId: string; newBalance: string; date: Date }): Promise<{ delta: Prisma.Decimal; applied: boolean }>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/reconciliation.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { seedSystemCategories, SYSTEM_CATEGORY_OTHER } from '../src/modules/categories/categories.service';
import { createAccount } from '../src/modules/accounts/accounts.service';
import { getAccountBalance } from '../src/modules/ledger/ledger.service';
import {
  computeReconciliationDelta,
  applyReconciliation,
} from '../src/modules/reconciliation/reconciliation.service';

describe('reconciliation.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('computes zero delta when the stated balance matches the ledger', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const delta = await computeReconciliationDelta(testPrisma, account.id, '0');
    expect(delta.toString()).toBe('0');
  });

  it('posts the delta to the Other category when applying', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await applyReconciliation(testPrisma, {
      userId: user.id,
      accountId: account.id,
      newBalance: '200.00',
      date: new Date(),
    });

    expect(result.applied).toBe(true);
    expect(result.delta.toString()).toBe('200');

    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('200');

    const otherCategory = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });
    const otherEntries = await testPrisma.entry.findMany({ where: { categoryId: otherCategory.id } });
    expect(otherEntries).toHaveLength(1);
    expect(otherEntries[0].amount.toString()).toBe('-200');
  });

  it('does not create a transaction when the delta is zero', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await applyReconciliation(testPrisma, {
      userId: user.id,
      accountId: account.id,
      newBalance: '0',
      date: new Date(),
    });

    expect(result.applied).toBe(false);
    const count = await testPrisma.transaction.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/reconciliation.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/modules/reconciliation/reconciliation.service.ts`**

```ts
import { PrismaClient, Prisma } from '@prisma/client';
import { createTransaction, getAccountBalance } from '../ledger/ledger.service';
import { SYSTEM_CATEGORY_OTHER } from '../categories/categories.service';

export async function computeReconciliationDelta(
  prisma: PrismaClient,
  accountId: string,
  newBalance: string
): Promise<Prisma.Decimal> {
  const currentBalance = await getAccountBalance(prisma, accountId);
  return new Prisma.Decimal(newBalance).minus(currentBalance);
}

export async function applyReconciliation(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; newBalance: string; date: Date }
): Promise<{ delta: Prisma.Decimal; applied: boolean }> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: params.accountId } });
  const delta = await computeReconciliationDelta(prisma, params.accountId, params.newBalance);

  if (delta.equals(0)) {
    return { delta, applied: false };
  }

  const otherCategory = await prisma.category.findFirstOrThrow({
    where: { userId: params.userId, name: SYSTEM_CATEGORY_OTHER, isSystem: true },
  });

  await createTransaction(prisma, {
    userId: params.userId,
    description: 'Balance reconciliation',
    date: params.date,
    entries: [
      { accountId: account.id, amount: delta.toString(), currency: account.currency },
      { categoryId: otherCategory.id, amount: delta.negated().toString(), currency: account.currency },
    ],
  });

  return { delta, applied: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/reconciliation.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reconciliation apps/api/tests/reconciliation.service.test.ts
git commit -m "feat: add reconciliation service posting deltas to Other category"
```

---

### Task 7: Rate provider abstraction, Yahoo Finance implementation, and caching

**Files:**
- Create: `apps/api/src/modules/rates/rateProvider.ts`
- Create: `apps/api/src/modules/rates/yahooRateProvider.ts`
- Create: `apps/api/src/modules/rates/rates.service.ts`
- Test: `apps/api/tests/rates.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma.Decimal` (Task 2).
- Produces:
  - `interface RateProvider { getRate(fromSymbol: string, toSymbol: string): Promise<number> }`
  - `class YahooRateProvider implements RateProvider`
  - `getCachedRate(prisma: PrismaClient, provider: RateProvider, fromSymbol: string, toSymbol: string): Promise<Prisma.Decimal>`

- [ ] **Step 1: Write `apps/api/src/modules/rates/rateProvider.ts`**

```ts
export interface RateProvider {
  getRate(fromSymbol: string, toSymbol: string): Promise<number>;
}
```

- [ ] **Step 2: Write `apps/api/src/modules/rates/yahooRateProvider.ts`**

```ts
import { RateProvider } from './rateProvider';

const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

export class YahooRateProvider implements RateProvider {
  async getRate(fromSymbol: string, toSymbol: string): Promise<number> {
    if (fromSymbol === toSymbol) return 1;

    const pairSymbol = `${fromSymbol}${toSymbol}=X`;
    const response = await fetch(`${YAHOO_QUOTE_URL}/${pairSymbol}`);
    if (!response.ok) {
      throw new Error(`Yahoo Finance request failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== 'number') {
      throw new Error(`Yahoo Finance response missing price for ${pairSymbol}`);
    }
    return price;
  }
}
```

- [ ] **Step 3: Write the failing test for `rates.service.ts`**

```ts
// apps/api/tests/rates.service.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { getCachedRate } from '../src/modules/rates/rates.service';
import type { RateProvider } from '../src/modules/rates/rateProvider';

describe('rates.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('returns 1 for identical symbols without calling the provider', async () => {
    const provider: RateProvider = { getRate: vi.fn() };
    const rate = await getCachedRate(testPrisma, provider, 'USD', 'USD');
    expect(rate.toString()).toBe('1');
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('fetches from the provider and caches the result', async () => {
    const getRate = vi.fn().mockResolvedValue(1.1);
    const provider: RateProvider = { getRate };

    const first = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(first.toNumber()).toBeCloseTo(1.1);
    expect(getRate).toHaveBeenCalledTimes(1);

    const second = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(second.toNumber()).toBeCloseTo(1.1);
    expect(getRate).toHaveBeenCalledTimes(1);
  });

  it('falls back to a stale cached rate if the provider call fails', async () => {
    const getRate = vi.fn().mockResolvedValueOnce(1.2).mockRejectedValueOnce(new Error('network down'));
    const provider: RateProvider = { getRate };

    await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    await testPrisma.exchangeRate.updateMany({
      where: { fromSymbol: 'USD', toSymbol: 'EUR' },
      data: { fetchedAt: new Date(Date.now() - 1000 * 60 * 60 * 2) },
    });

    const rate = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(rate.toNumber()).toBeCloseTo(1.2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/rates.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Write `apps/api/src/modules/rates/rates.service.ts`**

```ts
import { PrismaClient, Prisma } from '@prisma/client';
import { RateProvider } from './rateProvider';

const CACHE_TTL_MS = 1000 * 60 * 60;

export async function getCachedRate(
  prisma: PrismaClient,
  provider: RateProvider,
  fromSymbol: string,
  toSymbol: string
): Promise<Prisma.Decimal> {
  if (fromSymbol === toSymbol) return new Prisma.Decimal(1);

  const cached = await prisma.exchangeRate.findUnique({
    where: { fromSymbol_toSymbol: { fromSymbol, toSymbol } },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached.rate;
  }

  try {
    const rate = await provider.getRate(fromSymbol, toSymbol);
    const saved = await prisma.exchangeRate.upsert({
      where: { fromSymbol_toSymbol: { fromSymbol, toSymbol } },
      create: { fromSymbol, toSymbol, rate },
      update: { rate, fetchedAt: new Date() },
    });
    return saved.rate;
  } catch (err) {
    if (cached) return cached.rate;
    throw err;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/rates.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/rates apps/api/tests/rates.service.test.ts
git commit -m "feat: add Yahoo Finance rate provider with DB-cached lookups"
```

---

### Task 8: Session management

**Files:**
- Create: `apps/api/src/lib/session.ts`
- Test: `apps/api/tests/session.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2).
- Produces:
  - `createSession(prisma: PrismaClient, userId: string): Promise<{ token: string; csrfToken: string; expiresAt: Date }>`
  - `getSession(prisma: PrismaClient, token: string): Promise<{ id: string; userId: string; csrfToken: string; expiresAt: Date } | null>`
  - `destroySession(prisma: PrismaClient, token: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/session.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createSession, getSession, destroySession } from '../src/lib/session';

describe('session', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a session and can look it up by the returned token', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const created = await createSession(testPrisma, user.id);

    const found = await getSession(testPrisma, created.token);
    expect(found).not.toBeNull();
    expect(found?.userId).toBe(user.id);
    expect(found?.csrfToken).toBe(created.csrfToken);
  });

  it('returns null for an unknown token', async () => {
    const found = await getSession(testPrisma, 'not-a-real-token');
    expect(found).toBeNull();
  });

  it('destroySession invalidates the token', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const created = await createSession(testPrisma, user.id);

    await destroySession(testPrisma, created.token);

    const found = await getSession(testPrisma, created.token);
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/lib/session.ts`**

```ts
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  prisma: PrismaClient,
  userId: string
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { id: hashToken(token), userId, csrfToken, expiresAt },
  });

  return { token, csrfToken, expiresAt };
}

export async function getSession(prisma: PrismaClient, token: string) {
  const session = await prisma.session.findUnique({ where: { id: hashToken(token) } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroySession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/session.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/session.ts apps/api/tests/session.test.ts
git commit -m "feat: add PostgreSQL-backed session management"
```

---

### Task 9: Auth service — register and login

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Test: `apps/api/tests/auth.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2); `seedSystemCategories` (Task 4); `createSession` (Task 8).
- Produces:
  - `registerUser(prisma: PrismaClient, email: string, password: string): Promise<{ user: User; session: { token: string; csrfToken: string; expiresAt: Date } }>`
  - `loginUser(prisma: PrismaClient, email: string, password: string): Promise<{ user: User; session: { token: string; csrfToken: string; expiresAt: Date } }>`
  - `class EmailAlreadyRegisteredError extends Error`
  - `class InvalidCredentialsError extends Error`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/auth.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  registerUser,
  loginUser,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from '../src/modules/auth/auth.service';

describe('auth.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('registers a user, hashes the password, and seeds system categories', async () => {
    const { user, session } = await registerUser(testPrisma, 'a@b.com', 'password123');

    expect(user.email).toBe('a@b.com');
    expect(user.passwordHash).not.toBe('password123');
    expect(session.token).toBeTruthy();

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(2);
  });

  it('rejects registering the same email twice', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    await expect(registerUser(testPrisma, 'a@b.com', 'other-password')).rejects.toThrow(
      EmailAlreadyRegisteredError
    );
  });

  it('logs in with correct credentials', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    const { user, session } = await loginUser(testPrisma, 'a@b.com', 'password123');
    expect(user.email).toBe('a@b.com');
    expect(session.token).toBeTruthy();
  });

  it('rejects login with a wrong password', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    await expect(loginUser(testPrisma, 'a@b.com', 'wrong-password')).rejects.toThrow(
      InvalidCredentialsError
    );
  });

  it('rejects login for an unknown email', async () => {
    await expect(loginUser(testPrisma, 'nobody@b.com', 'password123')).rejects.toThrow(
      InvalidCredentialsError
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/auth.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/modules/auth/auth.service.ts`**

```ts
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../../lib/session';
import { seedSystemCategories } from '../categories/categories.service';

export class EmailAlreadyRegisteredError extends Error {}
export class InvalidCredentialsError extends Error {}

export async function registerUser(prisma: PrismaClient, email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailAlreadyRegisteredError();

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({ data: { email, passwordHash } });
  await seedSystemCategories(prisma, user.id);
  const session = await createSession(prisma, user.id);

  return { user, session };
}

export async function loginUser(prisma: PrismaClient, email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new InvalidCredentialsError();

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) throw new InvalidCredentialsError();

  const session = await createSession(prisma, user.id);
  return { user, session };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/auth.service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/tests/auth.service.test.ts
git commit -m "feat: add auth service for register/login with argon2id"
```

---

### Task 10: Auth middleware (session + CSRF)

**Files:**
- Create: `apps/api/src/types/express.d.ts`
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/middleware/csrf.ts`

**Interfaces:**
- Consumes: `getSession` (Task 8).
- Produces:
  - `requireAuth(prisma: PrismaClient): RequestHandler` — sets `req.userId` and `req.sessionRecord`, or responds `401`.
  - `requireCsrf(req, res, next)` — reads `req.sessionRecord` (must run after `requireAuth`) and header `X-CSRF-Token`, responds `403` on mismatch.

- [ ] **Step 1: Write `apps/api/src/types/express.d.ts`**

```ts
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
```

- [ ] **Step 2: Write `apps/api/src/middleware/auth.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getSession } from '../lib/session';

export function requireAuth(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.sid as string | undefined;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const session = await getSession(prisma, token);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.userId = session.userId;
    req.sessionRecord = session;
    next();
  };
}
```

- [ ] **Step 3: Write `apps/api/src/middleware/csrf.ts`**

```ts
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
```

This task has no standalone unit test — `requireAuth` and `requireCsrf` are exercised end-to-end by the integration tests in Task 11.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/types/express.d.ts apps/api/src/middleware
git commit -m "feat: add session auth and CSRF middleware"
```

---

### Task 11: Express app wiring — auth routes with rate limiting

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Test: `apps/api/tests/auth.routes.test.ts`

**Interfaces:**
- Consumes: `registerUser`, `loginUser`, error classes (Task 9); `destroySession` (Task 8); `requireAuth` (Task 10); `PrismaClient`.
- Produces: `createApp(prisma: PrismaClient): express.Express` with routes `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

- [ ] **Step 1: Write the failing integration tests**

```ts
// apps/api/tests/auth.routes.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

describe('auth routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('registers, reads /me, and logs out', async () => {
    const agent = request.agent(app);

    const registerRes = await agent
      .post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'password123' });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.email).toBe('a@b.com');
    const csrfToken = registerRes.body.csrfToken as string;

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('a@b.com');

    const logoutRes = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken);
    expect(logoutRes.status).toBe(204);

    const meAfterLogout = await agent.get('/api/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects logout without a valid CSRF token', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'a@b.com', password: 'password123' });

    const res = await agent.post('/api/auth/logout').set('X-CSRF-Token', 'wrong-token');
    expect(res.status).toBe(403);
  });

  it('rejects login with a wrong password', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects registration with an invalid payload', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/auth.routes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/api/src/app.ts`**

```ts
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  registerUser,
  loginUser,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './modules/auth/auth.service';
import { destroySession } from './lib/session';
import { requireAuth } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function createApp(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function setSessionCookie(
    res: express.Response,
    session: { token: string; expiresAt: Date }
  ) {
    res.cookie('sid', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: session.expiresAt,
    });
  }

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const { user, session } = await registerUser(prisma, parsed.data.email, parsed.data.password);
      setSessionCookie(res, session);
      res.status(201).json({ id: user.id, email: user.email, csrfToken: session.csrfToken });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw err;
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const { user, session } = await loginUser(prisma, parsed.data.email, parsed.data.password);
      setSessionCookie(res, session);
      res.json({ id: user.id, email: user.email, csrfToken: session.csrfToken });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      throw err;
    }
  });

  app.post('/api/auth/logout', requireAuth(prisma), requireCsrf, async (req, res) => {
    await destroySession(prisma, req.cookies.sid);
    res.clearCookie('sid');
    res.status(204).send();
  });

  app.get('/api/auth/me', requireAuth(prisma), async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    res.json({ id: user.id, email: user.email });
  });

  return app;
}
```

- [ ] **Step 4: Write `apps/api/src/server.ts`**

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app';

const prisma = new PrismaClient();
const app = createApp(prisma);
const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/auth.routes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full backend test suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/server.ts apps/api/tests/auth.routes.test.ts
git commit -m "feat: wire auth routes with rate limiting, CSRF, and session cookies"
```

---

### Task 12: Frontend scaffold and API client

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/auth.ts`
- Test: `apps/web/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `apiFetch(path: string, options?: RequestInit): Promise<any>`
  - `setCsrfToken(token: string): void`
  - `register(email: string, password: string): Promise<{ id: string; email: string; csrfToken: string }>`
  - `login(email: string, password: string): Promise<{ id: string; email: string; csrfToken: string }>`
  - `fetchCurrentUser(): Promise<{ id: string; email: string }>`

- [ ] **Step 1: Write `apps/web/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>MyFinance</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

- [ ] **Step 3: Write `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['@testing-library/jest-dom/vitest'],
  },
});
```

- [ ] **Step 4: Write the failing test for `client.ts`**

```ts
// apps/web/src/api/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, setCsrfToken } from './client';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials and JSON content-type', async () => {
    await apiFetch('/auth/me');
    const [, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.credentials).toBe('include');
  });

  it('attaches the CSRF header on mutating requests once a token is set', async () => {
    setCsrfToken('token-123');
    await apiFetch('/auth/logout', { method: 'POST' });
    const [, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get('X-CSRF-Token')).toBe('token-123');
  });

  it('throws with the server error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid email or password' }),
      })
    );
    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toThrow(
      'Invalid email or password'
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/api/client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 6: Write `apps/web/src/api/client.ts`**

```ts
let csrfToken: string | null = null;

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (csrfToken && options.method && options.method !== 'GET') {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/api/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Write `apps/web/src/api/auth.ts`**

```ts
import { apiFetch, setCsrfToken } from './client';

interface AuthResponse {
  id: string;
  email: string;
  csrfToken: string;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const data = (await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })) as AuthResponse;
  setCsrfToken(data.csrfToken);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = (await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })) as AuthResponse;
  setCsrfToken(data.csrfToken);
  return data;
}

export async function fetchCurrentUser(): Promise<{ id: string; email: string }> {
  return apiFetch('/auth/me', { method: 'GET' });
}
```

- [ ] **Step 9: Write `apps/web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

(`./App` is created in Task 14 — this file will not compile until then, which is expected mid-plan.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/index.html apps/web/vite.config.ts apps/web/vitest.config.ts apps/web/src/main.tsx apps/web/src/api
git commit -m "feat: scaffold web app with API client and CSRF-aware fetch wrapper"
```

---

### Task 13: LoginPage and RegisterPage (variant A — centered card)

**Files:**
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/RegisterPage.tsx`
- Create: `apps/web/src/styles/auth.css`
- Test: `apps/web/src/pages/LoginPage.test.tsx`
- Test: `apps/web/src/pages/RegisterPage.test.tsx`

**Interfaces:**
- Consumes: `login`, `register` (Task 12).
- Produces: `LoginPage({ onSuccess: () => void })`, `RegisterPage({ onSuccess: () => void })` React components.

- [ ] **Step 1: Write the failing test for `LoginPage`**

```tsx
// apps/web/src/pages/LoginPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import * as authApi from '../api/auth';

describe('LoginPage', () => {
  it('calls onSuccess after a successful login', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: '1', email: 'a@b.com', csrfToken: 'x' });
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /войти/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows an error message on failed login', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /войти/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/LoginPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `apps/web/src/styles/auth.css`**

```css
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f5f7;
}

.auth-card {
  width: 320px;
  padding: 32px;
  border-radius: 10px;
  background: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auth-card label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

.auth-card input {
  padding: 8px;
  border: 1px solid #d0d0d5;
  border-radius: 6px;
}

.auth-card button {
  margin-top: 8px;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: #2f3f66;
  color: white;
  cursor: pointer;
}

.auth-card [role='alert'] {
  color: #b3261e;
  font-size: 14px;
}
```

- [ ] **Step 4: Write `apps/web/src/pages/LoginPage.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { login } from '../api/auth';
import '../styles/auth.css';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>MyFinance</h1>
        <label htmlFor="login-email">
          Email
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label htmlFor="login-password">
          Пароль
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Войти</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for `RegisterPage`**

```tsx
// apps/web/src/pages/RegisterPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterPage } from './RegisterPage';
import * as authApi from '../api/auth';

describe('RegisterPage', () => {
  it('calls onSuccess after a successful registration', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ id: '1', email: 'a@b.com', csrfToken: 'x' });
    const onSuccess = vi.fn();
    render(<RegisterPage onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows an error message when the email is already registered', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new Error('Email already registered'));
    render(<RegisterPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/RegisterPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 8: Write `apps/web/src/pages/RegisterPage.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { register } from '../api/auth';
import '../styles/auth.css';

export function RegisterPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>MyFinance</h1>
        <label htmlFor="register-email">
          Email
          <input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label htmlFor="register-password">
          Пароль
          <input
            id="register-password"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Зарегистрироваться</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/RegisterPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages apps/web/src/styles
git commit -m "feat: add LoginPage and RegisterPage (centered-card layout)"
```

---

### Task 14: App routing, protected dashboard placeholder, manual smoke test

**Files:**
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Create: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `LoginPage`, `RegisterPage` (Task 13); `fetchCurrentUser` (Task 12).
- Produces: `App()` — the root component wired into `main.tsx` (Task 12).

- [ ] **Step 1: Write `apps/web/src/pages/DashboardPage.tsx`**

```tsx
export function DashboardPage({ user }: { user: { id: string; email: string } }) {
  return (
    <div style={{ padding: 32 }}>
      <h1>Добро пожаловать, {user.email}</h1>
      <p>Дашборд появится в следующем под-проекте.</p>
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { fetchCurrentUser } from './api/auth';

interface CurrentUser {
  id: string;
  email: string;
}

export function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" />
            ) : (
              <LoginPage onSuccess={() => window.location.assign('/dashboard')} />
            )
          }
        />
        <Route
          path="/register"
          element={
            user ? (
              <Navigate to="/dashboard" />
            ) : (
              <RegisterPage onSuccess={() => window.location.assign('/dashboard')} />
            )
          }
        />
        <Route
          path="/dashboard"
          element={user ? <DashboardPage user={user} /> : <Navigate to="/login" />}
        />
        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd apps/web && npx vitest run`
Expected: all test files PASS

- [ ] **Step 4: Manual end-to-end smoke test**

Run in one terminal: `cd apps/api && npm run dev`
Run in another terminal: `cd apps/web && npm run dev`

In the browser:
1. Open the Vite dev server URL, confirm redirect to `/login`.
2. Click through to `/register`, register a new account.
3. Confirm redirect to `/dashboard` showing the registered email.
4. Refresh the page — confirm the session persists (still on `/dashboard`, no redirect to `/login`).
5. Manually navigate to `/login` while authenticated — confirm redirect back to `/dashboard`.
6. Add a temporary "Logout" button invocation via the browser devtools console (`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': '<token from network tab>' } })`) or wait for the Settings sub-project — confirm `GET /api/auth/me` returns `401` after logout.

Expected: all six steps behave as described, with no console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/DashboardPage.tsx
git commit -m "feat: wire routing between login, register, and dashboard placeholder"
```

---

## Out of scope for this plan

HTTP routes for accounts, categories, transactions, reconciliation, and rates are intentionally not exposed yet — those are built as part of the Cashflow and Assets sub-project plans, which consume the services built here. Google OAuth, iOS/Android clients, i18n, and dark/light theme are future direction only, per the design spec.
