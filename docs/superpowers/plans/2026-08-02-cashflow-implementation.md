# Cashflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Foundation's ledger/account/category/reconciliation services over HTTP, add recurring-transaction generation, default categories, soft-delete semantics, and a Cashflow UI page — turning the app into a usable income/expense tracker with end-of-period reconciliation.

**Architecture:** Recurring transactions are stored as template `Transaction` rows (`frequency = RECURRING`, no `Entry` rows of their own — amount/account/category live in dedicated `template*` columns) that lazily spawn dated `ONE_OFF` occurrence transactions (real `Entry` rows, linked back via `templateId`) the moment before a reconciliation runs. New Express routers (`accounts`, `categories`, `transactions`) sit alongside the existing auth routes in `app.ts`. The Cashflow page (layout **F**: Income/Expense two columns left, accounts sidebar right) is the first real UI screen besides auth.

**Tech Stack:** Same as Foundation — Node.js, TypeScript, Express, Prisma, PostgreSQL, zod, Vitest, supertest, React, Vite, react-router-dom, @testing-library/react.

## Global Constraints

- Every query filters by `req.userId` / `userId` — cross-user access to another user's account/category/transaction returns `404`, never `403` (don't confirm existence of another user's data).
- Soft-delete rule (accounts, categories): zero entries -> hard delete; entries exist -> `isActive = false`.
- System categories (`isSystem = true`) reject `PATCH`/`DELETE` with `403`.
- Duplicate category name for the same user -> `409` (`@@unique([userId, name])` already enforces this at the DB level).
- `Entry.currency` targeting an account must equal that account's `currency` — validated in `ledger.service`, not the routes.
- Recurring generation is lazy: it runs as the first step of the reconcile endpoint, never on a background schedule.
- Test runner: Vitest for both `apps/api` and `apps/web`, same conventions as Foundation (`tests/helpers/db.ts`, `testPrisma`, `truncateAll`).
- All new Express route handlers must be wrapped the same way `app.ts` already wraps auth routes (`asyncHandler`, defined in `apps/api/src/app.ts`) so rejected promises reach the catch-all error middleware instead of crashing the process.
- UI copy stays in Russian, matching the existing login/register/dashboard pages — this plan document is in English per the user's standing instruction, but no user-facing string in the code should be.

---

### Task 1: Schema migration — soft-delete flags, recurring template fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify (via `prisma migrate dev`): `apps/api/prisma/migrations/*/migration.sql`

**Interfaces:**
- Produces: `Account.isActive`, `Category.isActive`, `Transaction.isActive`, `Transaction.nextRunDate`, `Transaction.templateId` (self-relation), `Transaction.templateAccountId`, `Transaction.templateCategoryId`, `Transaction.templateAmount`, `Transaction.templateCurrency`, plus `Account.recurringTemplates` / `Category.recurringTemplates` back-relations.

- [ ] **Step 1: Edit `apps/api/prisma/schema.prisma`**

Replace the `Account`, `Category`, and `Transaction` models with:

```prisma
model Account {
  id                 String        @id @default(uuid())
  userId             String
  name               String
  kind               AccountKind
  currency           String
  isSystem           Boolean       @default(false)
  isActive           Boolean       @default(true)
  createdAt          DateTime      @default(now())
  user               User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries            Entry[]
  recurringTemplates Transaction[] @relation("TemplateAccount")

  @@index([userId])
}

model Category {
  id                 String        @id @default(uuid())
  userId             String
  name               String
  kind               CategoryKind
  isSystem           Boolean       @default(false)
  isActive           Boolean       @default(true)
  createdAt          DateTime      @default(now())
  user               User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries            Entry[]
  recurringTemplates Transaction[] @relation("TemplateCategory")

  @@index([userId])
  @@unique([userId, name])
}

model Transaction {
  id                 String                @id @default(uuid())
  userId              String
  description         String
  date                DateTime
  frequency           TransactionFrequency @default(ONE_OFF)
  interval            RecurrenceInterval?
  customDays          Int?
  isActive            Boolean              @default(true)
  nextRunDate         DateTime?
  templateId          String?
  templateAccountId   String?
  templateCategoryId  String?
  templateAmount      Decimal?             @db.Decimal(18, 2)
  templateCurrency    String?
  createdAt           DateTime             @default(now())
  user                User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries             Entry[]
  template            Transaction?         @relation("TransactionOccurrences", fields: [templateId], references: [id], onDelete: SetNull)
  occurrences         Transaction[]        @relation("TransactionOccurrences")
  templateAccount     Account?             @relation("TemplateAccount", fields: [templateAccountId], references: [id])
  templateCategory    Category?            @relation("TemplateCategory", fields: [templateCategoryId], references: [id])

  @@index([userId])
  @@index([templateId])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run:

```bash
cd apps/api
npx prisma migrate dev --name cashflow_schema
```

Expected: creates `apps/api/prisma/migrations/<timestamp>_cashflow_schema/migration.sql` and applies it to `myfinance`.

- [ ] **Step 3: Apply the same migration to the test database**

Run:

```bash
DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy
```

Expected: `myfinance_test` now has the same schema.

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run` (from `apps/api`)
Expected: all 9 existing test files still PASS (new columns are all nullable or defaulted, no existing test data is affected).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat: add soft-delete flags and recurring template fields to schema"
```

---

### Task 2: Recurring interval date math

**Files:**
- Create: `apps/api/src/modules/recurring/recurring.service.ts`
- Test: `apps/api/tests/recurring.service.test.ts`

**Interfaces:**
- Consumes: `RecurrenceInterval` from `@prisma/client` (Task 1 schema, values unchanged: `WEEK` | `MONTH` | `QUARTER` | `YEAR` | `CUSTOM`).
- Produces: `advance(date: Date, interval: RecurrenceInterval, customDays?: number): Date`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/recurring.service.test.ts
import { describe, it, expect } from 'vitest';
import { advance } from '../src/modules/recurring/recurring.service';

describe('advance', () => {
  it('adds 7 days for WEEK', () => {
    const result = advance(new Date('2026-07-01T00:00:00Z'), 'WEEK');
    expect(result.toISOString()).toBe('2026-07-08T00:00:00.000Z');
  });

  it('adds a calendar month for MONTH', () => {
    const result = advance(new Date('2026-07-15T00:00:00Z'), 'MONTH');
    expect(result.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('clamps to month end for MONTH when the day does not exist in the next month', () => {
    const result = advance(new Date('2026-01-31T00:00:00Z'), 'MONTH');
    expect(result.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('adds 3 calendar months for QUARTER', () => {
    const result = advance(new Date('2026-01-31T00:00:00Z'), 'QUARTER');
    expect(result.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('adds a calendar year for YEAR', () => {
    const result = advance(new Date('2026-02-28T00:00:00Z'), 'YEAR');
    expect(result.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('adds customDays for CUSTOM', () => {
    const result = advance(new Date('2026-07-01T00:00:00Z'), 'CUSTOM', 10);
    expect(result.toISOString()).toBe('2026-07-11T00:00:00.000Z');
  });

  it('throws for CUSTOM without customDays', () => {
    expect(() => advance(new Date('2026-07-01T00:00:00Z'), 'CUSTOM')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/recurring.service.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/recurring/recurring.service'`

- [ ] **Step 3: Write `apps/api/src/modules/recurring/recurring.service.ts`**

```ts
import { RecurrenceInterval } from '@prisma/client';

function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
}

export function advance(date: Date, interval: RecurrenceInterval, customDays?: number): Date {
  switch (interval) {
    case 'WEEK': {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case 'MONTH':
      return addMonths(date, 1);
    case 'QUARTER':
      return addMonths(date, 3);
    case 'YEAR': {
      const day = date.getUTCDate();
      const next = new Date(date);
      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      const daysInMonth = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
      ).getUTCDate();
      next.setUTCDate(Math.min(day, daysInMonth));
      return next;
    }
    case 'CUSTOM': {
      if (!customDays) {
        throw new Error('customDays is required for CUSTOM interval');
      }
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + customDays);
      return next;
    }
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/recurring.service.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/recurring apps/api/tests/recurring.service.test.ts
git commit -m "feat: add recurring interval date math"
```

---

### Task 3: Ledger service — reusable validation helpers, templateId, currency check

**Files:**
- Modify: `apps/api/src/modules/ledger/ledger.service.ts`
- Test: `apps/api/tests/ledger.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma.Decimal` (Task 1 schema, unchanged models otherwise).
- Produces (new, in addition to existing `createTransaction`/`getAccountBalance`/`UnbalancedTransactionError`/`InvalidEntryError`):
  - `assertEntriesTargetExactlyOne(entries: EntryInput[]): void`
  - `assertEntriesBalance(entries: EntryInput[]): void`
  - `assertEntryCurrenciesMatchAccounts(prisma: PrismaClient, entries: EntryInput[]): Promise<void>`
  - `CreateTransactionInput.templateId?: string` (new optional field)

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/ledger.service.test.ts` (after the existing three `it` blocks, inside the same `describe`):

```ts
  it('rejects an entry whose currency does not match its account currency', async () => {
    const { user, category } = await seedUserWithAccountAndCategory();
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Euro card', kind: 'FINANCIAL', currency: 'EUR' },
    });

    await expect(
      createTransaction(testPrisma, {
        userId: user.id,
        description: 'Bad currency',
        date: new Date(),
        entries: [
          { accountId: account.id, amount: '10.00', currency: 'USD' },
          { categoryId: category.id, amount: '-10.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(InvalidEntryError);
  });

  it('stores templateId on the created transaction when provided', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    const template = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Template placeholder',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1.00', currency: 'USD' },
        { categoryId: category.id, amount: '-1.00', currency: 'USD' },
      ],
    });

    const occurrence = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Rent',
      date: new Date(),
      templateId: template.id,
      entries: [
        { accountId: account.id, amount: '-1000.00', currency: 'USD' },
        { categoryId: category.id, amount: '1000.00', currency: 'USD' },
      ],
    });

    expect(occurrence.templateId).toBe(template.id);
  });
```

Also add `InvalidEntryError` to the existing import line at the top of the file (it's already imported — verify, don't duplicate).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/ledger.service.test.ts`
Expected: FAIL — currency mismatch is not yet validated; `templateId` is not yet a recognized field (TypeScript error on the test file).

- [ ] **Step 3: Rewrite `apps/api/src/modules/ledger/ledger.service.ts`**

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
  templateId?: string;
}

export class UnbalancedTransactionError extends Error {}
export class InvalidEntryError extends Error {}

export function assertEntriesTargetExactlyOne(entries: EntryInput[]): void {
  for (const entry of entries) {
    const hasAccount = Boolean(entry.accountId);
    const hasCategory = Boolean(entry.categoryId);
    if (hasAccount === hasCategory) {
      throw new InvalidEntryError('Entry must reference exactly one of accountId or categoryId');
    }
  }
}

