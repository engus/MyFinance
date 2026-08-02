import { z } from 'zod';

export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'CNY',
  'AUD',
  'CAD',
  'CHF',
  'HKD',
  'SGD',
  'SEK',
  'KRW',
  'NOK',
  'NZD',
  'INR',
  'MXN',
  'TWD',
  'ZAR',
  'BRL',
  'DKK',
  'UAH',
  'KZT',
  'RUB',
  'AED',
] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
export const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,8})?$/, 'Invalid amount');
export const signedMoneySchema = z.string().regex(/^-?\d{1,16}(\.\d{1,8})?$/, 'Invalid amount');
export const ownershipShareSchema = moneySchema.refine(
  (value) => Number(value) > 0 && Number(value) <= 100,
  'Ownership share must be between 0 and 100'
);
export const percentageSchema = moneySchema.refine(
  (value) => Number(value) <= 999,
  'Percentage is too large'
);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const idSchema = z.union([z.string().uuid(), z.string().cuid()]);

export const accountClassSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY']);
export const accountSubtypeSchema = z.enum([
  'BANK',
  'CASH',
  'BROKERAGE',
  'REAL_ESTATE',
  'VEHICLE',
  'SECURITY',
  'PRIVATE_BUSINESS',
  'COLLECTIBLE',
  'MORTGAGE',
  'LOAN',
  'CREDIT_CARD',
  'OTHER',
]);

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  class: accountClassSchema.exclude(['EQUITY']),
  subtype: accountSubtypeSchema,
  currency: currencySchema,
  institution: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  region: z.string().trim().max(120).optional(),
  openingBalance: moneySchema.optional(),
  openingDate: dateSchema.optional(),
  openingFxRate: moneySchema.optional(),
});

export const updateAccountSchema = createAccountSchema
  .omit({
    class: true,
    subtype: true,
    openingBalance: true,
    openingDate: true,
    openingFxRate: true,
  })
  .partial()
  .extend({ isArchived: z.boolean().optional() });

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['INCOME', 'EXPENSE']),
});

export const incomeExpenseOperationSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  description: z.string().trim().min(1).max(240),
  date: dateSchema,
  accountId: idSchema,
  categoryId: idSchema,
  amount: moneySchema.refine((value) => value !== '0', 'Amount must be positive'),
  currency: currencySchema,
  fxRate: moneySchema.optional(),
});

export const transferOperationSchema = z.object({
  type: z.literal('TRANSFER'),
  description: z.string().trim().min(1).max(240),
  date: dateSchema,
  fromAccountId: idSchema,
  toAccountId: idSchema,
  fromAmount: moneySchema.refine((value) => value !== '0', 'Amount must be positive'),
  toAmount: moneySchema.refine((value) => value !== '0', 'Amount must be positive'),
  feeAmount: moneySchema.optional(),
  fxRate: moneySchema.optional(),
});

export const liabilityPaymentOperationSchema = z.object({
  type: z.literal('LIABILITY_PAYMENT'),
  description: z.string().trim().min(1).max(240),
  date: dateSchema,
  cashAccountId: idSchema,
  liabilityAccountId: idSchema,
  principalAmount: moneySchema,
  interestAmount: moneySchema,
  fxRate: moneySchema.optional(),
});

export const openingBalanceOperationSchema = z.object({
  type: z.literal('OPENING_BALANCE'),
  description: z.string().trim().min(1).max(240).default('Opening balance'),
  date: dateSchema,
  accountId: idSchema,
  amount: moneySchema,
  fxRate: moneySchema.optional(),
});

export const createOperationSchema = z.discriminatedUnion('type', [
  incomeExpenseOperationSchema,
  transferOperationSchema,
  liabilityPaymentOperationSchema,
  openingBalanceOperationSchema,
]);

export const recurrenceSchema = z
  .object({
    operation: z.discriminatedUnion('type', [
      incomeExpenseOperationSchema,
      transferOperationSchema,
      liabilityPaymentOperationSchema,
    ]),
    interval: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM']),
    customDays: z.number().int().min(1).max(3650).optional(),
    startDate: dateSchema,
  })
  .superRefine((value, ctx) => {
    if (value.interval === 'CUSTOM' && value.customDays === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customDays'], message: 'Required' });
    }
  });

export const settingsSchema = z.object({
  functionalCurrency: currencySchema.optional(),
  displayCurrency: currencySchema.optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  reconciliationMode: z.enum(['AUTO', 'CONFIRM']).optional(),
});

export const manualRateSchema = z.object({
  fromCurrency: currencySchema,
  toCurrency: currencySchema,
  date: dateSchema,
  rate: moneySchema.refine((value) => value !== '0', 'Rate must be positive'),
});

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['REAL_ESTATE', 'VEHICLE', 'SECURITY', 'PRIVATE_BUSINESS', 'COLLECTIBLE', 'OTHER']),
  currency: currencySchema,
  initialValue: moneySchema.refine((value) => value !== '0', 'Value must be positive'),
  valuationDate: dateSchema,
  fxRate: moneySchema.optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  region: z.string().trim().max(120).optional(),
  institution: z.string().trim().max(120).optional(),
  ownershipShare: ownershipShareSchema.default('100'),
  notes: z.string().trim().max(2000).optional(),
});

export const createValuationSchema = z.object({
  amount: moneySchema,
  currency: currencySchema,
  date: dateSchema,
  source: z.enum(['MANUAL', 'MARKET']).default('MANUAL'),
  fxRate: moneySchema.optional(),
});

export const createLiabilitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  subtype: z.enum(['MORTGAGE', 'LOAN', 'CREDIT_CARD']),
  currency: currencySchema,
  openingBalance: moneySchema.refine((value) => value !== '0', 'Balance must be positive'),
  openingDate: dateSchema,
  fxRate: moneySchema.optional(),
  creditor: z.string().trim().max(120).optional(),
  annualInterestRate: percentageSchema.optional(),
  maturityDate: dateSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  functionalCurrency: currencySchema.default('USD'),
  timezone: z.string().trim().min(1).max(100).default('UTC'),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string[]> };
}

export type CreateOperationInput = z.infer<typeof createOperationSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;
export type UserSettingsInput = z.infer<typeof settingsSchema>;
export type ManualRateInput = z.infer<typeof manualRateSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type CreateValuationInput = z.infer<typeof createValuationSchema>;
export type CreateLiabilityInput = z.infer<typeof createLiabilitySchema>;
