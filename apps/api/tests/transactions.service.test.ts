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