export function assertEntriesBalance(entries: EntryInput[]): void {
  const sum = entries.reduce(
    (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
    new Prisma.Decimal(0)
  );
  if (!sum.equals(0)) {
    throw new UnbalancedTransactionError(`Entries must sum to zero, got ${sum.toString()}`);
  }
}

export async function assertEntryCurrenciesMatchAccounts(
  prisma: PrismaClient,
  entries: EntryInput[]
): Promise<void> {
  const accountIds = entries.map((e) => e.accountId).filter((id): id is string => Boolean(id));
  if (accountIds.length === 0) return;

  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } } });
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  for (const entry of entries) {
    if (!entry.accountId) continue;
    const account = accountsById.get(entry.accountId);
    if (!account) {
      throw new InvalidEntryError(`Account ${entry.accountId} not found`);
    }
    if (account.currency !== entry.currency) {
      throw new InvalidEntryError(
        `Entry currency ${entry.currency} does not match account currency ${account.currency}`
      );
    }
  }
}

export async function createTransaction(prisma: PrismaClient, input: CreateTransactionInput) {
  assertEntriesTargetExactlyOne(input.entries);
  await assertEntryCurrenciesMatchAccounts(prisma, input.entries);
  assertEntriesBalance(input.entries);

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.date,
      frequency: input.frequency ?? 'ONE_OFF',
      interval: input.interval,
      customDays: input.customDays,
      templateId: input.templateId,
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
Expected: PASS (5 tests — the original 3 plus the 2 new ones)

- [ ] **Step 5: Run the full backend suite to confirm no regressions in dependents**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS (accounts/reconciliation services call `getAccountBalance`/`createTransaction`, both unchanged in external behavior for same-currency callers)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ledger apps/api/tests/ledger.service.test.ts
git commit -m "feat: validate entry currency against account currency, support templateId"
```

---

### Task 4: Recurring occurrence generation

**Files:**
- Modify: `apps/api/src/modules/recurring/recurring.service.ts`
- Modify: `apps/api/tests/recurring.service.test.ts`

**Interfaces:**
- Consumes: `createTransaction` (Task 3), `advance` (Task 2), `PrismaClient`, `Transaction` from `@prisma/client`.
- Produces: `generateDueOccurrences(prisma: PrismaClient, userId: string): Promise<Transaction[]>`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/recurring.service.test.ts`, after the closing `});` of the `describe('advance', ...)` block:

```ts
import { PrismaClient } from '@prisma/client';
import { testPrisma, truncateAll } from './helpers/db';
import { generateDueOccurrences } from '../src/modules/recurring/recurring.service';
import { getAccountBalance } from '../src/modules/ledger/ledger.service';

describe('generateDueOccurrences', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  async function seedTemplate(
    nextRunDate: Date,
    overrides: Partial<{ isActive: boolean }> = {}
  ) {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Rent', kind: 'EXPENSE' },
    });
    const template = await testPrisma.transaction.create({
      data: {
        userId: user.id,
        description: 'Rent',
        date: nextRunDate,
        frequency: 'RECURRING',
        interval: 'MONTH',
        nextRunDate,
        isActive: overrides.isActive ?? true,
        templateAccountId: account.id,
        templateCategoryId: category.id,
        templateAmount: '-1000.00',
        templateCurrency: 'USD',
      },
    });
    return { user, account, category, template };
  }

  it('generates one occurrence when exactly one period is due', async () => {
    const { user, account, template } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));
    // A single explicit MONTH occurrence, isolated from the "many periods due" case below
    // by advancing nextRunDate to just before "now" first.
    const almostNow = new Date();
    almostNow.setUTCDate(almostNow.getUTCDate() - 1);
    await testPrisma.transaction.update({
      where: { id: template.id },
      data: { nextRunDate: almostNow },
    });

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(1);
    expect(generated[0].templateId).toBe(template.id);
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('-1000');
  });

  it('catches up every missed period in one call', async () => {
    const { user, account } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated.length).toBeGreaterThan(1);
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toNumber()).toBe(-1000 * generated.length);
  });

  it('does not double-post when called twice in a row', async () => {
    const { user } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));

    await generateDueOccurrences(testPrisma, user.id);
    const second = await generateDueOccurrences(testPrisma, user.id);

    expect(second).toHaveLength(0);
  });

  it('skips inactive templates', async () => {
    const { user } = await seedTemplate(new Date('2020-01-01T00:00:00Z'), { isActive: false });

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(0);
  });

  it('does nothing for a template not yet due', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    const { user } = await seedTemplate(future);

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(0);
  });
});
```

Remove the now-redundant top-level `import { describe, it, expect } from 'vitest';` duplication concern by merging: the file should end up with a single import block at the top —

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { advance, generateDueOccurrences } from '../src/modules/recurring/recurring.service';
import { getAccountBalance } from '../src/modules/ledger/ledger.service';
```

as the only import block at the top of `apps/api/tests/recurring.service.test.ts`, with both `describe('advance', ...)` and `describe('generateDueOccurrences', ...)` as sibling top-level blocks in the same file.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd apps/api && npx vitest run tests/recurring.service.test.ts`
Expected: `advance` tests still PASS; `generateDueOccurrences` tests FAIL — `generateDueOccurrences is not exported`

- [ ] **Step 3: Add `generateDueOccurrences` to `apps/api/src/modules/recurring/recurring.service.ts`**

Add these imports at the top (alongside the existing `RecurrenceInterval` import) and the function at the bottom of the file:

```ts
import { PrismaClient, Transaction } from '@prisma/client';
import { createTransaction } from '../ledger/ledger.service';
```

```ts
export async function generateDueOccurrences(
  prisma: PrismaClient,
  userId: string
): Promise<Transaction[]> {
  const now = new Date();
  const templates = await prisma.transaction.findMany({
    where: {
      userId,
      frequency: 'RECURRING',
      isActive: true,
      nextRunDate: { lte: now },
    },
  });

  const generated: Transaction[] = [];

  for (const template of templates) {
    let nextRunDate = template.nextRunDate!;
    const accountAmount = template.templateAmount!;
    const categoryAmount = accountAmount.negated();

    while (nextRunDate <= now) {
      const occurrence = await createTransaction(prisma, {
        userId,
        description: template.description,
        date: nextRunDate,
        frequency: 'ONE_OFF',
        templateId: template.id,
        entries: [
          {
            accountId: template.templateAccountId!,
            amount: accountAmount.toString(),
            currency: template.templateCurrency!,
          },
          {
            categoryId: template.templateCategoryId!,
            amount: categoryAmount.toString(),
            currency: template.templateCurrency!,
          },
        ],
      });
      generated.push(occurrence);

      nextRunDate = advance(nextRunDate, template.interval!, template.customDays ?? undefined);
      await prisma.transaction.update({
        where: { id: template.id },
        data: { nextRunDate },
      });
    }
  }

  return generated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/recurring.service.test.ts`
Expected: PASS (12 tests — 7 `advance` + 5 `generateDueOccurrences`)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/recurring apps/api/tests/recurring.service.test.ts
git commit -m "feat: generate due recurring transaction occurrences"
```

---

### Task 5: Default categories on registration

**Files:**
- Modify: `apps/api/src/modules/categories/categories.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/tests/categories.service.test.ts`
- Modify: `apps/api/tests/auth.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 1 schema).
- Produces: `seedDefaultCategories(prisma: PrismaClient, userId: string): Promise<void>`
- Modifies existing behavior: `registerUser` now also seeds 10 default categories, so a freshly registered user has 12 categories total (2 system + 10 default), not 2.

- [ ] **Step 1: Write the failing test**

Append to the `describe('categories.service', ...)` block in `apps/api/tests/categories.service.test.ts`:

```ts
  it('creates 10 default categories for a new user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    await seedDefaultCategories(testPrisma, user.id);

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(10);
    expect(categories.every((c) => c.isSystem === false)).toBe(true);
    const income = categories.filter((c) => c.kind === 'INCOME');
    const expense = categories.filter((c) => c.kind === 'EXPENSE');
    expect(income).toHaveLength(2);
    expect(expense).toHaveLength(8);
  });
```

Update the import line at the top of the file to add `seedDefaultCategories`:

