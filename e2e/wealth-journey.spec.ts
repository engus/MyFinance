import { createHmac } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';

const PASSWORD = 'E2E-strong-password!';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value: string) {
  let bits = '';
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    bits += BASE32.indexOf(character).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function selectContaining(select: Locator, label: string) {
  const value = await select.locator('option').filter({ hasText: label }).getAttribute('value');
  expect(value, `option containing "${label}"`).not.toBeNull();
  await select.selectOption(value!);
}

test('complete private-wealth journey', async ({ page }) => {
  const email = `e2e-${Date.now()}-${test.info().project.name}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: /first account/i })).toBeVisible();
  await page.getByLabel('Timezone').fill('UTC');
  await page.getByLabel('Account name').fill('Primary checking');
  await page.getByLabel('Current balance').fill('10000.00');
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: /Cashflow/ }).click();
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const accountDialog = page.getByRole('dialog', { name: 'Add financial account' });
  await accountDialog.getByLabel('Account name').fill('Euro travel cash');
  await accountDialog.getByLabel('Currency').selectOption('EUR');
  await accountDialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Euro travel cash').first()).toBeVisible();

  await page.getByRole('button', { name: 'New operation' }).click();
  let operationDialog = page.getByRole('dialog', { name: 'New operation' });
  await operationDialog
    .getByRole('combobox', { name: 'Operation', exact: true })
    .selectOption('INCOME');
  await operationDialog.getByLabel('Description').fill('E2E salary');
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'Account', exact: true }),
    'Primary checking'
  );
  await operationDialog.getByLabel('Amount').fill('2500.00');
  await operationDialog.getByRole('button', { name: 'Post operation' }).click();
  await expect(page.getByText('E2E salary')).toBeVisible();

  await page.getByRole('button', { name: 'New operation' }).click();
  operationDialog = page.getByRole('dialog', { name: 'New operation' });
  await operationDialog
    .getByRole('combobox', { name: 'Operation', exact: true })
    .selectOption('EXPENSE');
  await operationDialog.getByLabel('Description').fill('E2E groceries');
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'Account', exact: true }),
    'Primary checking'
  );
  await operationDialog.getByLabel('Amount').fill('42.17');
  await operationDialog.getByRole('button', { name: 'Post operation' }).click();
  await expect(page.getByText('E2E groceries')).toBeVisible();

  await page.getByRole('button', { name: 'New operation' }).click();
  operationDialog = page.getByRole('dialog', { name: 'New operation' });
  await operationDialog
    .getByRole('combobox', { name: 'Operation', exact: true })
    .selectOption('TRANSFER');
  await operationDialog.getByLabel('Description').fill('E2E FX transfer');
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'From account' }),
    'Primary checking'
  );
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'To account' }),
    'Euro travel cash'
  );
  await operationDialog.getByLabel('From amount').fill('108.00');
  await operationDialog.getByLabel('To amount').fill('100.00');
  await operationDialog.getByRole('button', { name: 'Post operation' }).click();
  await expect(page.getByText('E2E FX transfer')).toBeVisible();

  await page.getByRole('button', { name: 'New operation' }).click();
  operationDialog = page.getByRole('dialog', { name: 'New operation' });
  await operationDialog.getByLabel('Description').fill('E2E monthly bill');
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'Account', exact: true }),
    'Primary checking'
  );
  await operationDialog.getByLabel('Amount').fill('10.00');
  await operationDialog.getByLabel('Repeat this operation').check();
  await operationDialog.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByText('E2E monthly bill')).toBeVisible();

  const checkingCard = page
    .locator('.account-strip article')
    .filter({ hasText: 'Primary checking' });
  await checkingCard.getByRole('button', { name: 'Reconcile' }).click();
  const reconcileDialog = page.getByRole('dialog', { name: /Reconcile Primary checking/ });
  await reconcileDialog.getByLabel('Current balance').fill('12340.00');
  await reconcileDialog.getByRole('button', { name: 'Preview reconciliation' }).click();
  const confirmAdjustment = reconcileDialog.getByRole('button', { name: 'Confirm adjustment' });
  if (await confirmAdjustment.isVisible()) await confirmAdjustment.click();
  await expect(reconcileDialog).not.toBeVisible();

  await page.getByRole('link', { name: /Assets/ }).click();
  await page.getByRole('button', { name: 'Add asset' }).click();
  let assetDialog = page.getByRole('dialog', { name: 'Add an asset' });
  await assetDialog.getByLabel('Asset name').fill('E2E apartment');
  await assetDialog.getByLabel('Current total value').fill('250000');
  await assetDialog.getByRole('button', { name: 'Add asset' }).click();
  await expect(page.getByText('E2E apartment')).toBeVisible();

  await page.getByRole('button', { name: 'Add asset' }).click();
  assetDialog = page.getByRole('dialog', { name: 'Add an asset' });
  await assetDialog.getByLabel('Asset name').fill('E2E index fund');
  await assetDialog.getByLabel('Type').selectOption('SECURITY');
  await assetDialog.getByLabel('Current total value').fill('1000');
  await assetDialog.getByLabel('Initial value date').fill('2026-07-01');
  await assetDialog.getByRole('button', { name: 'Add asset' }).click();
  const securityCard = page.locator('.asset-card').filter({ hasText: 'E2E index fund' });
  await expect(securityCard).toBeVisible();
  await securityCard.getByRole('button', { name: 'Record value' }).click();
  const valuationDialog = page.getByRole('dialog', { name: 'Value E2E index fund' });
  await valuationDialog.getByLabel('Value').fill('1100');
  await valuationDialog.getByRole('button', { name: 'Record valuation' }).click();
  await expect(securityCard.getByText('$1,100.00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add liability' }).click();
  const liabilityDialog = page.getByRole('dialog', { name: 'Add a liability' });
  await liabilityDialog.getByLabel('Liability name').fill('E2E mortgage');
  await liabilityDialog.getByLabel('Amount owed').fill('150000');
  await liabilityDialog.getByRole('button', { name: 'Add liability' }).click();
  await expect(page.getByText('E2E mortgage')).toBeVisible();

  await page.getByRole('link', { name: /Cashflow/ }).click();
  await page.getByRole('button', { name: 'New operation' }).click();
  operationDialog = page.getByRole('dialog', { name: 'New operation' });
  await operationDialog
    .getByRole('combobox', { name: 'Operation', exact: true })
    .selectOption('LIABILITY_PAYMENT');
  await operationDialog.getByLabel('Description').fill('E2E mortgage payment');
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'Cash account' }),
    'Primary checking'
  );
  await selectContaining(
    operationDialog.getByRole('combobox', { name: 'Liability' }),
    'E2E mortgage'
  );
  await operationDialog.getByLabel('Principal').fill('500');
  await operationDialog.getByLabel('Interest').fill('50');
  await operationDialog.getByRole('button', { name: 'Post operation' }).click();
  await expect(page.getByText('E2E mortgage payment')).toBeVisible();

  await page.getByRole('link', { name: /Settings/ }).click();
  await expect(page.getByRole('main').getByText(email)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up' }).click();
  const setupDialog = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
  const secretNode = setupDialog.locator('.totp-secret');
  await expect(secretNode).not.toHaveText('Generating…');
  const secret = (await secretNode.textContent())!.trim();
  await setupDialog.getByLabel('Six-digit code').fill(totp(secret));
  await setupDialog.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await expect(setupDialog.getByText(/recovery codes/i)).toBeVisible();
  await setupDialog.getByRole('button', { name: 'I saved the codes' }).click();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Authentication or recovery code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: /Settings/ }).click();
  await page.getByRole('button', { name: 'Delete account' }).last().click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete your account' });
  await deleteDialog.getByLabel('Password').fill(PASSWORD);
  await deleteDialog.getByLabel('Authentication code').fill(totp(secret));
  await deleteDialog.getByRole('button', { name: 'Permanently delete account' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