```ts
import {
  seedSystemCategories,
  seedDefaultCategories,
  SYSTEM_CATEGORY_OTHER,
  SYSTEM_CATEGORY_UNREALIZED_REVALUATION,
} from '../src/modules/categories/categories.service';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: FAIL — `seedDefaultCategories is not exported`

- [ ] **Step 3: Add `seedDefaultCategories` to `apps/api/src/modules/categories/categories.service.ts`**

Append to the file:

```ts
export async function seedDefaultCategories(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.category.createMany({
    data: [
      { userId, name: 'Зарплата', kind: 'INCOME' },
      { userId, name: 'Прочий доход', kind: 'INCOME' },
      { userId, name: 'Продукты', kind: 'EXPENSE' },
      { userId, name: 'Аренда/Жильё', kind: 'EXPENSE' },
      { userId, name: 'Авто', kind: 'EXPENSE' },
      { userId, name: 'Коммунальные', kind: 'EXPENSE' },
      { userId, name: 'Кредиты', kind: 'EXPENSE' },
      { userId, name: 'Развлечения', kind: 'EXPENSE' },
      { userId, name: 'Здоровье', kind: 'EXPENSE' },
      { userId, name: 'Прочие расходы', kind: 'EXPENSE' },
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into registration — modify `apps/api/src/modules/auth/auth.service.ts`**

Change the import line:

```ts
import { seedSystemCategories, seedDefaultCategories } from '../categories/categories.service';
```

Change `registerUser`'s body (add one line after `seedSystemCategories`):

```ts
export async function registerUser(prisma: PrismaClient, email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailAlreadyRegisteredError();

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({ data: { email, passwordHash } });
  await seedSystemCategories(prisma, user.id);
  await seedDefaultCategories(prisma, user.id);
  const session = await createSession(prisma, user.id);

  return { user, session };
}
```

- [ ] **Step 6: Update the existing auth test's expectation**

In `apps/api/tests/auth.service.test.ts`, find the test `'registers a user, hashes the password, and seeds system categories'` and change:

```ts
    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(2);
```

to:

```ts
    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(12);
```

- [ ] **Step 7: Run the auth and categories suites to confirm they pass**

Run: `cd apps/api && npx vitest run tests/auth.service.test.ts tests/categories.service.test.ts`
Expected: PASS (7 tests total — 5 auth + 2 categories)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/categories apps/api/src/modules/auth apps/api/tests/categories.service.test.ts apps/api/tests/auth.service.test.ts
git commit -m "feat: seed default income/expense categories on registration"
```

---

### Task 6: Category CRUD with soft-delete and system-category guard

**Files:**
- Modify: `apps/api/src/modules/categories/categories.service.ts`
- Modify: `apps/api/tests/categories.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma` (Task 1 schema).
- Produces:
  - `class CategoryNotFoundError extends Error`
  - `class SystemCategoryError extends Error`
  - `class DuplicateCategoryNameError extends Error`
  - `listCategories(prisma: PrismaClient, userId: string, options?: { includeInactive?: boolean }): Promise<Category[]>`
  - `createCategory(prisma: PrismaClient, params: { userId: string; name: string; kind: 'INCOME' | 'EXPENSE' }): Promise<Category>`
  - `updateCategory(prisma: PrismaClient, params: { userId: string; categoryId: string; name: string }): Promise<Category>`
  - `deleteCategory(prisma: PrismaClient, params: { userId: string; categoryId: string }): Promise<{ hardDeleted: boolean }>`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/categories.service.test.ts`:

```ts
  it('lists only active categories by default, all when includeInactive is true', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await testPrisma.category.create({ data: { userId: user.id, name: 'Active', kind: 'EXPENSE' } });
    await testPrisma.category.create({
      data: { userId: user.id, name: 'Inactive', kind: 'EXPENSE', isActive: false },
    });

    const activeOnly = await listCategories(testPrisma, user.id);
    expect(activeOnly.map((c) => c.name)).toEqual(['Active']);

    const all = await listCategories(testPrisma, user.id, { includeInactive: true });
    expect(all.map((c) => c.name).sort()).toEqual(['Active', 'Inactive']);
  });

  it('creates a category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    const category = await createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' });

    expect(category.name).toBe('Hobbies');
    expect(category.isSystem).toBe(false);
  });

  it('rejects creating a duplicate category name for the same user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' });

    await expect(
      createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' })
    ).rejects.toThrow(DuplicateCategoryNameError);
  });

  it('updates a category name', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Old', kind: 'EXPENSE' });

    const updated = await updateCategory(testPrisma, {
      userId: user.id,
      categoryId: category.id,
      name: 'New',
    });

    expect(updated.name).toBe('New');
  });

  it('rejects updating a category that belongs to another user', async () => {
    const owner = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const stranger = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: owner.id, name: 'Mine', kind: 'EXPENSE' });

    await expect(
      updateCategory(testPrisma, { userId: stranger.id, categoryId: category.id, name: 'Stolen' })
    ).rejects.toThrow(CategoryNotFoundError);
  });

  it('rejects updating a system category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const other = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });

    await expect(
      updateCategory(testPrisma, { userId: user.id, categoryId: other.id, name: 'Renamed' })
    ).rejects.toThrow(SystemCategoryError);
  });

  it('hard-deletes a category with no entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Unused', kind: 'EXPENSE' });

    const result = await deleteCategory(testPrisma, { userId: user.id, categoryId: category.id });

    expect(result.hardDeleted).toBe(true);
    const found = await testPrisma.category.findUnique({ where: { id: category.id } });
    expect(found).toBeNull();
  });

  it('soft-deletes a category that has entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Used', kind: 'EXPENSE' });
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Spend',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '-10.00', currency: 'USD' },
        { categoryId: category.id, amount: '10.00', currency: 'USD' },
      ],
    });

    const result = await deleteCategory(testPrisma, { userId: user.id, categoryId: category.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(found.isActive).toBe(false);
  });

  it('rejects deleting a system category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const other = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });

    await expect(
      deleteCategory(testPrisma, { userId: user.id, categoryId: other.id })
    ).rejects.toThrow(SystemCategoryError);
  });
```

Update the top-of-file import block to:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createTransaction } from '../src/modules/ledger/ledger.service';
import {
  seedSystemCategories,
  seedDefaultCategories,
  SYSTEM_CATEGORY_OTHER,
  SYSTEM_CATEGORY_UNREALIZED_REVALUATION,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryNotFoundError,
  SystemCategoryError,
  DuplicateCategoryNameError,
} from '../src/modules/categories/categories.service';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: FAIL — `listCategories`/`createCategory`/etc. are not exported

- [ ] **Step 3: Add CRUD functions to `apps/api/src/modules/categories/categories.service.ts`**

Change the import line at the top of the file to:

```ts
import { PrismaClient, Prisma } from '@prisma/client';
```

Append to the file:

```ts
export class CategoryNotFoundError extends Error {}
export class SystemCategoryError extends Error {}
export class DuplicateCategoryNameError extends Error {}

export async function listCategories(
  prisma: PrismaClient,
  userId: string,
  options: { includeInactive?: boolean } = {}
) {
  return prisma.category.findMany({
    where: { userId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(
  prisma: PrismaClient,
  params: { userId: string; name: string; kind: 'INCOME' | 'EXPENSE' }
) {
  try {
    return await prisma.category.create({
      data: { userId: params.userId, name: params.name, kind: params.kind },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateCategoryNameError(`Category "${params.name}" already exists`);
    }
    throw err;
  }
}

export async function updateCategory(
  prisma: PrismaClient,
  params: { userId: string; categoryId: string; name: string }
) {
  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, userId: params.userId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.isSystem) throw new SystemCategoryError('System categories cannot be edited');

  try {
    return await prisma.category.update({
      where: { id: params.categoryId },
      data: { name: params.name },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateCategoryNameError(`Category "${params.name}" already exists`);
    }
    throw err;
  }
}

export async function deleteCategory(
  prisma: PrismaClient,
  params: { userId: string; categoryId: string }
): Promise<{ hardDeleted: boolean }> {
  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, userId: params.userId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.isSystem) throw new SystemCategoryError('System categories cannot be deleted');

  const entryCount = await prisma.entry.count({ where: { categoryId: params.categoryId } });
  if (entryCount === 0) {
    await prisma.category.delete({ where: { id: params.categoryId } });
    return { hardDeleted: true };
  }

  await prisma.category.update({ where: { id: params.categoryId }, data: { isActive: false } });
  return { hardDeleted: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/categories.service.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/categories apps/api/tests/categories.service.test.ts
git commit -m "feat: add category CRUD with soft-delete and system-category guard"
```

---

### Task 7: Account update/delete with soft-delete

**Files:**
- Modify: `apps/api/src/modules/accounts/accounts.service.ts`
- Modify: `apps/api/tests/accounts.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 1 schema), `getAccountBalance` (Task 3).
- Produces:
  - `class AccountNotFoundError extends Error`
  - `updateAccount(prisma: PrismaClient, params: { userId: string; accountId: string; name?: string; currency?: string }): Promise<Account>`
  - `deleteAccount(prisma: PrismaClient, params: { userId: string; accountId: string }): Promise<{ hardDeleted: boolean }>`
  - Modifies existing behavior: `listAccountsWithBalances` now only returns accounts where `isActive = true`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/accounts.service.test.ts`:

```ts
  it('updates an account name', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Old name',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const updated = await updateAccount(testPrisma, {
      userId: user.id,
      accountId: account.id,
      name: 'New name',
    });

    expect(updated.name).toBe('New name');
  });

  it('rejects updating an account that belongs to another user', async () => {
    const owner = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const stranger = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: owner.id,
      name: 'Mine',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    await expect(
      updateAccount(testPrisma, { userId: stranger.id, accountId: account.id, name: 'Stolen' })
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('hard-deletes an account with no entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Unused',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await deleteAccount(testPrisma, { userId: user.id, accountId: account.id });

    expect(result.hardDeleted).toBe(true);
    const found = await testPrisma.account.findUnique({ where: { id: account.id } });
    expect(found).toBeNull();
  });

  it('soft-deletes an account that has entries, and it disappears from listAccountsWithBalances', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Used',
      kind: 'FINANCIAL',
      currency: 'USD',
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Pay',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '10.00', currency: 'USD' },
        { categoryId: category.id, amount: '-10.00', currency: 'USD' },
      ],
    });

    const result = await deleteAccount(testPrisma, { userId: user.id, accountId: account.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(found.isActive).toBe(false);

    const active = await listAccountsWithBalances(testPrisma, user.id);
    expect(active).toHaveLength(0);
  });
```

Update the import line at the top of the file to:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  createAccount,
  listAccountsWithBalances,
  updateAccount,
  deleteAccount,
  AccountNotFoundError,
} from '../src/modules/accounts/accounts.service';
import { createTransaction } from '../src/modules/ledger/ledger.service';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/accounts.service.test.ts`
Expected: FAIL — `updateAccount`/`deleteAccount`/`AccountNotFoundError` are not exported

- [ ] **Step 3: Add functions to `apps/api/src/modules/accounts/accounts.service.ts`**

Rewrite the file to:

```ts
import { PrismaClient } from '@prisma/client';
import { getAccountBalance } from '../ledger/ledger.service';

export class AccountNotFoundError extends Error {}

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
  const accounts = await prisma.account.findMany({ where: { userId, isActive: true } });
  const withBalances = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: (await getAccountBalance(prisma, account.id)).toString(),
    }))
  );
  return withBalances;
}

export async function updateAccount(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; name?: string; currency?: string }
) {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
  });
  if (!account) throw new AccountNotFoundError();

  return prisma.account.update({
    where: { id: params.accountId },
    data: { name: params.name, currency: params.currency },
  });
}

export async function deleteAccount(
  prisma: PrismaClient,
  params: { userId: string; accountId: string }
): Promise<{ hardDeleted: boolean }> {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
  });
  if (!account) throw new AccountNotFoundError();

  const entryCount = await prisma.entry.count({ where: { accountId: params.accountId } });
  if (entryCount === 0) {
    await prisma.account.delete({ where: { id: params.accountId } });
    return { hardDeleted: true };
  }

  await prisma.account.update({ where: { id: params.accountId }, data: { isActive: false } });
  return { hardDeleted: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/accounts.service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounts apps/api/tests/accounts.service.test.ts
git commit -m "feat: add account update/delete with soft-delete"
```

---

### Task 8: Transactions service — recurring templates, listing, one-off edits, deletion

**Files:**
- Create: `apps/api/src/modules/transactions/transactions.service.ts`
- Test: `apps/api/tests/transactions.service.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma`, `RecurrenceInterval` from `@prisma/client` (Task 1 schema); `EntryInput`, `assertEntriesTargetExactlyOne`, `assertEntriesBalance`, `assertEntryCurrenciesMatchAccounts` (Task 3).
- Produces:
  - `class TransactionNotFoundError extends Error`
  - `class NotARecurringTemplateError extends Error`
  - `class NotAOneOffTransactionError extends Error`
  - `interface CreateRecurringTemplateInput { userId: string; description: string; accountId: string; categoryId: string; amount: string; currency: string; interval: RecurrenceInterval; customDays?: number; startDate: Date }`
  - `createRecurringTemplate(prisma: PrismaClient, input: CreateRecurringTemplateInput): Promise<Transaction>`
  - `interface ListTransactionsFilters { kind?: 'INCOME' | 'EXPENSE'; frequency?: 'ONE_OFF' | 'RECURRING'; accountId?: string }`
  - `listTransactions(prisma: PrismaClient, userId: string, filters?: ListTransactionsFilters): Promise<Transaction[]>`
  - `updateRecurringTemplate(prisma: PrismaClient, params: { userId: string; transactionId: string; amount?: string; interval?: RecurrenceInterval; customDays?: number; isActive?: boolean }): Promise<Transaction>`
  - `updateOneOffTransaction(prisma: PrismaClient, params: { userId: string; transactionId: string; description?: string; date?: Date; entries: [EntryInput, EntryInput] }): Promise<Transaction>`
  - `deleteTransaction(prisma: PrismaClient, params: { userId: string; transactionId: string }): Promise<{ hardDeleted: boolean }>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/tests/transactions.service.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createTransaction, getAccountBalance, InvalidEntryError, UnbalancedTransactionError } from '../src/modules/ledger/ledger.service';
import {
  createRecurringTemplate,
  listTransactions,
  updateRecurringTemplate,
  updateOneOffTransaction,
  deleteTransaction,
  TransactionNotFoundError,
  NotARecurringTemplateError,
  NotAOneOffTransactionError,
} from '../src/modules/transactions/transactions.service';

describe('transactions.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  async function seedUserWithAccountAndCategory() {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const income = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    const expense = await testPrisma.category.create({
      data: { userId: user.id, name: 'Rent', kind: 'EXPENSE' },
    });
    return { user, account, income, expense };
  }

  it('creates a recurring template with nextRunDate set to startDate', async () => {
    const { user, account, expense } = await seedUserWithAccountAndCategory();
    const startDate = new Date('2026-08-01T00:00:00Z');

    const template = await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate,
    });

    expect(template.frequency).toBe('RECURRING');
    expect(template.nextRunDate?.toISOString()).toBe(startDate.toISOString());
    expect(template.entries).toHaveLength(0);
  });

  it('lists transactions filtered by frequency', async () => {
    const { user, account, income, expense } = await seedUserWithAccountAndCategory();
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });
    await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    const oneOff = await listTransactions(testPrisma, user.id, { frequency: 'ONE_OFF' });
    const recurring = await listTransactions(testPrisma, user.id, { frequency: 'RECURRING' });

    expect(oneOff).toHaveLength(1);
    expect(oneOff[0].description).toBe('Salary');
    expect(recurring).toHaveLength(1);
    expect(recurring[0].description).toBe('Rent');
  });

  it('lists transactions filtered by kind, covering both one-off entries and recurring templates', async () => {
    const { user, account, income, expense } = await seedUserWithAccountAndCategory();
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });
    await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    const expenseTx = await listTransactions(testPrisma, user.id, { kind: 'EXPENSE' });
    const incomeTx = await listTransactions(testPrisma, user.id, { kind: 'INCOME' });

    expect(expenseTx.map((t) => t.description)).toEqual(['Rent']);
    expect(incomeTx.map((t) => t.description)).toEqual(['Salary']);
  });

  it('lists transactions filtered by accountId, covering both entries and template account', async () => {
    const { user, account, expense } = await seedUserWithAccountAndCategory();
    const otherAccount = await testPrisma.account.create({
      data: { userId: user.id, name: 'Cash', kind: 'FINANCIAL', currency: 'USD' },
    });
    await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    const forAccount = await listTransactions(testPrisma, user.id, { accountId: account.id });
    const forOtherAccount = await listTransactions(testPrisma, user.id, { accountId: otherAccount.id });

    expect(forAccount).toHaveLength(1);
    expect(forOtherAccount).toHaveLength(0);
  });

  it('updates a recurring template amount and isActive', async () => {
    const { user, account, expense } = await seedUserWithAccountAndCategory();
    const template = await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    const updated = await updateRecurringTemplate(testPrisma, {
      userId: user.id,
      transactionId: template.id,
      amount: '-1200.00',
      isActive: false,
    });

    expect(updated.templateAmount?.toString()).toBe('-1200');
    expect(updated.isActive).toBe(false);
  });

  it('rejects updateRecurringTemplate on a ONE_OFF transaction id', async () => {
    const { user, account, income } = await seedUserWithAccountAndCategory();
    const oneOff = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    await expect(
      updateRecurringTemplate(testPrisma, { userId: user.id, transactionId: oneOff.id, amount: '1.00' })
    ).rejects.toThrow(NotARecurringTemplateError);
  });

  it('updates a one-off transaction by replacing its entries', async () => {
    const { user, account, income } = await seedUserWithAccountAndCategory();
    const oneOff = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    const updated = await updateOneOffTransaction(testPrisma, {
      userId: user.id,
      transactionId: oneOff.id,
      entries: [
        { accountId: account.id, amount: '1500.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1500.00', currency: 'USD' },
      ],
    });

    expect(updated.entries).toHaveLength(2);
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('1500');
  });

  it('rejects updateOneOffTransaction with unbalanced entries', async () => {
    const { user, account, income } = await seedUserWithAccountAndCategory();
    const oneOff = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    await expect(
      updateOneOffTransaction(testPrisma, {
        userId: user.id,
        transactionId: oneOff.id,
        entries: [
          { accountId: account.id, amount: '100.00', currency: 'USD' },
          { categoryId: income.id, amount: '-50.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(UnbalancedTransactionError);
  });

  it('rejects updateOneOffTransaction on a RECURRING template id', async () => {
    const { user, account, expense } = await seedUserWithAccountAndCategory();
    const template = await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    await expect(
      updateOneOffTransaction(testPrisma, {
        userId: user.id,
        transactionId: template.id,
        entries: [
          { accountId: account.id, amount: '-1.00', currency: 'USD' },
          { categoryId: expense.id, amount: '1.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(NotAOneOffTransactionError);
  });

  it('hard-deletes a one-off transaction, cascading its entries', async () => {
    const { user, account, income } = await seedUserWithAccountAndCategory();
    const oneOff = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    const result = await deleteTransaction(testPrisma, { userId: user.id, transactionId: oneOff.id });

    expect(result.hardDeleted).toBe(true);
    const found = await testPrisma.transaction.findUnique({ where: { id: oneOff.id } });
    expect(found).toBeNull();
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('0');
  });

  it('soft-deletes a recurring template instead of hard-deleting it', async () => {
    const { user, account, expense } = await seedUserWithAccountAndCategory();
    const template = await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: expense.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(),
    });

    const result = await deleteTransaction(testPrisma, { userId: user.id, transactionId: template.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.transaction.findUniqueOrThrow({ where: { id: template.id } });
    expect(found.isActive).toBe(false);
  });

  it('rejects any operation on a transaction owned by another user with TransactionNotFoundError', async () => {
    const { user, account, income } = await seedUserWithAccountAndCategory();
    const stranger = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const oneOff = await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: income.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    await expect(
      deleteTransaction(testPrisma, { userId: stranger.id, transactionId: oneOff.id })
    ).rejects.toThrow(TransactionNotFoundError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/transactions.service.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/transactions/transactions.service'`

- [ ] **Step 3: Write `apps/api/src/modules/transactions/transactions.service.ts`**

```ts
import { PrismaClient, Prisma, RecurrenceInterval, Transaction } from '@prisma/client';
import {
  EntryInput,
  assertEntriesTargetExactlyOne,
  assertEntriesBalance,
  assertEntryCurrenciesMatchAccounts,
} from '../ledger/ledger.service';

export class TransactionNotFoundError extends Error {}
export class NotARecurringTemplateError extends Error {}
export class NotAOneOffTransactionError extends Error {}

export interface CreateRecurringTemplateInput {
  userId: string;
  description: string;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  interval: RecurrenceInterval;
  customDays?: number;
  startDate: Date;
}

export async function createRecurringTemplate(
  prisma: PrismaClient,
  input: CreateRecurringTemplateInput
): Promise<Transaction> {
  await assertEntryCurrenciesMatchAccounts(prisma, [
    { accountId: input.accountId, amount: input.amount, currency: input.currency },
  ]);

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.startDate,
      frequency: 'RECURRING',
      interval: input.interval,
      customDays: input.customDays,
      nextRunDate: input.startDate,
      templateAccountId: input.accountId,
      templateCategoryId: input.categoryId,
      templateAmount: input.amount,
      templateCurrency: input.currency,
    },
    include: { entries: true },
  });
}

export interface ListTransactionsFilters {
  kind?: 'INCOME' | 'EXPENSE';
  frequency?: 'ONE_OFF' | 'RECURRING';
  accountId?: string;
}

export async function listTransactions(
  prisma: PrismaClient,
  userId: string,
  filters: ListTransactionsFilters = {}
): Promise<Transaction[]> {
  const conditions: Prisma.TransactionWhereInput[] = [{ userId }];

  if (filters.frequency) {
    conditions.push({ frequency: filters.frequency });
  }
  if (filters.accountId) {
    conditions.push({
      OR: [
        { entries: { some: { accountId: filters.accountId } } },
        { templateAccountId: filters.accountId },
      ],
    });
  }
  if (filters.kind) {
    conditions.push({
      OR: [
        { entries: { some: { category: { kind: filters.kind } } } },
        { templateCategory: { kind: filters.kind } },
      ],
    });
  }

  return prisma.transaction.findMany({
    where: { AND: conditions },
    include: { entries: true, templateAccount: true, templateCategory: true },
    orderBy: { date: 'desc' },
  });
}

export async function updateRecurringTemplate(
  prisma: PrismaClient,
  params: {
    userId: string;
    transactionId: string;
    amount?: string;
    interval?: RecurrenceInterval;
    customDays?: number;
    isActive?: boolean;
  }
): Promise<Transaction> {
  const template = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!template) throw new TransactionNotFoundError();
  if (template.frequency !== 'RECURRING') throw new NotARecurringTemplateError();

  return prisma.transaction.update({
    where: { id: params.transactionId },
    data: {
      templateAmount: params.amount,
      interval: params.interval,
      customDays: params.customDays,
      isActive: params.isActive,
    },
  });
}

export async function updateOneOffTransaction(
  prisma: PrismaClient,
  params: {
    userId: string;
    transactionId: string;
    description?: string;
    date?: Date;
    entries: [EntryInput, EntryInput];
  }
): Promise<Transaction> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!transaction) throw new TransactionNotFoundError();
  if (transaction.frequency !== 'ONE_OFF') throw new NotAOneOffTransactionError();

  assertEntriesTargetExactlyOne(params.entries);
  await assertEntryCurrenciesMatchAccounts(prisma, params.entries);
  assertEntriesBalance(params.entries);

  await prisma.entry.deleteMany({ where: { transactionId: transaction.id } });
  return prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      description: params.description ?? transaction.description,
      date: params.date ?? transaction.date,
      entries: {
        create: params.entries.map((e) => ({
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

export async function deleteTransaction(
  prisma: PrismaClient,
  params: { userId: string; transactionId: string }
): Promise<{ hardDeleted: boolean }> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!transaction) throw new TransactionNotFoundError();

  if (transaction.frequency === 'RECURRING') {
    await prisma.transaction.update({ where: { id: transaction.id }, data: { isActive: false } });
    return { hardDeleted: false };
  }

  await prisma.transaction.delete({ where: { id: transaction.id } });
  return { hardDeleted: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/transactions.service.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/transactions apps/api/tests/transactions.service.test.ts
git commit -m "feat: add transactions service for recurring templates, listing, edits, deletion"
```

---

### Task 9: Accounts HTTP routes

**Files:**
- Create: `apps/api/src/lib/asyncHandler.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/accounts.routes.ts`
- Test: `apps/api/tests/accounts.routes.test.ts`

**Interfaces:**
- Consumes: `createAccount`, `listAccountsWithBalances`, `updateAccount`, `deleteAccount`, `AccountNotFoundError` (Task 7); `requireAuth` (existing); `requireCsrf` (existing).
- Produces:
  - `asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler`
  - `createAccountsRouter(prisma: PrismaClient): Router` — mounted at `/api/accounts` in `app.ts`, with routes `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 1: Extract `asyncHandler` into its own module**

Create `apps/api/src/lib/asyncHandler.ts`:

```ts
import { Request, Response, NextFunction } from 'express';

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
```

In `apps/api/src/app.ts`, delete the local `asyncHandler` function definition (lines 21-27 in the current file) and add this import near the top, alongside the other local imports:

```ts
import { asyncHandler } from './lib/asyncHandler';
```

Run: `cd apps/api && npx vitest run tests/auth.routes.test.ts`
Expected: PASS (6 tests — confirms the refactor didn't change auth route behavior)

- [ ] **Step 2: Write the failing integration tests**

```ts
// apps/api/tests/accounts.routes.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

async function registerAgent(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'password123' });
  return { agent, csrfToken: res.body.csrfToken as string };
}

describe('accounts routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates, lists, updates, and deletes an account', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const empty = await agent.get('/api/accounts');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const created = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Card');

    const listed = await agent.get('/api/accounts');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].balance).toBe('0');

    const updated = await agent
      .patch(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');

    const deleted = await agent
      .delete(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body.hardDeleted).toBe(true);

    const afterDelete = await agent.get('/api/accounts');
    expect(afterDelete.body).toEqual([]);
  });

  it('rejects account creation with an invalid payload', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const res = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: '', kind: 'FINANCIAL', currency: 'USD' });

    expect(res.status).toBe(400);
  });

  it("returns 404 when patching another user's account", async () => {
    const owner = await registerAgent('owner@b.com');
    const stranger = await registerAgent('stranger@b.com');

    const created = await owner.agent
      .post('/api/accounts')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await stranger.agent
      .patch(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', stranger.csrfToken)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/accounts.routes.test.ts`
Expected: FAIL — `/api/accounts` isn't mounted yet, so every request 404s ("Cannot GET /api/accounts")

- [ ] **Step 4: Write `apps/api/src/routes/accounts.routes.ts`**

```ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createAccount,
  listAccountsWithBalances,
  updateAccount,
  deleteAccount,
  AccountNotFoundError,
} from '../modules/accounts/accounts.service';

const createAccountSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['FINANCIAL', 'ASSET']),
  currency: z.string().min(1),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
});

export function createAccountsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const accounts = await listAccountsWithBalances(prisma, req.userId!);
      res.json(accounts);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const account = await createAccount(prisma, { userId: req.userId!, ...parsed.data });
      res.status(201).json(account);
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const account = await updateAccount(prisma, {
          userId: req.userId!,
          accountId: req.params.id,
          ...parsed.data,
        });
        res.json(account);
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        const result = await deleteAccount(prisma, { userId: req.userId!, accountId: req.params.id });
        res.json(result);
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}
```

- [ ] **Step 5: Mount the router in `apps/api/src/app.ts`**

Add this import near the other local imports:

```ts
import { createAccountsRouter } from './routes/accounts.routes';
```

Add this line right before the `app.use((err: unknown, ...) => { ... })` catch-all error middleware at the bottom of `createApp`:

```ts
  app.use('/api/accounts', createAccountsRouter(prisma));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/accounts.routes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/asyncHandler.ts apps/api/src/app.ts apps/api/src/routes/accounts.routes.ts apps/api/tests/accounts.routes.test.ts
git commit -m "feat: add accounts HTTP routes"
```

---

### Task 10: Categories HTTP routes

**Files:**
- Create: `apps/api/src/routes/categories.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/categories.routes.test.ts`

**Interfaces:**
- Consumes: `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `CategoryNotFoundError`, `SystemCategoryError`, `DuplicateCategoryNameError` (Task 6); `asyncHandler` (Task 9).
- Produces: `createCategoriesRouter(prisma: PrismaClient): Router` — mounted at `/api/categories`, routes `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 1: Write the failing integration tests**

```ts
// apps/api/tests/categories.routes.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

async function registerAgent(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'password123' });
  return { agent, csrfToken: res.body.csrfToken as string };
}

describe('categories routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('lists the default categories seeded at registration', async () => {
    const { agent } = await registerAgent('a@b.com');

    const res = await agent.get('/api/categories');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
  });

  it('creates, updates, and deletes a category', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const created = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Hobbies', kind: 'EXPENSE' });
    expect(created.status).toBe(201);

    const updated = await agent
      .patch(`/api/categories/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');

    const deleted = await agent
      .delete(`/api/categories/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body.hardDeleted).toBe(true);
  });

  it('rejects a duplicate category name with 409', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    await agent.post('/api/categories').set('X-CSRF-Token', csrfToken).send({ name: 'Hobbies', kind: 'EXPENSE' });

    const res = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Hobbies', kind: 'EXPENSE' });

    expect(res.status).toBe(409);
  });

  it('rejects editing a system category with 403', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const categories = await agent.get('/api/categories?includeInactive=true');
    const other = categories.body.find((c: { name: string }) => c.name === 'Other');

    const res = await agent
      .patch(`/api/categories/${other.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/categories.routes.test.ts`
Expected: FAIL — `/api/categories` isn't mounted yet

- [ ] **Step 3: Write `apps/api/src/routes/categories.routes.ts`**

```ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryNotFoundError,
  SystemCategoryError,
  DuplicateCategoryNameError,
} from '../modules/categories/categories.service';

const createCategorySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['INCOME', 'EXPENSE']),
});

const updateCategorySchema = z.object({
  name: z.string().min(1),
});

export function createCategoriesRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const includeInactive = req.query.includeInactive === 'true';
      const categories = await listCategories(prisma, req.userId!, { includeInactive });
      res.json(categories);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const category = await createCategory(prisma, { userId: req.userId!, ...parsed.data });
        res.status(201).json(category);
      } catch (err) {
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const category = await updateCategory(prisma, {
          userId: req.userId!,
          categoryId: req.params.id,
          name: parsed.data.name,
        });
        res.json(category);
      } catch (err) {
        if (err instanceof CategoryNotFoundError) {
          res.status(404).json({ error: 'Category not found' });
          return;
        }
        if (err instanceof SystemCategoryError) {
          res.status(403).json({ error: err.message });
          return;
        }
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        const result = await deleteCategory(prisma, { userId: req.userId!, categoryId: req.params.id });
        res.json(result);
      } catch (err) {
        if (err instanceof CategoryNotFoundError) {
          res.status(404).json({ error: 'Category not found' });
          return;
        }
        if (err instanceof SystemCategoryError) {
          res.status(403).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}
```

- [ ] **Step 4: Mount the router in `apps/api/src/app.ts`**

Add the import:

```ts
import { createCategoriesRouter } from './routes/categories.routes';
```

Add, next to the accounts router mount:

```ts
  app.use('/api/categories', createCategoriesRouter(prisma));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/categories.routes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/categories.routes.ts apps/api/src/app.ts apps/api/tests/categories.routes.test.ts
git commit -m "feat: add categories HTTP routes"
```

---

### Task 11: Transactions HTTP routes

**Files:**
- Create: `apps/api/src/routes/transactions.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/transactions.routes.test.ts`

**Interfaces:**
- Consumes: `createTransaction`, `InvalidEntryError`, `UnbalancedTransactionError` (Task 3); `createRecurringTemplate`, `listTransactions`, `updateRecurringTemplate`, `updateOneOffTransaction`, `deleteTransaction`, `TransactionNotFoundError`, `NotARecurringTemplateError`, `NotAOneOffTransactionError` (Task 8); `asyncHandler` (Task 9).
- Produces: `createTransactionsRouter(prisma: PrismaClient): Router` — mounted at `/api/transactions`, routes `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`. `POST`/`PATCH` dispatch between the one-off shape (has `entries`) and the recurring-template shape (has `interval`/`amount`/`accountId`/`categoryId` at the top level) based on whether `req.body.entries` is an array.

- [ ] **Step 1: Write the failing integration tests**

```ts
// apps/api/tests/transactions.routes.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

async function registerAgent(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'password123' });
  return { agent, csrfToken: res.body.csrfToken as string };
}

async function createAccount(agent: ReturnType<typeof request.agent>, csrfToken: string, name: string) {
  const res = await agent
    .post('/api/accounts')
    .set('X-CSRF-Token', csrfToken)
    .send({ name, kind: 'FINANCIAL', currency: 'USD' });
  return res.body.id as string;
}

async function categoryId(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.get('/api/categories');
  return (res.body.find((c: { name: string }) => c.name === name) as { id: string }).id;
}

describe('transactions routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a one-off transaction and lists it', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });
    expect(created.status).toBe(201);

    const listed = await agent.get('/api/transactions?frequency=ONE_OFF');
    expect(listed.body).toHaveLength(1);
  });

  it('creates a recurring template', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    expect(created.status).toBe(201);
    expect(created.body.frequency).toBe('RECURRING');
  });

  it('updates a one-off transaction and rejects an unbalanced edit', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    const updated = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        entries: [
          { accountId, amount: '1500.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1500.00', currency: 'USD' },
        ],
      });
    expect(updated.status).toBe(200);

    const unbalanced = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        entries: [
          { accountId, amount: '100.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-50.00', currency: 'USD' },
        ],
      });
    expect(unbalanced.status).toBe(400);
  });

  it('updates a recurring template and can deactivate it', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    const updated = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ isActive: false });

    expect(updated.status).toBe(200);
    expect(updated.body.isActive).toBe(false);
  });

  it('deletes a one-off transaction (hard) and a recurring template (soft)', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const oneOff = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });
    const template = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    const deletedOneOff = await agent
      .delete(`/api/transactions/${oneOff.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deletedOneOff.body.hardDeleted).toBe(true);

    const deletedTemplate = await agent
      .delete(`/api/transactions/${template.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deletedTemplate.body.hardDeleted).toBe(false);
  });

  it("returns 404 deleting another user's transaction", async () => {
    const owner = await registerAgent('owner@b.com');
    const stranger = await registerAgent('stranger@b.com');
    const accountId = await createAccount(owner.agent, owner.csrfToken, 'Card');
    const salaryId = await categoryId(owner.agent, 'Зарплата');

    const created = await owner.agent
      .post('/api/transactions')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    const res = await stranger.agent
      .delete(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', stranger.csrfToken);

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/transactions.routes.test.ts`
Expected: FAIL — `/api/transactions` isn't mounted yet

- [ ] **Step 3: Write `apps/api/src/routes/transactions.routes.ts`**

```ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createTransaction,
  InvalidEntryError,
  UnbalancedTransactionError,
} from '../modules/ledger/ledger.service';
import {
  createRecurringTemplate,
  listTransactions,
  updateRecurringTemplate,
  updateOneOffTransaction,
  deleteTransaction,
  TransactionNotFoundError,
  NotARecurringTemplateError,
  NotAOneOffTransactionError,
} from '../modules/transactions/transactions.service';

const entrySchema = z.object({
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  amount: z.string().min(1),
  currency: z.string().min(1),
});

const createOneOffSchema = z.object({
  description: z.string().min(1),
  date: z.coerce.date(),
  entries: z.tuple([entrySchema, entrySchema]),
});

const createRecurringSchema = z.object({
  description: z.string().min(1),
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: z.string().min(1),
  currency: z.string().min(1),
  interval: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM']),
  customDays: z.number().int().positive().optional(),
  startDate: z.coerce.date(),
});

const updateOneOffSchema = z.object({
  description: z.string().min(1).optional(),
  date: z.coerce.date().optional(),
  entries: z.tuple([entrySchema, entrySchema]),
});

const updateRecurringSchema = z.object({
  amount: z.string().min(1).optional(),
  interval: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM']).optional(),
  customDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

function handleServiceError(res: import('express').Response, err: unknown): boolean {
  if (
    err instanceof TransactionNotFoundError
  ) {
    res.status(404).json({ error: 'Transaction not found' });
    return true;
  }
  if (
    err instanceof NotAOneOffTransactionError ||
    err instanceof NotARecurringTemplateError ||
    err instanceof InvalidEntryError ||
    err instanceof UnbalancedTransactionError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

export function createTransactionsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const kind = req.query.kind as 'INCOME' | 'EXPENSE' | undefined;
      const frequency = req.query.frequency as 'ONE_OFF' | 'RECURRING' | undefined;
      const accountId = req.query.accountId as string | undefined;
      const transactions = await listTransactions(prisma, req.userId!, { kind, frequency, accountId });
      res.json(transactions);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      if (Array.isArray(req.body?.entries)) {
        const parsed = createOneOffSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        try {
          const transaction = await createTransaction(prisma, { userId: req.userId!, ...parsed.data });
          res.status(201).json(transaction);
        } catch (err) {
          if (handleServiceError(res, err)) return;
          throw err;
        }
        return;
      }

      const parsed = createRecurringSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const template = await createRecurringTemplate(prisma, { userId: req.userId!, ...parsed.data });
        res.status(201).json(template);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        if (Array.isArray(req.body?.entries)) {
          const parsed = updateOneOffSchema.safeParse(req.body);
          if (!parsed.success) {
            res.status(400).json({ error: parsed.error.flatten() });
            return;
          }
          const transaction = await updateOneOffTransaction(prisma, {
            userId: req.userId!,
            transactionId: req.params.id,
            ...parsed.data,
          });
          res.json(transaction);
          return;
        }

        const parsed = updateRecurringSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const template = await updateRecurringTemplate(prisma, {
          userId: req.userId!,
          transactionId: req.params.id,
          ...parsed.data,
        });
        res.json(template);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        const result = await deleteTransaction(prisma, {
          userId: req.userId!,
          transactionId: req.params.id,
        });
        res.json(result);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  return router;
}
```

- [ ] **Step 4: Mount the router in `apps/api/src/app.ts`**

Add the import:

```ts
import { createTransactionsRouter } from './routes/transactions.routes';
```

Add, next to the other router mounts:

```ts
  app.use('/api/transactions', createTransactionsRouter(prisma));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/transactions.routes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/transactions.routes.ts apps/api/src/app.ts apps/api/tests/transactions.routes.test.ts
git commit -m "feat: add transactions HTTP routes"
```

---

### Task 12: Reconciliation endpoint — generate due occurrences, then reconcile

**Files:**
- Modify: `apps/api/src/routes/accounts.routes.ts`
- Test: `apps/api/tests/accounts.routes.test.ts`

**Interfaces:**
- Consumes: `generateDueOccurrences` (Task 4); `applyReconciliation` from `apps/api/src/modules/reconciliation/reconciliation.service` (Foundation, unchanged — signature: `applyReconciliation(prisma, { userId, accountId, newBalance, date }): Promise<{ delta: Prisma.Decimal; applied: boolean }>`).
- Produces: `POST /:id/reconcile` on the accounts router, returning `{ delta: string, applied: boolean, generatedOccurrences: string[] }`.

Note: `applyReconciliation` itself does not filter by `userId` when it loads the account (it trusts the caller already scoped access) — this route is that scoping point, exactly like every other account-scoped route in this plan.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('accounts routes', ...)` block in `apps/api/tests/accounts.routes.test.ts`:

```ts
  it('reconciles an account with no recurring templates due', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const created = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await agent
      .post(`/api/accounts/${created.body.id}/reconcile`)
      .set('X-CSRF-Token', csrfToken)
      .send({ newBalance: '200.00', date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.delta).toBe('200');
    expect(res.body.applied).toBe(true);
    expect(res.body.generatedOccurrences).toEqual([]);
  });

  it('generates due recurring occurrences before computing the reconciliation delta', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const account = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    const categories = await agent.get('/api/categories');
    const rentId = categories.body.find((c: { name: string }) => c.name === 'Аренда/Жильё').id;

    await testPrisma.transaction.create({
      data: {
        userId: (await testPrisma.user.findFirstOrThrow({ where: { email: 'a@b.com' } })).id,
        description: 'Rent',
        date: new Date('2020-01-01T00:00:00Z'),
        frequency: 'RECURRING',
        interval: 'MONTH',
        nextRunDate: new Date('2020-01-01T00:00:00Z'),
        templateAccountId: account.body.id,
        templateCategoryId: rentId,
        templateAmount: '-1000.00',
        templateCurrency: 'USD',
      },
    });

    const res = await agent
      .post(`/api/accounts/${account.body.id}/reconcile`)
      .set('X-CSRF-Token', csrfToken)
      .send({ newBalance: '-1050.00', date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.delta).toBe('-50');
    expect(res.body.generatedOccurrences.length).toBeGreaterThan(0);
  });

  it("returns 404 reconciling another user's account", async () => {
    const owner = await registerAgent('owner@b.com');
    const stranger = await registerAgent('stranger@b.com');
    const created = await owner.agent
      .post('/api/accounts')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await stranger.agent
      .post(`/api/accounts/${created.body.id}/reconcile`)
      .set('X-CSRF-Token', stranger.csrfToken)
      .send({ newBalance: '1.00', date: new Date().toISOString() });

    expect(res.status).toBe(404);
  });
```

The test file already imports `testPrisma` from `./helpers/db` at the top (from Task 9), so no import changes are needed here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/accounts.routes.test.ts`
Expected: FAIL — `Cannot POST /api/accounts/:id/reconcile`

- [ ] **Step 3: Add the reconcile route to `apps/api/src/routes/accounts.routes.ts`**

Add these imports at the top, alongside the existing ones:

```ts
import { generateDueOccurrences } from '../modules/recurring/recurring.service';
import { applyReconciliation } from '../modules/reconciliation/reconciliation.service';
```

Add this schema definition next to `updateAccountSchema`:

```ts
const reconcileSchema = z.object({
  newBalance: z.string().min(1),
  date: z.coerce.date(),
});
```

Add this route inside `createAccountsRouter`, after the `DELETE /:id` route and before the closing `return router;`:

```ts
  router.post(
    '/:id/reconcile',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = reconcileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const account = await prisma.account.findFirst({
        where: { id: req.params.id, userId: req.userId! },
      });
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const generatedOccurrences = await generateDueOccurrences(prisma, req.userId!);
      const result = await applyReconciliation(prisma, {
        userId: req.userId!,
        accountId: req.params.id,
        newBalance: parsed.data.newBalance,
        date: parsed.data.date,
      });

      res.json({
        delta: result.delta.toString(),
        applied: result.applied,
        generatedOccurrences: generatedOccurrences.map((t) => t.id),
      });
    })
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/accounts.routes.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/accounts.routes.ts apps/api/tests/accounts.routes.test.ts
git commit -m "feat: add reconciliation endpoint that generates due recurring occurrences first"
```

---

### Task 13: Frontend API clients

**Files:**
- Create: `apps/web/src/api/accounts.ts`
- Create: `apps/web/src/api/categories.ts`
- Create: `apps/web/src/api/transactions.ts`
- Test: `apps/web/src/api/resources.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `apps/web/src/api/client.ts` (Foundation, unchanged).
- Produces:
  - `interface Account { id: string; name: string; kind: 'FINANCIAL' | 'ASSET'; currency: string; balance: string }`
  - `fetchAccounts(): Promise<Account[]>`
  - `createAccount(input: { name: string; kind: 'FINANCIAL' | 'ASSET'; currency: string }): Promise<Account>`
  - `reconcileAccount(accountId: string, input: { newBalance: string; date: string }): Promise<{ delta: string; applied: boolean; generatedOccurrences: string[] }>`
  - `interface Category { id: string; name: string; kind: 'INCOME' | 'EXPENSE'; isSystem: boolean }`
  - `fetchCategories(): Promise<Category[]>`
  - `interface Entry { id: string; accountId: string | null; categoryId: string | null; amount: string; currency: string }`
  - `interface Transaction { id: string; description: string; date: string; frequency: 'ONE_OFF' | 'RECURRING'; interval: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM' | null; isActive: boolean; templateAmount: string | null; templateCurrency: string | null; entries: Entry[] }`
  - `fetchTransactions(filters?: { kind?: 'INCOME' | 'EXPENSE' }): Promise<Transaction[]>`
  - `createOneOffTransaction(input: { description: string; date: string; entries: [EntryInput, EntryInput] }): Promise<Transaction>`
  - `createRecurringTransaction(input: { description: string; accountId: string; categoryId: string; amount: string; currency: string; interval: string; customDays?: number; startDate: string }): Promise<Transaction>`
  - `deleteTransaction(id: string): Promise<{ hardDeleted: boolean }>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/api/resources.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAccounts, createAccount, reconcileAccount } from './accounts';
import { fetchCategories } from './categories';
import { fetchTransactions, createOneOffTransaction, deleteTransaction } from './transactions';

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

describe('resource API clients', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchAccounts hits GET /api/accounts', async () => {
    await fetchAccounts();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts');
  });

  it('createAccount posts to /api/accounts with the given payload', async () => {
    await createAccount({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
  });

  it('reconcileAccount posts to /api/accounts/:id/reconcile', async () => {
    await reconcileAccount('acc-1', { newBalance: '100', date: '2026-08-01' });
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts/acc-1/reconcile');
  });

  it('fetchCategories hits GET /api/categories', async () => {
    await fetchCategories();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/categories');
  });

  it('fetchTransactions appends the kind filter as a query param', async () => {
    await fetchTransactions({ kind: 'EXPENSE' });
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions?kind=EXPENSE');
  });

  it('fetchTransactions omits the query string when no filter is given', async () => {
    await fetchTransactions();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions');
  });

  it('createOneOffTransaction posts entries to /api/transactions', async () => {
    await createOneOffTransaction({
      description: 'Salary',
      date: '2026-08-01',
      entries: [
        { accountId: 'acc-1', amount: '1000.00', currency: 'USD' },
        { categoryId: 'cat-1', amount: '-1000.00', currency: 'USD' },
      ],
    });
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions');
    expect(options.method).toBe('POST');
  });

  it('deleteTransaction sends DELETE to /api/transactions/:id', async () => {
    await deleteTransaction('tx-1');
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions/tx-1');
    expect(options.method).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/api/resources.test.ts`
Expected: FAIL — `Cannot find module './accounts'`

- [ ] **Step 3: Write `apps/web/src/api/accounts.ts`**

```ts
import { apiFetch } from './client';

export interface Account {
  id: string;
  name: string;
  kind: 'FINANCIAL' | 'ASSET';
  currency: string;
  balance: string;
}

export async function fetchAccounts(): Promise<Account[]> {
  return apiFetch('/accounts');
}

export async function createAccount(input: {
  name: string;
  kind: 'FINANCIAL' | 'ASSET';
  currency: string;
}): Promise<Account> {
  return apiFetch('/accounts', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateAccount(
  id: string,
  input: { name?: string; currency?: string }
): Promise<Account> {
  return apiFetch(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteAccount(id: string): Promise<{ hardDeleted: boolean }> {
  return apiFetch(`/accounts/${id}`, { method: 'DELETE' });
}

export async function reconcileAccount(
  accountId: string,
  input: { newBalance: string; date: string }
): Promise<{ delta: string; applied: boolean; generatedOccurrences: string[] }> {
  return apiFetch(`/accounts/${accountId}/reconcile`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 4: Write `apps/web/src/api/categories.ts`**

```ts
import { apiFetch } from './client';

export interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  isSystem: boolean;
}

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch('/categories');
}

export async function createCategory(input: {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}): Promise<Category> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(input) });
}
```

- [ ] **Step 5: Write `apps/web/src/api/transactions.ts`**

```ts
import { apiFetch } from './client';

export interface Entry {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string;
  description: string;
  date: string;
  frequency: 'ONE_OFF' | 'RECURRING';
  interval: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM' | null;
  isActive: boolean;
  templateAmount: string | null;
  templateCurrency: string | null;
  entries: Entry[];
}

export interface EntryInput {
  accountId?: string;
  categoryId?: string;
  amount: string;
  currency: string;
}

export interface CreateOneOffInput {
  description: string;
  date: string;
  entries: [EntryInput, EntryInput];
}

export interface CreateRecurringInput {
  description: string;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  interval: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  customDays?: number;
  startDate: string;
}

export async function fetchTransactions(
  filters: { kind?: 'INCOME' | 'EXPENSE' } = {}
): Promise<Transaction[]> {
  const query = filters.kind ? `?kind=${filters.kind}` : '';
  return apiFetch(`/transactions${query}`);
}

export async function createOneOffTransaction(input: CreateOneOffInput): Promise<Transaction> {
  return apiFetch('/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export async function createRecurringTransaction(input: CreateRecurringInput): Promise<Transaction> {
  return apiFetch('/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteTransaction(id: string): Promise<{ hardDeleted: boolean }> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/api/resources.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/accounts.ts apps/web/src/api/categories.ts apps/web/src/api/transactions.ts apps/web/src/api/resources.test.ts
git commit -m "feat: add accounts/categories/transactions API clients"
```

---

### Task 14: CashflowPage skeleton with AccountsSidebar and reconcile flow

**Files:**
- Create: `apps/web/src/styles/cashflow.css`
- Create: `apps/web/src/pages/cashflow/AccountsSidebar.tsx`
- Test: `apps/web/src/pages/cashflow/AccountsSidebar.test.tsx`
- Create: `apps/web/src/pages/CashflowPage.tsx`
- Test: `apps/web/src/pages/CashflowPage.test.tsx`

**Interfaces:**
- Consumes: `Account`, `fetchAccounts`, `reconcileAccount` (Task 13); `Category`, `fetchCategories` (Task 13); `Transaction`, `fetchTransactions` (Task 13).
- Produces: `AccountsSidebar({ accounts: Account[], onReconciled: () => void })`, `CashflowPage()` (mounted at `/cashflow` in Task 16).

- [ ] **Step 1: Write `apps/web/src/styles/cashflow.css`**

```css
.cashflow-page {
  display: flex;
  gap: 24px;
  padding: 32px;
  align-items: flex-start;
}

.cashflow-transactions {
  flex: 1;
  display: flex;
  gap: 24px;
}

.cashflow-column {
  flex: 1;
  min-width: 0;
}

.cashflow-column h2 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
}

.transaction-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.transaction-row .recurring-badge {
  color: #666;
  font-size: 12px;
  margin-left: 6px;
}

.accounts-sidebar {
  width: 240px;
  flex-shrink: 0;
}

.account-card {
  border: 1px solid #d0d0d5;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.account-card .account-name {
  font-weight: 600;
}

.account-card .account-balance {
  color: #333;
  margin: 4px 0 8px;
}

.reconcile-form {
  display: flex;
  gap: 6px;
}

.reconcile-form input {
  width: 90px;
  padding: 6px;
  border: 1px solid #d0d0d5;
  border-radius: 6px;
}
```

- [ ] **Step 2: Write the failing test for `AccountsSidebar`**

```tsx
// apps/web/src/pages/cashflow/AccountsSidebar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountsSidebar } from './AccountsSidebar';
import * as accountsApi from '../../api/accounts';

describe('AccountsSidebar', () => {
  it('renders each account name and balance', () => {
    render(
      <AccountsSidebar
        accounts={[{ id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' }]}
        onReconciled={vi.fn()}
      />
    );

    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('500 USD')).toBeInTheDocument();
  });

  it('opens the reconcile form and submits a new balance', async () => {
    vi.spyOn(accountsApi, 'reconcileAccount').mockResolvedValue({
      delta: '50',
      applied: true,
      generatedOccurrences: [],
    });
    const onReconciled = vi.fn();
    render(
      <AccountsSidebar
        accounts={[{ id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' }]}
        onReconciled={onReconciled}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /сверить/i }));
    fireEvent.change(screen.getByLabelText(/новый остаток/i), { target: { value: '550' } });
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onReconciled).toHaveBeenCalled());
    expect(accountsApi.reconcileAccount).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ newBalance: '550' })
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/cashflow/AccountsSidebar.test.tsx`
Expected: FAIL — `Cannot find module './AccountsSidebar'`

- [ ] **Step 4: Write `apps/web/src/pages/cashflow/AccountsSidebar.tsx`**

```tsx
import { useState } from 'react';
import { Account, reconcileAccount } from '../../api/accounts';

export function AccountsSidebar({
  accounts,
  onReconciled,
}: {
  accounts: Account[];
  onReconciled: () => void;
}) {
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [result, setResult] = useState<string | null>(null);

  async function handleReconcile(accountId: string) {
    const response = await reconcileAccount(accountId, {
      newBalance,
      date: new Date().toISOString(),
    });
    setResult(`Дельта: ${response.delta}`);
    setReconcilingId(null);
    setNewBalance('');
    onReconciled();
  }

  return (
    <aside className="accounts-sidebar">
      <h2>Счета</h2>
      {accounts.map((account) => (
        <div className="account-card" key={account.id}>
          <div className="account-name">{account.name}</div>
          <div className="account-balance">
            {account.balance} {account.currency}
          </div>
          {reconcilingId === account.id ? (
            <div className="reconcile-form">
              <input
                aria-label={`Новый остаток для ${account.name}`}
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
              />
              <button onClick={() => handleReconcile(account.id)}>Сохранить</button>
            </div>
          ) : (
            <button onClick={() => setReconcilingId(account.id)}>Сверить →</button>
          )}
        </div>
      ))}
      {result && <p role="status">{result}</p>}
    </aside>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/cashflow/AccountsSidebar.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for `CashflowPage`**

```tsx
// apps/web/src/pages/CashflowPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashflowPage } from './CashflowPage';
import * as accountsApi from '../api/accounts';
import * as categoriesApi from '../api/categories';
import * as transactionsApi from '../api/transactions';

describe('CashflowPage', () => {
  it('loads and renders accounts in the sidebar', async () => {
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
      { id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' },
    ]);
    vi.spyOn(categoriesApi, 'fetchCategories').mockResolvedValue([]);
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue([]);

    render(<CashflowPage />);

    expect(await screen.findByText('Card')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/CashflowPage.test.tsx`
Expected: FAIL — `Cannot find module './CashflowPage'`

- [ ] **Step 8: Write `apps/web/src/pages/CashflowPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Account, fetchAccounts } from '../api/accounts';
import { Category, fetchCategories } from '../api/categories';
import { Transaction, fetchTransactions } from '../api/transactions';
import { AccountsSidebar } from './cashflow/AccountsSidebar';
import '../styles/cashflow.css';

export function CashflowPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [accountsData, categoriesData, transactionsData] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchTransactions(),
    ]);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setTransactions(transactionsData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) return <p>Загрузка...</p>;

  return (
    <div className="cashflow-page">
      <div className="cashflow-transactions">
        <p>
          Загружено категорий: {categories.length}, транзакций: {transactions.length}. Списки
          Income/Expense появятся в следующей задаче.
        </p>
      </div>
      <AccountsSidebar accounts={accounts} onReconciled={loadAll} />
    </div>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/CashflowPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/styles/cashflow.css apps/web/src/pages/cashflow apps/web/src/pages/CashflowPage.tsx apps/web/src/pages/CashflowPage.test.tsx
git commit -m "feat: add CashflowPage skeleton with accounts sidebar and reconcile flow"
```

---

### Task 15: Income/Expense columns and the add-transaction form

**Files:**
- Create: `apps/web/src/pages/cashflow/TransactionForm.tsx`
- Test: `apps/web/src/pages/cashflow/TransactionForm.test.tsx`
- Create: `apps/web/src/pages/cashflow/TransactionColumn.tsx`
- Test: `apps/web/src/pages/cashflow/TransactionColumn.test.tsx`
- Modify: `apps/web/src/pages/CashflowPage.tsx`

**Interfaces:**
- Consumes: `Account` (Task 13); `Category` (Task 13); `Transaction`, `createOneOffTransaction`, `createRecurringTransaction`, `deleteTransaction` (Task 13).
- Produces:
  - `TransactionForm({ kind: 'INCOME' | 'EXPENSE', accounts: Account[], categories: Category[], onDone: () => void, onCancel: () => void })`
  - `TransactionColumn({ title: string, kind: 'INCOME' | 'EXPENSE', transactions: Transaction[], accounts: Account[], categories: Category[], onChanged: () => void })`

- [ ] **Step 1: Write the failing tests for `TransactionForm`**

```tsx
// apps/web/src/pages/cashflow/TransactionForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransactionForm } from './TransactionForm';
import * as transactionsApi from '../../api/transactions';

const accounts = [{ id: 'acc-1', name: 'Card', kind: 'FINANCIAL' as const, currency: 'USD', balance: '0' }];
const categories = [{ id: 'cat-1', name: 'Продукты', kind: 'EXPENSE' as const, isSystem: false }];

describe('TransactionForm', () => {
  it('submits a one-off expense with a negative signed amount on the account entry', async () => {
    vi.spyOn(transactionsApi, 'createOneOffTransaction').mockResolvedValue({} as never);
    const onDone = vi.fn();
    render(
      <TransactionForm
        kind="EXPENSE"
        accounts={accounts}
        categories={categories}
        onDone={onDone}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/описание/i), { target: { value: 'Продукты' } });
    fireEvent.change(screen.getByLabelText(/сумма/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(transactionsApi.createOneOffTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          { accountId: 'acc-1', amount: '-50', currency: 'USD' },
          { categoryId: 'cat-1', amount: '50', currency: 'USD' },
        ],
      })
    );
  });

  it('submits a recurring transaction when the "Регулярная" toggle is checked', async () => {
    vi.spyOn(transactionsApi, 'createRecurringTransaction').mockResolvedValue({} as never);
    const onDone = vi.fn();
    render(
      <TransactionForm
        kind="EXPENSE"
        accounts={accounts}
        categories={categories}
        onDone={onDone}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/описание/i), { target: { value: 'Аренда' } });
    fireEvent.change(screen.getByLabelText(/сумма/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByLabelText(/регулярная/i));
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(transactionsApi.createRecurringTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '-1000', interval: 'MONTH' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/cashflow/TransactionForm.test.tsx`
Expected: FAIL — `Cannot find module './TransactionForm'`

- [ ] **Step 3: Write `apps/web/src/pages/cashflow/TransactionForm.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Account } from '../../api/accounts';
import { Category } from '../../api/categories';
import { createOneOffTransaction, createRecurringTransaction } from '../../api/transactions';

const INTERVALS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM'] as const;

export function TransactionForm({
  kind,
  accounts,
  categories,
  onDone,
  onCancel,
}: {
  kind: 'INCOME' | 'EXPENSE';
  accounts: Account[];
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isRecurring, setIsRecurring] = useState(false);
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('MONTH');
  const [customDays, setCustomDays] = useState('30');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      setError('Выберите счёт');
      return;
    }

    const magnitude = Math.abs(Number(amount));
    const signedAmount = kind === 'EXPENSE' ? `-${magnitude}` : `${magnitude}`;

    try {
      if (isRecurring) {
        await createRecurringTransaction({
          description,
          accountId,
          categoryId,
          amount: signedAmount,
          currency: account.currency,
          interval,
          customDays: interval === 'CUSTOM' ? Number(customDays) : undefined,
          startDate: new Date().toISOString(),
        });
      } else {
        await createOneOffTransaction({
          description,
          date: new Date().toISOString(),
          entries: [
            { accountId, amount: signedAmount, currency: account.currency },
            { categoryId, amount: (-Number(signedAmount)).toString(), currency: account.currency },
          ],
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  }

  return (
    <form className="transaction-form" onSubmit={handleSubmit}>
      <label>
        Описание
        <input value={description} onChange={(e) => setDescription(e.target.value)} required />
      </label>
      <label>
        Счёт
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Категория
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Сумма
        <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label>
        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
        Регулярная
      </label>
      {isRecurring && (
        <label>
          Периодичность
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as (typeof INTERVALS)[number])}
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      )}
      {isRecurring && interval === 'CUSTOM' && (
        <label>
          Дней
          <input
            type="number"
            min="1"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit">Сохранить</button>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/cashflow/TransactionForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing tests for `TransactionColumn`**

```tsx
// apps/web/src/pages/cashflow/TransactionColumn.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransactionColumn } from './TransactionColumn';
import * as transactionsApi from '../../api/transactions';

const accounts = [{ id: 'acc-1', name: 'Card', kind: 'FINANCIAL' as const, currency: 'USD', balance: '0' }];
const categories = [{ id: 'cat-1', name: 'Продукты', kind: 'EXPENSE' as const, isSystem: false }];
const transactions = [
  {
    id: 'tx-1',
    description: 'Продукты',
    date: '2026-07-01',
    frequency: 'ONE_OFF' as const,
    interval: null,
    isActive: true,
    templateAmount: null,
    templateCurrency: null,
    entries: [
      { id: 'e1', accountId: 'acc-1', categoryId: null, amount: '-50.00', currency: 'USD' },
      { id: 'e2', accountId: null, categoryId: 'cat-1', amount: '50.00', currency: 'USD' },
    ],
  },
];

describe('TransactionColumn', () => {
  it('renders a transaction row', () => {
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('Продукты')).toBeInTheDocument();
  });

  it('deletes a transaction and calls onChanged', async () => {
    vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue({ hardDeleted: true });
    const onChanged = vi.fn();
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /удалить/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(transactionsApi.deleteTransaction).toHaveBeenCalledWith('tx-1');
  });

  it('shows the add-transaction form when "+ Добавить" is clicked', () => {
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={[]}
        accounts={accounts}
        categories={categories}
        onChanged={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /добавить/i }));

    expect(screen.getByLabelText(/описание/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/cashflow/TransactionColumn.test.tsx`
Expected: FAIL — `Cannot find module './TransactionColumn'`

- [ ] **Step 7: Write `apps/web/src/pages/cashflow/TransactionColumn.tsx`**

```tsx
import { useState } from 'react';
import { Category } from '../../api/categories';
import { Account } from '../../api/accounts';
import { Transaction, deleteTransaction } from '../../api/transactions';
import { TransactionForm } from './TransactionForm';

export function TransactionColumn({
  title,
  kind,
  transactions,
  accounts,
  categories,
  onChanged,
}: {
  title: string;
  kind: 'INCOME' | 'EXPENSE';
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  async function handleDelete(id: string) {
    await deleteTransaction(id);
    onChanged();
  }

  return (
    <div className="cashflow-column">
      <h2>
        {title}
        <button onClick={() => setAdding(true)}>+ Добавить</button>
      </h2>
      {adding && (
        <TransactionForm
          kind={kind}
          accounts={accounts}
          categories={categories.filter((c) => c.kind === kind)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {transactions.map((t) => (
        <div className="transaction-row" key={t.id}>
          <span>
            {t.description}
            {t.frequency === 'RECURRING' && <span className="recurring-badge">⟳ {t.interval}</span>}
          </span>
          <span>
            {t.frequency === 'RECURRING' ? t.templateAmount : t.entries.find((e) => e.accountId)?.amount}{' '}
            {t.templateCurrency ?? t.entries[0]?.currency}
          </span>
          <button onClick={() => handleDelete(t.id)}>Удалить</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/cashflow/TransactionColumn.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 9: Wire the columns into `apps/web/src/pages/CashflowPage.tsx`**

Replace the whole file with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Account, fetchAccounts } from '../api/accounts';
import { Category, fetchCategories } from '../api/categories';
import { Transaction, fetchTransactions } from '../api/transactions';
import { AccountsSidebar } from './cashflow/AccountsSidebar';
import { TransactionColumn } from './cashflow/TransactionColumn';
import '../styles/cashflow.css';

export function CashflowPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [income, setIncome] = useState<Transaction[]>([]);
  const [expense, setExpense] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [accountsData, categoriesData, incomeData, expenseData] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchTransactions({ kind: 'INCOME' }),
      fetchTransactions({ kind: 'EXPENSE' }),
    ]);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setIncome(incomeData);
    setExpense(expenseData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) return <p>Загрузка...</p>;

  return (
    <div className="cashflow-page">
      <div className="cashflow-transactions">
        <TransactionColumn
          title="Income"
          kind="INCOME"
          transactions={income}
          accounts={accounts}
          categories={categories}
          onChanged={loadAll}
        />
        <TransactionColumn
          title="Expense"
          kind="EXPENSE"
          transactions={expense}
          accounts={accounts}
          categories={categories}
          onChanged={loadAll}
        />
      </div>
      <AccountsSidebar accounts={accounts} onReconciled={loadAll} />
    </div>
  );
}
```

- [ ] **Step 10: Run the full frontend suite**

Run: `cd apps/web && npx vitest run`
Expected: all test files PASS (the Task 14 `CashflowPage.test.tsx` still passes — it only asserts the account name renders, and `fetchTransactions` is mocked with `mockResolvedValue([])` regardless of the `{ kind }` argument it's now called with)

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/cashflow/TransactionForm.tsx apps/web/src/pages/cashflow/TransactionForm.test.tsx apps/web/src/pages/cashflow/TransactionColumn.tsx apps/web/src/pages/cashflow/TransactionColumn.test.tsx apps/web/src/pages/CashflowPage.tsx
git commit -m "feat: add income/expense transaction columns and add-transaction form"
```

---

### Task 16: Route wiring, dashboard nav link, full suite, manual smoke test

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`
- Modify: `apps/web/src/pages/CashflowPage.tsx`

**Interfaces:**
- Consumes: `CashflowPage` (Task 15).
- Produces: `/cashflow` route in `App`, reachable only when authenticated; a nav link from `/dashboard` to `/cashflow` and back.

- [ ] **Step 1: Write the failing test for `DashboardPage`**

```tsx
// apps/web/src/pages/DashboardPage.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
  it('links to the Cashflow page', () => {
    render(
      <MemoryRouter>
        <DashboardPage user={{ id: '1', email: 'a@b.com' }} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /cashflow/i })).toHaveAttribute('href', '/cashflow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/DashboardPage.test.tsx`
Expected: FAIL — no link with an accessible name matching `/cashflow/i` exists yet

- [ ] **Step 3: Add the link to `apps/web/src/pages/DashboardPage.tsx`**

```tsx
import { Link } from 'react-router-dom';

export function DashboardPage({ user }: { user: { id: string; email: string } }) {
  return (
    <div style={{ padding: 32 }}>
      <h1>Добро пожаловать, {user.email}</h1>
      <p>
        <Link to="/cashflow">Перейти к Cashflow →</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/DashboardPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Add a back-link to `apps/web/src/pages/CashflowPage.tsx`**

Add the import:

```tsx
import { Link } from 'react-router-dom';
```

Add this line as the first child inside the returned `<div className="cashflow-page">`, before `<div className="cashflow-transactions">`:

```tsx
      <Link to="/dashboard">← Дашборд</Link>
```

- [ ] **Step 6: Add the `/cashflow` route to `apps/web/src/App.tsx`**

Add the import:

```tsx
import { CashflowPage } from './pages/CashflowPage';
```

Add this `<Route>` inside `<Routes>`, right after the `/dashboard` route and before the catch-all `path="*"` route:

```tsx
        <Route
          path="/cashflow"
          element={user ? <CashflowPage /> : <Navigate to="/login" />}
        />
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd apps/web && npx vitest run`
Expected: all test files PASS

- [ ] **Step 8: Run the full backend suite**

Run: `cd apps/api && npx vitest run`
Expected: all test files PASS

- [ ] **Step 9: Manual end-to-end smoke test**

Run in one terminal: `cd apps/api && npm run dev`
Run in another terminal: `cd apps/web && npm run dev`

In the browser:
1. Register a new account, confirm redirect to `/dashboard`.
2. Click "Перейти к Cashflow →", confirm the Cashflow page loads with an empty Income column, empty Expense column, and no accounts in the sidebar.
3. Click "+ Добавить" in the Accounts area is not present (accounts are created via API only in this plan — creating an account through the UI is out of scope; instead, create one directly: `fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '<token from the register response>' }, body: JSON.stringify({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' }) })` from the browser devtools console, then reload the Cashflow page).
4. Click "+ Добавить" in the Income column, fill in description "Salary", amount "1000", submit. Confirm it appears in the Income column and the account balance in the sidebar updates to 1000.
5. Click "+ Добавить" in the Expense column, check "Регулярная", fill in description "Rent", amount "1000", interval "MONTH", submit. Confirm it appears in the Expense column with a "⟳ MONTH" badge.
6. Click "Сверить →" on the account, enter a new balance different from the current one, submit. Confirm the delta message appears and the account balance updates.
7. Refresh the page — confirm all data (accounts, income, expense) is still there.

Expected: all seven steps behave as described, with no console errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/DashboardPage.test.tsx apps/web/src/pages/CashflowPage.tsx
git commit -m "feat: wire Cashflow route and dashboard navigation link"
```

---

## Out of scope for this plan

Creating/editing/archiving accounts and categories through the UI (only reachable via the API in this plan — the Cashflow page only lets the user create/delete transactions and reconcile). Currency conversion and dashboard aggregation across accounts (sub-project 4). Asset-specific UI (sub-project 3, though `Account.kind = ASSET` already works end-to-end through this plan's API). Settings/account management, including changing `reconciliationMode` (sub-project 5).
